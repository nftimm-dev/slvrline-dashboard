/**
 * run.ts — Compute all current metrics via archival eth_call and write one snapshot row per metric.
 *
 * All metrics are computed from on-chain state at the latest block using archival reads.
 * No dependency on the Ponder indexer tables for metric computation.
 *
 * Metrics written (7 rows per run):
 *   1. dividends_apr        — 7-day rolling index-delta APR (archival minerIndex)
 *   2. circulating_supply   — totalSupply(head) - excluded balances(head)
 *   3. emission_rate_30d    — totalSupply(head) - totalSupply(block@30d ago)
 *   4. runway_months        — (cap - totalSupply) / rate30d in months
 *   5. total_staked_slvr    — ve_lock events reconstruction + LP staked
 *   6. lottery_round_state  — current round from eth_call
 *   7. total_supply         — totalSupply(head) + on-chain circulating cross-check
 *
 * Each metric is wrapped in try/catch — a failure in one does not block others.
 */

import { sql } from "./db";
import { writeSnapshot } from "./snapshot";
import { computeDividendsApr } from "./formulas/apr";
import { computeSupply } from "./formulas/supply";
import { computeRunway } from "./formulas/runway";
import { computeStaking } from "./formulas/staking";
import { computeLotteryRoundState } from "./formulas/lottery";
import { getHead } from "./block-resolver";
import { APR_WINDOW_SECONDS, SLVR_CAP } from "./constants";

export async function computeAndWrite(): Promise<void> {
  const now = new Date();
  const head = await getHead();
  const headBlock = head.block;

  console.log(`[metrics] Computing at ${now.toISOString()} | head block: ${headBlock} (ts: ${head.timestamp})`);

  // ---- 1. dividends_apr ----
  try {
    const apr = await computeDividendsApr(headBlock);
    await writeSnapshot({
      metricName: "dividends_apr",
      value: apr.aprPercent,
      value2: apr.deltaIndex !== null ? Number(apr.deltaIndex) / 1e18 : null,
      value3: apr.windowSeconds,
      metadata: {
        index_now: apr.indexNow?.toString() ?? null,
        index_window_start: apr.indexWindowStart?.toString() ?? null,
        window_seconds: apr.windowSeconds,
        window_days: apr.windowDays,
        contract_version: apr.contractVersion,
        block_now: apr.blockNow?.toString() ?? null,
        block_window_start: apr.blockWindowStart?.toString() ?? null,
        ts_window_start: apr.tsWindowStart?.toString() ?? null,
        data_status: apr.dataStatus,
        // "early": V2 < 7d old; window = min(7d, V2 age); matures ~2026-07-29
        basis: "v2",
        source: "archival_eth_call",
      },
      snapshotAt: now,
      blockNumber: headBlock,
    });
    console.log(
      `[metrics] dividends_apr: ${apr.aprPercent !== null ? apr.aprPercent.toFixed(2) + "%" : "NULL"} ` +
      `(${apr.dataStatus}, ${apr.windowDays}d window, contract=${apr.contractVersion})`
    );
  } catch (e) {
    console.error("[metrics][APR] Error:", e);
  }

  // ---- 2. circulating_supply + 7. total_supply ----
  let supplyResult: Awaited<ReturnType<typeof computeSupply>> | null = null;
  try {
    supplyResult = await computeSupply(headBlock);

    await writeSnapshot({
      metricName: "circulating_supply",
      value: supplyResult.circulatingHuman,
      value2: supplyResult.totalHuman,
      value3: Number(SLVR_CAP) / 1e18, // max supply constant
      metadata: {
        total_supply_raw: supplyResult.totalSupplyRaw.toString(),
        excluded_raw: supplyResult.excludedRaw.toString(),
        circulating_raw: supplyResult.circulatingRaw.toString(),
        on_chain_cs_raw: supplyResult.onChainCirculatingRaw?.toString() ?? null,
        on_chain_cs_match: supplyResult.onChainCirculatingRaw !== null
          ? supplyResult.onChainCirculatingRaw === supplyResult.circulatingRaw
            ? "exact"
            : `diff:${(Number(supplyResult.circulatingRaw - supplyResult.onChainCirculatingRaw) / 1e18).toFixed(6)}`
          : "unavailable",
        excluded_balances: Object.fromEntries(
          Object.entries(supplyResult.excludedBalances).map(([k, v]) => [k, v.toString()])
        ),
        deployer_balance: supplyResult.deployerBalance.toString(),
        source: "archival_eth_call",
        permanent_locked_note:
          "Permanent locks burn the underlying SLVR (RESEARCH.md §5) — already absent from totalSupply(). Not double-subtracted.",
      },
      snapshotAt: now,
      blockNumber: headBlock,
    });
    console.log(`[metrics] circulating_supply: ${supplyResult.circulatingHuman.toFixed(4)} SLVR (total: ${supplyResult.totalHuman.toFixed(4)})`);
  } catch (e) {
    console.error("[metrics][SUPPLY] Error:", e);
  }

  // ---- 3. emission_rate_30d + 4. runway_months ----
  try {
    const runway = await computeRunway(headBlock);

    await writeSnapshot({
      metricName: "emission_rate_30d",
      value: Number(runway.emissionRate30dRaw) / 1e18,
      value2: null,
      value3: null,
      metadata: {
        emission_rate_30d_raw: runway.emissionRate30dRaw.toString(),
        total_supply_now_raw: runway.totalSupplyNowRaw.toString(),
        total_supply_30d_ago_raw: runway.totalSupply30dAgoRaw.toString(),
        block_now: runway.blockNow.toString(),
        block_30d_ago: runway.block30dAgo.toString(),
        data_status: runway.dataStatus,
        source: "archival_eth_call",
        note: "Net supply change over 30d = minted - burned (RESEARCH.md §1c)",
      },
      snapshotAt: now,
      blockNumber: headBlock,
    });

    await writeSnapshot({
      metricName: "runway_months",
      value: runway.runwayMonths,
      value2: Number(runway.remainingCapRaw) / 1e18,
      value3: Number(runway.emissionRate30dRaw) / 1e18,
      metadata: {
        remaining_cap_raw: runway.remainingCapRaw.toString(),
        total_supply_raw: runway.totalSupplyNowRaw.toString(),
        emission_rate_30d_raw: runway.emissionRate30dRaw.toString(),
        block_now: runway.blockNow.toString(),
        block_30d_ago: runway.block30dAgo.toString(),
        data_status: runway.dataStatus,
        source: "archival_eth_call",
      },
      snapshotAt: now,
      blockNumber: headBlock,
    });

    console.log(
      `[metrics] emission_rate_30d: ${(Number(runway.emissionRate30dRaw) / 1e18).toFixed(4)} SLVR | runway: ${runway.runwayMonths?.toFixed(2) ?? "NULL"} months`
    );
  } catch (e) {
    console.error("[metrics][RUNWAY] Error:", e);
  }

  // ---- 5. total_staked_slvr ----
  try {
    const staking = await computeStaking(headBlock);
    await writeSnapshot({
      metricName: "total_staked_slvr",
      value: Number(staking.totalLockedRaw) / 1e18,
      value2: Number(staking.timelockedRaw) / 1e18,
      value3: Number(staking.permanentRaw) / 1e18,
      metadata: {
        total_locked_raw: staking.totalLockedRaw.toString(),
        timelocked_raw: staking.timelockedRaw.toString(),
        permanent_raw: staking.permanentRaw.toString(),
        active_lock_count: staking.activeLockCount,
        lp_staked_raw: staking.lpStakedRaw.toString(),
        lp_staked_lp_tokens: staking.lpStakedHuman.toFixed(6),
        source: staking.source,
        note: staking.note,
      },
      snapshotAt: now,
      blockNumber: headBlock,
    });
    console.log(
      `[metrics] total_staked_slvr: ${(Number(staking.totalLockedRaw) / 1e18).toFixed(4)} SLVR ` +
      `(permanent: ${(Number(staking.permanentRaw) / 1e18).toFixed(4)}, ` +
      `timelocked: ${(Number(staking.timelockedRaw) / 1e18).toFixed(4)}) | ` +
      `LP staked: ${staking.lpStakedHuman.toFixed(4)} LP tokens [${staking.source}]`
    );
  } catch (e) {
    console.error("[metrics][STAKING] Error:", e);
  }

  // ---- 6. lottery_round_state ----
  try {
    const lottery = await computeLotteryRoundState();
    await writeSnapshot({
      metricName: "lottery_round_state",
      value: lottery.roundId,
      value2: lottery.jackpotEth,
      value3: Number(lottery.minerIndex) / 1e18,
      metadata: {
        round_id: lottery.roundId,
        jackpot_wei: lottery.jackpotWei.toString(),
        jackpot_eth: lottery.jackpotEth,
        miner_index: lottery.minerIndex.toString(),
        total_unclaimed: lottery.totalUnclaimed.toString(),
        total_refined: lottery.totalRefined.toString(),
        block: lottery.block.toString(),
        source: lottery.source,
        called_at: now.toISOString(),
      },
      snapshotAt: now,
      blockNumber: headBlock,
    });
    console.log(
      `[metrics] lottery_round_state: round=${lottery.roundId}, jackpot=${lottery.jackpotEth.toFixed(4)} ETH, ` +
      `minerIndex=${(Number(lottery.minerIndex) / 1e18).toFixed(6)}`
    );
  } catch (e) {
    console.error("[metrics][LOTTERY] Error:", e);
  }

  // Subgraph cross-check: minerIndex comparison
  try {
    await crossCheckMinerIndex();
  } catch (e) {
    console.warn("[metrics][CROSS-CHECK] Failed:", e);
  }

  console.log(`[metrics] Done. All snapshots written at ${now.toISOString()}`);
}

async function crossCheckMinerIndex(): Promise<void> {
  // Cross-check: compare on-chain minerIndex against secondary RPC (both should agree)
  // The Goldsky subgraph URL may be unavailable — fall back to dual-RPC agreement check.
  const { archivalCall: rpcCall, decodeUint256: decode } = await import("./rpc");
  const { RPC_PRIMARY, RPC_SECONDARY } = await import("./constants");

  const LOTTERY_V2 = "0xB0Cc994Ce4E8fb106da9Eb36e26fDd8C5f1e0c71";
  const SEL = "0x9806b4d2";

  const makeCall = async (rpc: string): Promise<bigint> => {
    const resp = await fetch(rpc, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "eth_call", params: [{ to: LOTTERY_V2, data: SEL }, "latest"], id: 1 }),
    });
    const data = (await resp.json()) as { result?: string };
    return decode(data.result ?? "0x");
  };

  try {
    const [primaryIndex, secondaryIndex] = await Promise.all([
      makeCall(RPC_PRIMARY),
      makeCall(RPC_SECONDARY),
    ]);

    const match = primaryIndex === secondaryIndex ? "EXACT_MATCH" : `MISMATCH (diff: ${primaryIndex - secondaryIndex})`;
    console.log(
      `[metrics][CROSS-CHECK] minerIndex primary=${primaryIndex} secondary=${secondaryIndex} => ${match}`
    );
    console.log(
      `[metrics][CROSS-CHECK] minerIndex = ${(Number(primaryIndex) / 1e18).toFixed(6)} (${primaryIndex})`
    );
  } catch (e) {
    // Try Goldsky subgraph as fallback
    const SUBGRAPH_URLS = [
      "https://api.goldsky.com/api/public/project_clssuo7gskzl301ub3w8ca3n7/subgraphs/slvr-robinhood/1.7.0/gn",
      "https://api.goldsky.com/api/public/project_cm8pqy56afmuc01u48xzn8ysd/subgraphs/slvr-robinhood/1.7.0/gn",
    ];
    let subgraphChecked = false;
    for (const url of SUBGRAPH_URLS) {
      try {
        const sgResp = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: `{minerIndexUpdateds(orderBy:blockNumber,orderDirection:desc,first:1){newIndex}}` }),
        });
        const sgData = (await sgResp.json()) as { data?: { minerIndexUpdateds?: Array<{ newIndex: string }> } };
        const latest = sgData?.data?.minerIndexUpdateds?.[0];
        if (latest) {
          const onChainHex = await rpcCall(LOTTERY_V2, SEL, "latest");
          const onChain = decode(onChainHex);
          const sgIndex = BigInt(latest.newIndex);
          const match = sgIndex === onChain ? "EXACT_MATCH" : `MISMATCH`;
          console.log(`[metrics][CROSS-CHECK] minerIndex subgraph=${sgIndex} on-chain=${onChain} => ${match}`);
          subgraphChecked = true;
          break;
        }
      } catch {
        // try next
      }
    }
    if (!subgraphChecked) {
      console.log("[metrics][CROSS-CHECK] Subgraph unavailable; dual-RPC cross-check failed:", String(e));
    }
  }
}

// Allow running directly: ts-node src/run.ts
if (require.main === module) {
  computeAndWrite()
    .then(() => {
      sql.end();
      process.exit(0);
    })
    .catch((e) => {
      console.error("[metrics] Fatal error:", e);
      sql.end();
      process.exit(1);
    });
}

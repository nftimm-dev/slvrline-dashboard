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
import { computeStaking, type VeLock } from "./formulas/staking";
import { computeStakingApy } from "./formulas/stakingApy";
import { computeLpStakingApy } from "./formulas/lpStakingApy";
import { fetchEthUsdNow } from "./ethUsd";
import { computeLotteryRoundState } from "./formulas/lottery";
import { getHead } from "./block-resolver";
import { SLVR_CAP } from "./constants";

const SCALE = 1e18;
const TOP_LOCKERS = 100;

type TopLocker = {
  owner: string;
  amount: number;
  permanent: boolean;
  lockCount: number;
};

type SizeBucket = { range: string; count: number; totalSlvr: number };

/** Top N owners by aggregate active-lock amount (grouped, summed across their locks). */
function buildTopLockers(locks: VeLock[]): TopLocker[] {
  const byOwner = new Map<string, { amount: bigint; count: number; perm: number }>();
  for (const l of locks) {
    const cur = byOwner.get(l.owner) ?? { amount: 0n, count: 0, perm: 0 };
    cur.amount += l.amountRaw;
    cur.count += 1;
    if (l.permanent) cur.perm += 1;
    byOwner.set(l.owner, cur);
  }
  return [...byOwner.entries()]
    .map(([owner, agg]) => ({
      owner,
      amount: Number(agg.amount) / SCALE,
      // A locker is "permanent" iff ALL of their active locks are permanent.
      permanent: agg.perm === agg.count,
      lockCount: agg.count,
    }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, TOP_LOCKERS);
}

/** Histogram of lock sizes: <10 / 10–100 / 100–1k / 1k+ SLVR. */
function buildSizeBuckets(locks: VeLock[]): SizeBucket[] {
  const defs = [
    { range: "<10", lo: 0, hi: 10 },
    { range: "10–100", lo: 10, hi: 100 },
    { range: "100–1k", lo: 100, hi: 1000 },
    { range: "1k+", lo: 1000, hi: Infinity },
  ];
  const buckets: SizeBucket[] = defs.map((d) => ({ range: d.range, count: 0, totalSlvr: 0 }));
  for (const l of locks) {
    const amt = Number(l.amountRaw) / SCALE;
    const idx = defs.findIndex((d) => amt >= d.lo && amt < d.hi);
    const b = buckets[idx >= 0 ? idx : buckets.length - 1];
    b.count += 1;
    b.totalSlvr += amt;
  }
  return buckets;
}

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
        basis: "v2",
        method: "trailing_24h",
        window_hours: 24,
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

  // ---- staking_apr (veSLVR staking APY — ETH rewards yield) ----
  try {
    const apy = await computeStakingApy(headBlock);
    if (apy) {
      // SLVR price (USD) from the same on-chain pool ratio × live ETH/USD — stored
      // in value3 so the Staking APY chart can overlay it on a second axis.
      const ethUsd = await fetchEthUsdNow();
      const rawPrice =
        apy.slvrPerEth > 0 && ethUsd > 0 ? (1 / apy.slvrPerEth) * ethUsd : null;
      // Reject implausible prices (transient bad pool/ETH read) so the overlay
      // never spikes — SLVR lives well within [$0.01, $5000].
      const slvrPriceUsd =
        rawPrice !== null && rawPrice >= 0.01 && rawPrice <= 5000 ? rawPrice : null;
      await writeSnapshot({
        metricName: "staking_apr",
        value: apy.permanentAprPercent, // headline: permanent-lock APY
        value2: apy.baseAprPercent, // 1× (no-lock) base rate
        value3: slvrPriceUsd, // SLVR price in USD (overlay line)
        metadata: {
          by_lock: apy.byLock,
          window_days: apy.windowDays,
          slvr_per_eth: apy.slvrPerEth,
          slvr_price_usd: slvrPriceUsd,
          eth_usd: ethUsd,
          total_weight: apy.totalWeight,
          delta_rpw: apy.deltaRpw,
          permanent_multiplier: apy.permanentMultiplier,
          block: apy.block.toString(),
          reward_token: "ETH",
          method: "trailing_24h_pool_priced",
          source: "archival_eth_call",
        },
        snapshotAt: now,
        blockNumber: headBlock,
      });
      console.log(
        `[metrics] staking_apr: permanent ${apy.permanentAprPercent.toFixed(1)}% ` +
        `(base ${apy.baseAprPercent.toFixed(1)}%, ${apy.windowDays}d) | SLVR $${slvrPriceUsd?.toFixed(2) ?? "?"}`
      );
    } else {
      console.log("[metrics] staking_apr: NULL (no distributions / no pool price in window)");
    }
  } catch (e) {
    console.error("[metrics][staking_apr] Error:", e);
  }

  // ---- lp_staking_apr (Uniswap V4 LP-position staking APR — SLVR from sell tax) ----
  try {
    const lp = await computeLpStakingApy();
    if (lp) {
      await writeSnapshot({
        metricName: "lp_staking_apr",
        value: lp.aprPercent, // headline (blended) LP APR
        value2: lp.concentratedApr, // concentrated-cohort APR
        value3: lp.fullRangeApr, // full-range-cohort APR
        metadata: {
          concentrated_apr: lp.concentratedApr,
          fullrange_apr: lp.fullRangeApr,
          concentrated_value_eth: lp.concentratedValueEth,
          fullrange_value_eth: lp.fullRangeValueEth,
          concentrated_positions: lp.concentratedPositions,
          fullrange_positions: lp.fullRangePositions,
          staked_value_eth: lp.stakedValueEth,
          staked_eth: lp.stakedEth,
          staked_slvr: lp.stakedSlvr,
          reward_slvr_per_day: lp.rewardSlvrPerDay,
          position_count: lp.positionCount,
          staked_pct_of_pool: lp.stakedPctOfPool,
          staked_liquidity: lp.stakedLiquidity,
          pool_liquidity: lp.poolLiquidity,
          slvr_per_eth: lp.slvrPerEth,
          reward_token: "SLVR",
          method: "trailing_24h_selltax / exact_position_valuation",
          source: "onchain_v4_hook",
        },
        snapshotAt: now,
        blockNumber: headBlock,
      });
      console.log(
        `[metrics] lp_staking_apr: blended ${lp.aprPercent.toFixed(0)}% ` +
        `(concentrated ${lp.concentratedApr.toFixed(0)}% / full-range ${lp.fullRangeApr.toFixed(0)}%, ${lp.positionCount} pos)`
      );
    } else {
      console.log("[metrics] lp_staking_apr: NULL (mechanism inactive)");
    }
  } catch (e) {
    console.error("[metrics][lp_staking_apr] Error:", e);
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
        // Emitted = totalSupply + cumulative burns (permanent locks burn emitted SLVR).
        // The frontend progress bar reads emitted_pct (not totalSupply/cap).
        emitted_raw: supplyResult.emittedRaw.toString(),
        emitted_human: supplyResult.emittedHuman,
        emitted_pct: supplyResult.emittedPctOfCap, // fraction 0..1 (≈0.035)
        burned_raw: supplyResult.cumulativeBurnedRaw.toString(),
        burned_human: supplyResult.cumulativeBurnedHuman,
        burn_count: supplyResult.burnCount,
        source: "archival_eth_call",
        permanent_locked_note:
          "Permanent locks burn the underlying SLVR (RESEARCH.md §5) — absent from totalSupply(), so NOT subtracted from circulating. They ARE counted in emitted (totalSupply + cumulative burns).",
      },
      snapshotAt: now,
      blockNumber: headBlock,
    });
    console.log(
      `[metrics] circulating_supply: ${supplyResult.circulatingHuman.toFixed(4)} SLVR ` +
      `(total: ${supplyResult.totalHuman.toFixed(4)}, ` +
      `emitted: ${supplyResult.emittedHuman.toFixed(1)} = ${(supplyResult.emittedPctOfCap * 100).toFixed(2)}% of cap, ` +
      `burned: ${supplyResult.cumulativeBurnedHuman.toFixed(1)})`
    );
  } catch (e) {
    console.error("[metrics][SUPPLY] Error:", e);
  }

  // ---- 3. emission_rate_30d + 4. runway_months ----
  try {
    const runway = await computeRunway(headBlock);

    // emission_rate_30d now = GROSS SLVR emitted over the (≤30d) window.
    await writeSnapshot({
      metricName: "emission_rate_30d",
      value: Number(runway.grossEmittedRaw) / 1e18,
      value2: null,
      value3: null,
      metadata: {
        gross_emitted_raw: runway.grossEmittedRaw.toString(),
        emitted_now_raw: runway.emittedNowRaw.toString(),
        emitted_window_start_raw: runway.emittedWindowStartRaw.toString(),
        total_supply_now_raw: runway.totalSupplyNowRaw.toString(),
        window_days: runway.windowDays,
        block_now: runway.blockNow.toString(),
        block_window_start: runway.blockWindowStart.toString(),
        data_status: runway.dataStatus,
        source: "archival_eth_call",
        note: "GROSS emission over window = emitted(now) − emitted(windowStart); emitted = totalSupply + cumulative burns.",
      },
      snapshotAt: now,
      blockNumber: headBlock,
    });

    await writeSnapshot({
      metricName: "runway_months",
      value: runway.runwayMonths,
      value2: Number(runway.remainingCapRaw) / 1e18,
      value3: Number(runway.grossEmittedRaw) / 1e18,
      metadata: {
        remaining_cap_raw: runway.remainingCapRaw.toString(),
        emitted_now_raw: runway.emittedNowRaw.toString(),
        gross_emitted_raw: runway.grossEmittedRaw.toString(),
        per_day_gross_raw: runway.perDayGrossRaw.toString(),
        window_days: runway.windowDays,
        block_now: runway.blockNow.toString(),
        block_window_start: runway.blockWindowStart.toString(),
        data_status: runway.dataStatus,
        source: "archival_eth_call",
        note: "runway = (500K − emitted(now)) / per-day GROSS emission / 30.44.",
      },
      snapshotAt: now,
      blockNumber: headBlock,
    });

    console.log(
      `[metrics] emission_rate_30d (gross): ${(Number(runway.grossEmittedRaw) / 1e18).toFixed(4)} SLVR over ${runway.windowDays.toFixed(1)}d | ` +
      `runway: ${runway.runwayMonths?.toFixed(2) ?? "NULL"} months (${runway.dataStatus})`
    );
  } catch (e) {
    console.error("[metrics][RUNWAY] Error:", e);
  }

  // ---- 5. total_staked_slvr ----
  try {
    const staking = await computeStaking(headBlock);
    // Guard against degraded reads that would spike the chart down:
    //  - ve_balance_fallback: on-chain enumeration failed, so permanent locks (~90%
    //    of the total) are missing and `value` collapses to just the time-locked
    //    balance (this is the ~2k dip we saw).
    //  - totalLockedRaw == 0: nothing read at all.
    // In both cases skip the write and keep the last good snapshot — far more
    // accurate than persisting a partial value.
    if (staking.source === "ve_balance_fallback" || staking.totalLockedRaw <= 0n) {
      console.warn(
        `[metrics][STAKING] Skipping snapshot: degraded read ` +
        `(source=${staking.source}, totalLockedRaw=${staking.totalLockedRaw})`
      );
      throw new Error("staking read degraded — skipping snapshot");
    }
    // Build display-oriented rollups from the active-lock list so /api/staking can
    // serve the page instantly from the DB (no on-request chain enumeration).
    const topLockers = buildTopLockers(staking.activeLocks);
    const sizeBuckets = buildSizeBuckets(staking.activeLocks);
    await writeSnapshot({
      metricName: "total_staked_slvr",
      // value = total locked; value2 = PERMANENT (card's "N permanent" reads value2);
      // value3 = time-locked.
      value: Number(staking.totalLockedRaw) / 1e18,
      value2: Number(staking.permanentRaw) / 1e18,
      value3: Number(staking.timelockedRaw) / 1e18,
      metadata: {
        total_locked_raw: staking.totalLockedRaw.toString(),
        permanent_raw: staking.permanentRaw.toString(),
        timelocked_raw: staking.timelockedRaw.toString(),
        active_lock_count: staking.activeLockCount,
        lp_staked_raw: staking.lpStakedRaw.toString(),
        lp_staked_lp_tokens: staking.lpStakedHuman.toFixed(6),
        // Served directly by /api/staking (DB-backed, <100ms — no chain enumeration).
        top_lockers: topLockers,
        size_buckets: sizeBuckets,
        unique_owners: new Set(staking.activeLocks.map((l) => l.owner)).size,
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

// Allow running directly: ts-node src/run.ts. Guarded so importing computeAndWrite
// (e.g. from the Vercel cron route) does not execute the CLI path.
if (typeof require !== "undefined" && require.main === module) {
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

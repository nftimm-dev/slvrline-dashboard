/**
 * run.ts — Compute all metrics and write one snapshot row per metric.
 *
 * Metrics written (6 rows per run):
 *   1. dividends_apr        — 7-day rolling index-delta APR
 *   2. circulating_supply   — totalSupply() - excluded balances
 *   3. emission_cumulative  — total ever emitted + burned
 *   4. emission_rate_30d    — SLVR emitted in last 30 days
 *   5. runway_months        — months at current 30-day emission rate
 *   6. total_staked_slvr    — ve_lock totals
 *   7. lottery_round_state  — current round (eth_call)
 *
 * Each metric is wrapped in try/catch — a failure in one does not block others.
 * Partial/null values are expected while the indexer backfill is in progress.
 */

import { createPublicClient, http } from "viem";
import { sql } from "./db";
import { writeSnapshot } from "./snapshot";
import { computeDividendsApr } from "./formulas/apr";
import { computeSupply } from "./formulas/supply";
import { computeRunway } from "./formulas/runway";
import { computeStaking } from "./formulas/staking";
import { computeLotteryRoundState } from "./formulas/lottery";
import { RPC_URL, APR_WINDOW_SECONDS } from "./constants";

// Define a minimal chain for viem (Robinhood Chain id 4663)
const robinhoodChain = {
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
} as const;

function createViemClient() {
  return createPublicClient({
    chain: robinhoodChain,
    transport: http(RPC_URL, { timeout: 30_000 }),
  });
}

export async function computeAndWrite(asOfTime?: Date): Promise<void> {
  const viem = createViemClient();
  const now = asOfTime ?? new Date();

  // Get latest indexed block number (token_transfer is the densest table)
  const [blockRow] = await sql<[{ block_number: string | null }]>`
    SELECT MAX(block_number)::text AS block_number
    FROM slvr.token_transfer
  `;
  const latestBlock = BigInt(blockRow?.block_number ?? "0");

  console.log(`[metrics] Computing at ${now.toISOString()} | latest indexed block: ${latestBlock}`);

  // ---- 1. dividends_apr ----
  try {
    const apr = await computeDividendsApr(now);
    // Store APR as decimal ratio (e.g. 12.29 = 1229%). Multiply by 100 for percentage display.
    await writeSnapshot({
      metricName: "dividends_apr",
      value: apr.apr !== null ? apr.apr * 100 : null, // percent (e.g. 1229.4)
      value2: apr.deltaIndex !== null ? Number(apr.deltaIndex) : null,
      value3: APR_WINDOW_SECONDS, // annualization window in seconds (constant, for audit)
      metadata: {
        index_now: apr.indexNow?.toString() ?? null,
        index_7d_ago: apr.index7dAgo?.toString() ?? null,
        window_seconds: APR_WINDOW_SECONDS,
        contract_version: apr.contractVersion,
        block_now: apr.blockNow?.toString() ?? null,
        block_7d_ago: apr.block7dAgo?.toString() ?? null,
        data_status: apr.dataStatus,
      },
      snapshotAt: now,
      blockNumber: latestBlock,
    });
    console.log(`[metrics] dividends_apr: ${apr.apr !== null ? (apr.apr * 100).toFixed(2) + "%" : "NULL"} (${apr.dataStatus})`);
  } catch (e) {
    console.error("[metrics][APR] Error:", e);
  }

  // ---- 2. circulating_supply + 3. emission_cumulative ----
  // Compute supply once; write two metric rows from the same result
  let supplyResult: Awaited<ReturnType<typeof computeSupply>> | null = null;
  try {
    supplyResult = await computeSupply(now, viem);

    // 2a. circulating_supply
    await writeSnapshot({
      metricName: "circulating_supply",
      value: supplyResult.circulatingHuman,
      value2: supplyResult.totalHuman,
      value3: supplyResult.burnedHuman,
      metadata: {
        total_supply_raw: supplyResult.totalSupplyRaw.toString(),
        burned_raw: supplyResult.burnedRaw.toString(),
        excluded_balances: Object.fromEntries(
          Object.entries(supplyResult.excludedBalances).map(([k, v]) => [k, v.toString()])
        ),
        on_chain_cs_raw: supplyResult.onChainCirculatingRaw?.toString() ?? null,
        deployer_balance: supplyResult.deployerBalance.toString(),
        permanent_locked_note: supplyResult.permanentLockedNote,
      },
      snapshotAt: now,
      blockNumber: latestBlock,
    });
    console.log(`[metrics] circulating_supply: ${supplyResult.circulatingHuman.toFixed(4)} SLVR`);
  } catch (e) {
    console.error("[metrics][SUPPLY] Error:", e);
  }

  // ---- 3. emission_cumulative ----
  try {
    // totalHuman ≈ total currently in existence (not total ever minted)
    // For "total emitted ever", use the runway computation's totalEmittedRaw
    const runway = await computeRunway(now);
    const totalEmittedHuman = Number(runway.totalEmittedRaw) / 1e18;
    const burnedHuman = supplyResult?.burnedHuman ?? 0;

    await writeSnapshot({
      metricName: "emission_cumulative",
      value: totalEmittedHuman,    // total SLVR ever minted
      value2: burnedHuman,         // total SLVR ever burned
      value3: null,
      metadata: {
        total_emitted_raw: runway.totalEmittedRaw.toString(),
        burned_raw: supplyResult?.burnedRaw.toString() ?? null,
        net_in_existence: (totalEmittedHuman - burnedHuman).toFixed(4),
        source: "token_transfer.is_mint for emitted; token_burn.amount for burned",
      },
      snapshotAt: now,
      blockNumber: latestBlock,
    });
    console.log(`[metrics] emission_cumulative: ${totalEmittedHuman.toFixed(4)} emitted, ${burnedHuman.toFixed(4)} burned`);

    // ---- 4. runway_months ----
    await writeSnapshot({
      metricName: "runway_months",
      value: runway.runwayMonths,
      value2: Number(runway.remainingCapRaw) / 1e18,
      value3: Number(runway.rate30dRaw) / 1e18,
      metadata: {
        remaining_cap_raw: runway.remainingCapRaw.toString(),
        total_emitted_raw: runway.totalEmittedRaw.toString(),
        rate_30d_raw: runway.rate30dRaw.toString(),
        hub_configured_rate_per_sec: runway.hubConfiguredRatePerSec?.toString() ?? null,
        data_status: runway.dataStatus,
      },
      snapshotAt: now,
      blockNumber: latestBlock,
    });
    console.log(`[metrics] runway_months: ${runway.runwayMonths?.toFixed(2) ?? "NULL"} months (${runway.dataStatus})`);
  } catch (e) {
    console.error("[metrics][RUNWAY/EMISSION_CUMULATIVE] Error:", e);
  }

  // ---- 5. emission_rate_30d ----
  try {
    const runway = await computeRunway(now);
    await writeSnapshot({
      metricName: "emission_rate_30d",
      value: Number(runway.rate30dRaw) / 1e18,
      value2: null,
      value3: null,
      metadata: {
        rate_30d_raw: runway.rate30dRaw.toString(),
        from_time: new Date((Math.floor(now.getTime() / 1000) - 30 * 24 * 3600) * 1000).toISOString(),
        to_time: now.toISOString(),
        data_status: runway.dataStatus,
      },
      snapshotAt: now,
      blockNumber: latestBlock,
    });
    console.log(`[metrics] emission_rate_30d: ${(Number(runway.rate30dRaw) / 1e18).toFixed(4)} SLVR/30d`);
  } catch (e) {
    console.error("[metrics][EMISSION_RATE_30D] Error:", e);
  }

  // ---- 6. total_staked_slvr ----
  try {
    const staking = await computeStaking(now);
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
        lp_note: staking.lpTotalNote,
      },
      snapshotAt: now,
      blockNumber: latestBlock,
    });
    console.log(`[metrics] total_staked_slvr: ${(Number(staking.totalLockedRaw) / 1e18).toFixed(4)} SLVR (${staking.activeLockCount} locks)`);
  } catch (e) {
    console.error("[metrics][STAKING] Error:", e);
  }

  // ---- 7. lottery_round_state ----
  try {
    const lottery = await computeLotteryRoundState(viem);
    await writeSnapshot({
      metricName: "lottery_round_state",
      value: lottery.roundId,
      value2: lottery.activeBetCount,
      value3: lottery.jackpotEth,
      metadata: {
        round_id: lottery.roundId,
        bet_count: lottery.activeBetCount,
        jackpot_wei: lottery.jackpotWei.toString(),
        jackpot_eth: lottery.jackpotEth,
        source: lottery.source,
        called_at: now.toISOString(),
      },
      snapshotAt: now,
      blockNumber: latestBlock,
    });
    console.log(`[metrics] lottery_round_state: round=${lottery.roundId}, bets=${lottery.activeBetCount}, jackpot=${lottery.jackpotEth.toFixed(4)} ETH`);
  } catch (e) {
    console.error("[metrics][LOTTERY] Error:", e);
  }

  console.log(`[metrics] Done. All snapshots written at ${now.toISOString()}`);
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

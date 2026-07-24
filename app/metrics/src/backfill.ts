/**
 * backfill.ts — Historical snapshot backfill.
 *
 * Walks indexed block history from earliest_block_time to now in 1-hour steps,
 * computing all metrics for each hourly slot and writing to metrics.metric_snapshots.
 *
 * Usage:
 *   ts-node src/backfill.ts
 *   ts-node src/backfill.ts --from=2026-07-09T00:00:00Z --to=2026-07-24T00:00:00Z
 *
 * Idempotent: existing rows are skipped (ON CONFLICT DO NOTHING via writeSnapshot backfill=true).
 *
 * DO NOT run this manually — the orchestrator runs it after the indexer backfill completes.
 *
 * Lottery round state during backfill:
 *   eth_call is not usable for historical times. Use lottery_round indexed data to find
 *   the latest canonical round resolved at or before slot time T.
 */

import { createPublicClient, http } from "viem";
import { sql } from "./db";
import { writeSnapshot } from "./snapshot";
import { computeDividendsApr } from "./formulas/apr";
import { computeSupply } from "./formulas/supply";
import { computeRunway } from "./formulas/runway";
import { RPC_URL, LOTTERY_V2 } from "./constants";

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

async function writeBackfillSnapshot(t: Date, blockAtT: bigint, viemClient: ReturnType<typeof createViemClient>): Promise<void> {
  const slotEpoch = Math.floor(t.getTime() / 1000);

  // 1. dividends_apr
  try {
    const apr = await computeDividendsApr(t);
    await writeSnapshot({
      metricName: "dividends_apr",
      value: apr.apr !== null ? apr.apr * 100 : null,
      value2: apr.deltaIndex !== null ? Number(apr.deltaIndex) : null,
      value3: null,
      metadata: {
        index_now: apr.indexNow?.toString() ?? null,
        index_7d_ago: apr.index7dAgo?.toString() ?? null,
        window_seconds: 604800,
        contract_version: apr.contractVersion,
        block_now: apr.blockNow?.toString() ?? null,
        block_7d_ago: apr.block7dAgo?.toString() ?? null,
        data_status: apr.dataStatus,
        backfill: true,
      },
      snapshotAt: t,
      blockNumber: blockAtT,
      backfill: true,
    });
  } catch (e) {
    console.error(`[backfill][APR] ${t.toISOString()}:`, e);
  }

  // 2. circulating_supply
  try {
    const supply = await computeSupply(t, viemClient);
    await writeSnapshot({
      metricName: "circulating_supply",
      value: supply.circulatingHuman,
      value2: supply.totalHuman,
      value3: supply.burnedHuman,
      metadata: {
        total_supply_raw: supply.totalSupplyRaw.toString(),
        burned_raw: supply.burnedRaw.toString(),
        excluded_balances: Object.fromEntries(
          Object.entries(supply.excludedBalances).map(([k, v]) => [k, v.toString()])
        ),
        permanent_locked_note: supply.permanentLockedNote,
        backfill: true,
        note: "eth_call values are live (not historical); token_burn uses block_time filter",
      },
      snapshotAt: t,
      blockNumber: blockAtT,
      backfill: true,
    });
  } catch (e) {
    console.error(`[backfill][SUPPLY] ${t.toISOString()}:`, e);
  }

  // 3. emission_cumulative + 4. runway_months + 5. emission_rate_30d
  try {
    const runway = await computeRunway(t);
    const totalEmittedHuman = Number(runway.totalEmittedRaw) / 1e18;

    await writeSnapshot({
      metricName: "emission_cumulative",
      value: totalEmittedHuman,
      value2: null,
      value3: null,
      metadata: {
        total_emitted_raw: runway.totalEmittedRaw.toString(),
        backfill: true,
      },
      snapshotAt: t,
      blockNumber: blockAtT,
      backfill: true,
    });

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
        backfill: true,
      },
      snapshotAt: t,
      blockNumber: blockAtT,
      backfill: true,
    });

    await writeSnapshot({
      metricName: "emission_rate_30d",
      value: Number(runway.rate30dRaw) / 1e18,
      value2: null,
      value3: null,
      metadata: {
        rate_30d_raw: runway.rate30dRaw.toString(),
        data_status: runway.dataStatus,
        backfill: true,
      },
      snapshotAt: t,
      blockNumber: blockAtT,
      backfill: true,
    });
  } catch (e) {
    console.error(`[backfill][RUNWAY] ${t.toISOString()}:`, e);
  }

  // 6. total_staked_slvr — use ve_lock_event for historical reconstruction
  try {
    const [stakingRow] = await sql<[{
      total_locked: string | null;
      timelocked: string | null;
      permanent: string | null;
      lock_count: string | null;
    }]>`
      SELECT
        SUM(CASE WHEN net > 0 THEN net ELSE 0 END)::text                                       AS total_locked,
        SUM(CASE WHEN net > 0 AND NOT COALESCE(is_permanent, false) THEN net ELSE 0 END)::text AS timelocked,
        SUM(CASE WHEN net > 0 AND COALESCE(is_permanent, false) THEN net ELSE 0 END)::text     AS permanent,
        COUNT(CASE WHEN net > 0 THEN 1 END)::text                                              AS lock_count
      FROM (
        SELECT
          token_id,
          SUM(COALESCE(amount_delta, 0)) AS net,
          BOOL_OR(COALESCE(is_permanent, false)) AS is_permanent
        FROM slvr.ve_lock_event
        WHERE block_time <= ${slotEpoch}
        GROUP BY token_id
      ) sub
    `;

    await writeSnapshot({
      metricName: "total_staked_slvr",
      value: Number(stakingRow?.total_locked ?? "0") / 1e18,
      value2: Number(stakingRow?.timelocked ?? "0") / 1e18,
      value3: Number(stakingRow?.permanent ?? "0") / 1e18,
      metadata: {
        total_locked_raw: stakingRow?.total_locked ?? "0",
        timelocked_raw: stakingRow?.timelocked ?? "0",
        permanent_raw: stakingRow?.permanent ?? "0",
        active_lock_count: Number(stakingRow?.lock_count ?? 0),
        backfill: true,
        source: "ve_lock_event historical reconstruction",
      },
      snapshotAt: t,
      blockNumber: blockAtT,
      backfill: true,
    });
  } catch (e) {
    console.error(`[backfill][STAKING] ${t.toISOString()}:`, e);
  }

  // 7. lottery_round_state — use indexed canonical rounds (eth_call not usable for historical)
  try {
    const [roundRow] = await sql<[{ round_id: string | null }]>`
      SELECT MAX(round_id)::text AS round_id
      FROM slvr.lottery_round
      WHERE is_canonical = true
        AND block_time <= ${slotEpoch}
    `;
    const historicalRoundId = Number(roundRow?.round_id ?? "0");

    await writeSnapshot({
      metricName: "lottery_round_state",
      value: historicalRoundId,
      value2: null, // bet count not available for historical
      value3: null, // jackpot not available for historical
      metadata: {
        round_id: historicalRoundId,
        source: "historical_indexed",
        note: "bet_count and jackpot_eth not available for historical snapshots",
        backfill: true,
      },
      snapshotAt: t,
      blockNumber: blockAtT,
      backfill: true,
    });
  } catch (e) {
    console.error(`[backfill][LOTTERY] ${t.toISOString()}:`, e);
  }
}

async function backfill(fromDate: Date, toDate: Date): Promise<void> {
  const viemClient = createViemClient();
  const slotMs = 60 * 60 * 1000; // 1 hour
  let t = new Date(Math.floor(fromDate.getTime() / slotMs) * slotMs);

  let processed = 0;
  let skipped = 0;

  console.log(`[backfill] Starting: ${fromDate.toISOString()} → ${toDate.toISOString()}`);
  console.log(`[backfill] Step: 1 hour | Expected slots: ~${Math.ceil((toDate.getTime() - fromDate.getTime()) / slotMs)}`);

  while (t <= toDate) {
    const slotEpoch = Math.floor(t.getTime() / 1000);

    // Find latest block_number at or before slot time
    const [blockRow] = await sql<[{ block_number: string | null }]>`
      SELECT block_number::text AS block_number
      FROM slvr.token_transfer
      WHERE block_time <= ${slotEpoch}
      ORDER BY block_number DESC
      LIMIT 1
    `;

    if (!blockRow?.block_number) {
      // No indexed data at or before this slot — skip
      t = new Date(t.getTime() + slotMs);
      continue;
    }

    const blockAtT = BigInt(blockRow.block_number);

    // Check if this slot is already backfilled (check dividends_apr as representative)
    const [existing] = await sql<[{ id: string }]>`
      SELECT id::text
      FROM metrics.metric_snapshots
      WHERE metric_name = 'dividends_apr'
        AND snapshot_at = ${t}
      LIMIT 1
    `;

    if (existing) {
      skipped++;
      t = new Date(t.getTime() + slotMs);
      continue;
    }

    await writeBackfillSnapshot(t, blockAtT, viemClient);
    processed++;
    console.log(`[backfill] ${t.toISOString()} block=${blockAtT} (processed=${processed}, skipped=${skipped})`);

    t = new Date(t.getTime() + slotMs);
  }

  console.log(`[backfill] Complete. Processed: ${processed}, Skipped (already existed): ${skipped}`);
}

// CLI entry point
async function main() {
  const args = process.argv.slice(2);
  const fromArg = args.find((a) => a.startsWith("--from="))?.slice(7);
  const toArg = args.find((a) => a.startsWith("--to="))?.slice(5);

  // Default: from earliest token_transfer block_time to now
  let fromDate: Date;
  if (fromArg) {
    fromDate = new Date(fromArg);
  } else {
    const [earliestRow] = await sql<[{ min_time: number | null }]>`
      SELECT MIN(block_time) AS min_time FROM slvr.token_transfer
    `;
    fromDate = earliestRow?.min_time ? new Date(earliestRow.min_time * 1000) : new Date();
  }

  const toDate = toArg ? new Date(toArg) : new Date();

  if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
    console.error("[backfill] Invalid date arguments");
    process.exit(1);
  }

  try {
    await backfill(fromDate, toDate);
  } finally {
    await sql.end();
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error("[backfill] Fatal:", e);
    process.exit(1);
  });
}

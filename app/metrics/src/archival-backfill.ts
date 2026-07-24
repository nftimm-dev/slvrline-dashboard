/**
 * archival-backfill.ts — Historical metric snapshot backfill via archival eth_call.
 *
 * Samples chain from genesis (block 5,574,774) to head at 2-hour cadence.
 * At ~100ms/block, 2h = ~72,000 blocks → 15 days / 2h = ~180 sample points.
 * ~8 eth_calls per sample → ~1,440 total calls → finishes in ~15-20 minutes.
 *
 * At each sample block writes time-series rows for:
 *   - total_supply (totalSupply at that block)
 *   - circulating_supply
 *   - emission_rate_30d (supply diff vs 30d-prior block)
 *   - runway_months
 *   - dividends_apr (minerIndex delta; NULL where 7d window precedes V2 deploy)
 *   - total_staked_slvr (LP staked at that block)
 *   - lottery_round_state (currentRoundId at that block)
 *
 * Idempotent: ON CONFLICT DO NOTHING skips already-written rows.
 *
 * Usage:
 *   ts-node src/archival-backfill.ts
 *   ts-node src/archival-backfill.ts --dry-run   (compute sample blocks, no writes)
 */

import { sql } from "./db";
import { writeSnapshot } from "./snapshot";
import { computeDividendsApr } from "./formulas/apr";
import { computeSupply } from "./formulas/supply";
import { computeRunway } from "./formulas/runway";
import { archivalCall, decodeUint256 } from "./rpc";
import { getHead, generateSampleBlocks } from "./block-resolver";
import {
  LOTTERY_V2,
  SLVR_CAP,
  APR_WINDOW_SECONDS,
  BACKFILL_STEP_SECONDS,
  LP_STAKING,
} from "./constants";

const CURRENT_ROUND_ID_SEL = "0x9cbe5efd";
const LP_TOTAL_STAKED_SEL = "0x817b1cd2";

async function writeBackfillSlot(
  block: bigint,
  timestamp: bigint,
  dryRun: boolean,
  slotIdx: number,
  total: number,
  cachedLpStakedRaw: bigint
): Promise<void> {
  const snapshotAt = new Date(Number(timestamp) * 1000);
  const prefix = `[backfill][${slotIdx}/${total}] block=${block} ts=${snapshotAt.toISOString()}`;
  console.log(prefix);

  if (dryRun) return;

  // Run all independent archival calls for this slot in parallel
  // 1. supply: totalSupply + balanceOf x3 + getCirculatingSupply
  // 2. runway: totalSupply@block + totalSupply@30d-ago-block
  // 3. apr: minerIndex@block + minerIndex@7d-ago-block
  // 4. lottery: currentRoundId@block
  // These are parallelized where possible.

  // Parallel batch 1: supply + lottery (no cross-dependencies)
  const [supplyResult, roundIdHex] = await Promise.allSettled([
    computeSupply(block),
    archivalCall(LOTTERY_V2, CURRENT_ROUND_ID_SEL, block),
  ]);

  // Write supply
  if (supplyResult.status === "fulfilled") {
    const supply = supplyResult.value;
    await writeSnapshot({
      metricName: "circulating_supply",
      value: supply.circulatingHuman,
      value2: supply.totalHuman,
      value3: Number(SLVR_CAP) / 1e18,
      metadata: {
        total_supply_raw: supply.totalSupplyRaw.toString(),
        excluded_raw: supply.excludedRaw.toString(),
        circulating_raw: supply.circulatingRaw.toString(),
        on_chain_cs_raw: supply.onChainCirculatingRaw?.toString() ?? null,
        block: block.toString(),
        source: "archival_backfill",
      },
      snapshotAt,
      blockNumber: block,
      backfill: true,
    });
  } else {
    console.error(`${prefix} [supply] Error:`, String(supplyResult.reason));
  }

  // Write lottery round state
  if (roundIdHex.status === "fulfilled") {
    const roundId = Number(decodeUint256(roundIdHex.value));
    await writeSnapshot({
      metricName: "lottery_round_state",
      value: roundId,
      value2: null,
      value3: null,
      metadata: {
        round_id: roundId,
        block: block.toString(),
        source: "archival_backfill",
      },
      snapshotAt,
      blockNumber: block,
      backfill: true,
    });
  } else {
    console.error(`${prefix} [lottery] Error:`, String(roundIdHex.reason));
  }

  // Parallel batch 2: runway + apr (each needs 2 archival calls)
  const [runwayResult, aprResult] = await Promise.allSettled([
    computeRunway(block),
    computeDividendsApr(block),
  ]);

  if (runwayResult.status === "fulfilled") {
    const runway = runwayResult.value;
    await Promise.all([
      writeSnapshot({
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
          source: "archival_backfill",
        },
        snapshotAt,
        blockNumber: block,
        backfill: true,
      }),
      writeSnapshot({
        metricName: "runway_months",
        value: runway.runwayMonths,
        value2: Number(runway.remainingCapRaw) / 1e18,
        value3: Number(runway.emissionRate30dRaw) / 1e18,
        metadata: {
          remaining_cap_raw: runway.remainingCapRaw.toString(),
          emission_rate_30d_raw: runway.emissionRate30dRaw.toString(),
          block: block.toString(),
          data_status: runway.dataStatus,
          source: "archival_backfill",
        },
        snapshotAt,
        blockNumber: block,
        backfill: true,
      }),
    ]);
  } else {
    console.error(`${prefix} [runway] Error:`, String(runwayResult.reason));
  }

  if (aprResult.status === "fulfilled") {
    const apr = aprResult.value;
    await writeSnapshot({
      metricName: "dividends_apr",
      value: apr.aprPercent,
      value2: apr.deltaIndex !== null ? Number(apr.deltaIndex) / 1e18 : null,
      value3: APR_WINDOW_SECONDS,
      metadata: {
        index_now: apr.indexNow?.toString() ?? null,
        index_7d_ago: apr.index7dAgo?.toString() ?? null,
        block_now: apr.blockNow?.toString() ?? null,
        block_7d_ago: apr.block7dAgo?.toString() ?? null,
        data_status: apr.dataStatus,
        source: "archival_backfill",
      },
      snapshotAt,
      blockNumber: block,
      backfill: true,
    });
  } else {
    console.error(`${prefix} [apr] Error:`, String(aprResult.reason));
  }

  // 4. Staking: use cached LP value + ve balance at this block (no getLogs per slot)
  try {
    // For LP staking at historical block
    let lpStakedAtBlock = cachedLpStakedRaw;
    try {
      const lpHex = await archivalCall(LP_STAKING, LP_TOTAL_STAKED_SEL, block);
      lpStakedAtBlock = decodeUint256(lpHex);
    } catch {
      // use cached value
    }

    await writeSnapshot({
      metricName: "total_staked_slvr",
      value: null, // ve_lock total not computed per-slot in backfill (too many getLogs)
      value2: null,
      value3: null,
      metadata: {
        lp_staked_raw: lpStakedAtBlock.toString(),
        lp_staked_lp_tokens: (Number(lpStakedAtBlock) / 1e18).toFixed(6),
        block: block.toString(),
        source: "archival_backfill",
        note: "ve_lock total not available per-slot; use current snapshot for ve breakdown",
      },
      snapshotAt,
      blockNumber: block,
      backfill: true,
    });
  } catch (e) {
    console.error(`${prefix} [staking] Error:`, String(e));
  }
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");

  if (dryRun) {
    console.log("[backfill] DRY RUN — will compute sample blocks but not write to DB");
  }

  console.log("[backfill] Fetching chain head...");
  const head = await getHead();
  console.log(`[backfill] Head: block=${head.block} ts=${new Date(Number(head.timestamp) * 1000).toISOString()}`);

  console.log(`[backfill] Generating sample blocks at ${BACKFILL_STEP_SECONDS}s cadence...`);
  const samples = await generateSampleBlocks(BACKFILL_STEP_SECONDS);
  console.log(`[backfill] ${samples.length} sample blocks generated`);

  if (dryRun) {
    for (const s of samples) {
      console.log(`  block=${s.block} ts=${new Date(Number(s.timestamp) * 1000).toISOString()}`);
    }
    await sql.end();
    return;
  }

  // Check existing backfill rows to skip already-done slots
  const [existingRow] = await sql<[{ cnt: string }]>`
    SELECT COUNT(*)::text AS cnt FROM metrics.metric_snapshots WHERE metadata->>'source' LIKE 'archival%'
  `;
  console.log(`[backfill] Existing archival rows: ${existingRow?.cnt ?? 0}`);

  // Fetch LP staked once at head — use as fallback for historical slots
  let cachedLpStakedRaw = 0n;
  try {
    const lpHex = await archivalCall(LP_STAKING, LP_TOTAL_STAKED_SEL, "latest");
    cachedLpStakedRaw = decodeUint256(lpHex);
    console.log(`[backfill] LP staked at head: ${(Number(cachedLpStakedRaw) / 1e18).toFixed(4)} LP tokens`);
  } catch (e) {
    console.warn("[backfill] Could not fetch LP staked at head:", String(e));
  }

  let processed = 0;
  let skipped = 0;
  const t0 = Date.now();

  for (let i = 0; i < samples.length; i++) {
    const { block, timestamp } = samples[i];

    // Check if this block is already backfilled
    const [existing] = await sql<[{ id: string }]>`
      SELECT id::text FROM metrics.metric_snapshots
      WHERE metric_name = 'circulating_supply'
        AND block_number = ${block.toString()}
      LIMIT 1
    `;

    if (existing) {
      skipped++;
      continue;
    }

    await writeBackfillSlot(block, timestamp, dryRun, i + 1, samples.length, cachedLpStakedRaw);
    processed++;

    const elapsed = (Date.now() - t0) / 1000;
    const rate = processed / elapsed;
    const remaining = samples.length - i - 1;
    const etaSec = rate > 0 ? remaining / rate : 0;
    console.log(
      `[backfill] ${i + 1}/${samples.length} done | elapsed: ${elapsed.toFixed(0)}s | ETA: ${etaSec.toFixed(0)}s`
    );
  }

  console.log(`[backfill] Complete. Processed: ${processed}, Skipped (existing): ${skipped}`);

  // Print summary table
  const rows = await sql<Array<{ metric_name: string; cnt: string; min_date: string; max_ts: string }>>`
    SELECT metric_name, count(*)::text AS cnt, min(snapshot_at)::date::text AS min_date, max(snapshot_at)::text AS max_ts
    FROM metrics.metric_snapshots
    GROUP BY 1
    ORDER BY 1
  `;
  console.log("\n--- metric_snapshots summary ---");
  for (const r of rows) {
    console.log(`  ${r.metric_name.padEnd(25)} count=${r.cnt.padStart(4)} from=${r.min_date} to=${r.max_ts}`);
  }

  await sql.end();
}

if (require.main === module) {
  main().catch((e) => {
    console.error("[backfill] Fatal:", e);
    process.exit(1);
  });
}

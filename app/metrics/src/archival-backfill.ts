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
 *   - dividends_apr (per-contract rolling APR; V1 for pre-migration, V2 post-migration)
 *   - total_staked_slvr (LP staked at that block)
 *   - lottery_round_state (currentRoundId at that block)
 *
 * APR routing (honest per-contract accumulators):
 *   - block < 16,764,101 → GridLotteryV1 minerIndex; window = min(7d, V1 age)
 *   - block >= 16,764,101 → GridLotteryV2 minerIndex; window = min(7d, V2 age)
 *   Mixing V1 and V2 indices is INVALID — they are separate accumulators.
 *   This yields a continuous, honest chart with a visible reset/ramp at migration.
 *
 * Idempotent: ON CONFLICT DO NOTHING skips already-written rows.
 *
 * Usage:
 *   ts-node src/archival-backfill.ts
 *   ts-node src/archival-backfill.ts --dry-run     (compute sample blocks, no writes)
 *   ts-node src/archival-backfill.ts --apr-only    (overwrite null dividends_apr rows only)
 */

import {
  encodeAbiParameters,
  decodeAbiParameters,
  parseAbiParameters,
  toFunctionSelector,
} from "viem";
import { sql } from "./db";
import { writeSnapshot } from "./snapshot";
import { computeHistoricalAprForBlock } from "./formulas/apr";
import { computeSupply } from "./formulas/supply";
import { computeRunway } from "./formulas/runway";
import { computeStakingApy } from "./formulas/stakingApy";
import { computeLpStakingApy } from "./formulas/lpStakingApy";
import { fetchBuybackEvents } from "./formulas/buybacks";
import { fetchEthUsdHistory, nearestUsd } from "./ethUsd";
import { archivalCall, archivalGetBlock, decodeUint256, getLogsAdaptive, TRANSFER_TOPIC0, ZERO_TOPIC } from "./rpc";
import { getHead, generateSampleBlocks } from "./block-resolver";
import { aggregate3, type Call3 } from "./multicall";
import {
  LOTTERY_V2,
  SLVR_CAP,
  APR_WINDOW_SECONDS,
  BACKFILL_STEP_SECONDS,
  LP_STAKING,
  VOTE_ESCROW,
  DEPLOY_BLOCK_TOKEN,
  DEPLOY_BLOCK_BUYBACK,
  APPROX_BLOCKS_PER_SEC,
} from "./constants";

const CURRENT_ROUND_ID_SEL = "0x9cbe5efd";
const LP_TOTAL_STAKED_SEL = "0x817b1cd2";

async function writeBackfillSlot(
  block: bigint,
  timestamp: bigint,
  dryRun: boolean,
  slotIdx: number,
  total: number,
  cachedLpStakedRaw: bigint,
  scanToBlock: bigint,
  aprOnly = false
): Promise<void> {
  const snapshotAt = new Date(Number(timestamp) * 1000);
  const prefix = `[backfill][${slotIdx}/${total}] block=${block} ts=${snapshotAt.toISOString()}`;
  console.log(prefix);

  if (dryRun) return;

  // APR-only mode: only (re)compute and write the dividends_apr row
  if (aprOnly) {
    const aprResult = await (async () => {
      try {
        return await computeHistoricalAprForBlock(block, timestamp);
      } catch (e) {
        console.error(`${prefix} [apr] Error:`, String(e));
        return null;
      }
    })();
    if (aprResult) {
      // Upsert: delete existing null row and insert fresh, or just insert for blocks with no row
      await sql`
        DELETE FROM metrics.metric_snapshots
        WHERE metric_name = 'dividends_apr'
          AND block_number = ${block.toString()}
          AND value IS NULL
      `;
      await sql`
        INSERT INTO metrics.metric_snapshots
          (metric_name, value, value2, value3, metadata, snapshot_at, block_number)
        VALUES (
          'dividends_apr',
          ${aprResult.aprPercent},
          ${aprResult.deltaIndex !== null ? Number(aprResult.deltaIndex) / 1e18 : null},
          ${aprResult.windowSeconds},
          ${sql.json({
            index_now: aprResult.indexNow?.toString() ?? null,
            index_window_start: aprResult.indexWindowStart?.toString() ?? null,
            block_now: aprResult.blockNow?.toString() ?? null,
            block_window_start: aprResult.blockWindowStart?.toString() ?? null,
            ts_window_start: aprResult.tsWindowStart?.toString() ?? null,
            window_seconds: aprResult.windowSeconds,
            window_days: aprResult.windowDays,
            contract_version: aprResult.contractVersion,
            data_status: aprResult.dataStatus,
            source: "archival_backfill",
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any)},
          ${new Date(Number(timestamp) * 1000)},
          ${block.toString()}
        )
        ON CONFLICT DO NOTHING
      `;
      console.log(
        `${prefix} [apr] ${aprResult.aprPercent !== null ? aprResult.aprPercent.toFixed(2) + "%" : "null"} ` +
        `(${aprResult.dataStatus}, ${aprResult.windowDays}d, ${aprResult.contractVersion})`
      );
    }
    return;
  }

  // Run all independent archival calls for this slot in parallel
  // 1. supply: totalSupply + balanceOf x3 + getCirculatingSupply
  // 2. runway: totalSupply@block + totalSupply@30d-ago-block
  // 3. apr: minerIndex@block + minerIndex@window-start-block (V1 or V2 per routing)
  // 4. lottery: currentRoundId@block
  // These are parallelized where possible.

  // Parallel batch 1: supply + lottery (no cross-dependencies).
  // scanToBlock (=head) makes every slot reuse a single cached burn-log scan.
  const [supplyResult, roundIdHex] = await Promise.allSettled([
    computeSupply(block, scanToBlock),
    archivalCall(LOTTERY_V2, CURRENT_ROUND_ID_SEL, block),
  ]);

  // Write supply (+ emitted accounting)
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
        emitted_raw: supply.emittedRaw.toString(),
        emitted_human: supply.emittedHuman,
        emitted_pct: supply.emittedPctOfCap,
        burned_raw: supply.cumulativeBurnedRaw.toString(),
        burned_human: supply.cumulativeBurnedHuman,
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

  // Parallel batch 2: runway + apr. Runway shares the cached burn scan via scanToBlock.
  const [runwayResult, aprResult] = await Promise.allSettled([
    computeRunway(block, scanToBlock),
    computeHistoricalAprForBlock(block, timestamp),
  ]);

  if (runwayResult.status === "fulfilled") {
    const runway = runwayResult.value;
    await Promise.all([
      writeSnapshot({
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
        value3: Number(runway.grossEmittedRaw) / 1e18,
        metadata: {
          remaining_cap_raw: runway.remainingCapRaw.toString(),
          emitted_now_raw: runway.emittedNowRaw.toString(),
          gross_emitted_raw: runway.grossEmittedRaw.toString(),
          window_days: runway.windowDays,
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
      value3: apr.windowSeconds,
      metadata: {
        index_now: apr.indexNow?.toString() ?? null,
        index_window_start: apr.indexWindowStart?.toString() ?? null,
        block_now: apr.blockNow?.toString() ?? null,
        block_window_start: apr.blockWindowStart?.toString() ?? null,
        ts_window_start: apr.tsWindowStart?.toString() ?? null,
        window_seconds: apr.windowSeconds,
        window_days: apr.windowDays,
        contract_version: apr.contractVersion,
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

/**
 * APR-only backfill: re-compute dividends_apr for all existing backfill sample blocks.
 * Deletes null APR rows and inserts correct values using per-contract routing (V1/V2).
 */
async function aprOnlyBackfill(samples: Array<{ block: bigint; timestamp: bigint }>): Promise<void> {
  console.log(`[backfill][apr-only] Starting APR backfill for ${samples.length} sample blocks`);
  console.log("[backfill][apr-only] Routing: block < 16,764,101 → V1 accumulator; >= 16,764,101 → V2 accumulator");

  let processed = 0;
  const t0 = Date.now();

  for (let i = 0; i < samples.length; i++) {
    const { block, timestamp } = samples[i];
    try {
      await writeBackfillSlot(block, timestamp, false, i + 1, samples.length, 0n, 0n, true);
      processed++;
    } catch (e) {
      console.error(`[backfill][apr-only] block=${block} Error:`, String(e));
    }
    if ((i + 1) % 10 === 0) {
      const elapsed = (Date.now() - t0) / 1000;
      const rate = processed / elapsed;
      const remaining = samples.length - i - 1;
      const etaSec = rate > 0 ? remaining / rate : 0;
      console.log(
        `[backfill][apr-only] ${i + 1}/${samples.length} | elapsed: ${elapsed.toFixed(0)}s | ETA: ${etaSec.toFixed(0)}s`
      );
    }
  }
  console.log(`[backfill][apr-only] Done. Processed: ${processed}/${samples.length}`);
}

// ---------------------------------------------------------------------------
// Staking-only backfill (FIX 2): recompute total_staked_slvr per sample block by
// reading each ve lock's state AT that block via Multicall3, so the series is a
// smooth curve (no fake step from mixing old-wrong and corrected snapshots).
// ---------------------------------------------------------------------------

// locks(uint256) → (uint256 amount, uint256 lockStart, uint256 lockEnd, bool permanent, bool isMaxTime)
const LOCKS_SEL = toFunctionSelector(
  "function locks(uint256) view returns (uint256,uint256,uint256,bool,bool)"
);
const LOCKS_OUT = parseAbiParameters("uint256, uint256, uint256, bool, bool");
const UINT256_IN = parseAbiParameters("uint256");

/** Enumerate every ve lock tokenId ever minted (ERC-721 Transfer from 0x0). */
async function enumerateVeTokenIds(toBlock: bigint): Promise<string[]> {
  const mintLogs = await getLogsAdaptive({
    address: VOTE_ESCROW,
    topics: [TRANSFER_TOPIC0, ZERO_TOPIC], // [Transfer, from=0x0]
    fromBlock: DEPLOY_BLOCK_TOKEN,
    toBlock,
  });
  const ids = new Set<string>();
  for (const lg of mintLogs) {
    if (lg.topics.length >= 4) ids.add(lg.topics[3]); // tokenId at topic3
  }
  return [...ids];
}

/** Sum active ve locks (amount>0) at `block`; split permanent (permanent || lockEnd==0). */
async function computeVeTotalsAtBlock(
  tokenIds: string[],
  block: bigint
): Promise<{ totalRaw: bigint; permanentRaw: bigint; timelockedRaw: bigint; activeCount: number }> {
  const calls: Call3[] = tokenIds.map((tid) => ({
    target: VOTE_ESCROW,
    allowFailure: true,
    callData: (LOCKS_SEL + encodeAbiParameters(UINT256_IN, [BigInt(tid)]).slice(2)) as `0x${string}`,
  }));

  const results = await aggregate3(calls, block);

  let totalRaw = 0n;
  let permanentRaw = 0n;
  let timelockedRaw = 0n;
  let activeCount = 0;

  for (const r of results) {
    if (!r.success || !r.returnData || r.returnData === "0x") continue;
    let decoded: readonly unknown[];
    try {
      decoded = decodeAbiParameters(LOCKS_OUT, r.returnData);
    } catch {
      continue;
    }
    const amount = decoded[0] as bigint;
    const lockEnd = decoded[2] as bigint;
    const permanent = decoded[3] as boolean;
    if (amount <= 0n) continue;
    totalRaw += amount;
    activeCount++;
    if (permanent || lockEnd === 0n) permanentRaw += amount;
    else timelockedRaw += amount;
  }

  return { totalRaw, permanentRaw, timelockedRaw, activeCount };
}

const LP_TOTAL_STAKED_SEL_S = "0x817b1cd2";

async function stakingOnlyBackfill(
  samples: Array<{ block: bigint; timestamp: bigint }>
): Promise<void> {
  console.log("[backfill][staking-only] Recomputing total_staked_slvr per sample block (ve locks() AT block via Multicall3)");

  // Wipe the mixed/incorrect series so we rebuild a clean one.
  await sql`DELETE FROM metrics.metric_snapshots WHERE metric_name = 'total_staked_slvr'`;
  console.log("[backfill][staking-only] Cleared existing total_staked_slvr rows");

  console.log("[backfill][staking-only] Enumerating ve lock tokenIds (once)…");
  const head = await getHead();
  const tokenIds = await enumerateVeTokenIds(head.block);
  console.log(`[backfill][staking-only] ${tokenIds.length} ve lock tokenIds enumerated`);

  let processed = 0;
  const t0 = Date.now();
  for (let i = 0; i < samples.length; i++) {
    const { block, timestamp } = samples[i];
    const snapshotAt = new Date(Number(timestamp) * 1000);
    try {
      const totals = await computeVeTotalsAtBlock(tokenIds, block);

      // LP staked at this block (best-effort; 0 on failure).
      let lpStakedRaw = 0n;
      try {
        lpStakedRaw = decodeUint256(await archivalCall(LP_STAKING, LP_TOTAL_STAKED_SEL_S, block));
      } catch {
        /* leave 0 */
      }

      await writeSnapshot({
        metricName: "total_staked_slvr",
        value: Number(totals.totalRaw) / 1e18,
        value2: Number(totals.permanentRaw) / 1e18,
        value3: Number(totals.timelockedRaw) / 1e18,
        metadata: {
          total_locked_raw: totals.totalRaw.toString(),
          permanent_raw: totals.permanentRaw.toString(),
          timelocked_raw: totals.timelockedRaw.toString(),
          active_lock_count: totals.activeCount,
          lp_staked_raw: lpStakedRaw.toString(),
          lp_staked_lp_tokens: (Number(lpStakedRaw) / 1e18).toFixed(6),
          block: block.toString(),
          source: "archival_backfill_staking",
          note: "Per-slot ve locks() read AT block via Multicall3 aggregate3.",
        },
        snapshotAt,
        blockNumber: block,
        backfill: true,
      });
      processed++;
      console.log(
        `[backfill][staking-only] ${i + 1}/${samples.length} block=${block} ` +
        `total=${(Number(totals.totalRaw) / 1e18).toFixed(0)} ` +
        `(perm=${(Number(totals.permanentRaw) / 1e18).toFixed(0)}, tl=${(Number(totals.timelockedRaw) / 1e18).toFixed(0)}, active=${totals.activeCount})`
      );
    } catch (e) {
      console.error(`[backfill][staking-only] block=${block} Error:`, String(e));
    }
    if ((i + 1) % 5 === 0) {
      const elapsed = (Date.now() - t0) / 1000;
      const rate = processed / Math.max(elapsed, 0.001);
      const eta = rate > 0 ? (samples.length - i - 1) / rate : 0;
      console.log(`[backfill][staking-only] ${i + 1}/${samples.length} | elapsed ${elapsed.toFixed(0)}s | ETA ${eta.toFixed(0)}s`);
    }
  }

  console.log(`[backfill][staking-only] Done. Wrote ${processed}/${samples.length} slots.`);
}

// ---------------------------------------------------------------------------
// Staking-APY backfill: reconstruct the staking_apr series (veSLVR ETH-reward
// yield) at each sample block from rewardPerWeightStored Δ + the SLVR/WETH pool
// price AT that block — all archival, so it matches the live cron exactly.
// ---------------------------------------------------------------------------
async function stakingApyBackfill(
  samples: Array<{ block: bigint; timestamp: bigint }>
): Promise<void> {
  console.log("[backfill][staking-apy] Rebuilding staking_apr series (rpw Δ + pool price AT block)");
  await sql`DELETE FROM metrics.metric_snapshots WHERE metric_name = 'staking_apr'`;
  console.log("[backfill][staking-apy] Cleared existing staking_apr rows");

  // Historical ETH/USD (hourly) to denominate the SLVR price line in USD.
  let ethHist: Array<[number, number]> = [];
  try {
    ethHist = await fetchEthUsdHistory(10);
    console.log(`[backfill][staking-apy] Fetched ${ethHist.length} hourly ETH/USD points from Coingecko`);
  } catch (e) {
    console.warn("[backfill][staking-apy] ETH/USD history fetch failed — price line will be null:", String(e));
  }

  let processed = 0;
  let skipped = 0;
  const t0 = Date.now();
  for (let i = 0; i < samples.length; i++) {
    const { block, timestamp } = samples[i];
    const snapshotAt = new Date(Number(timestamp) * 1000);
    try {
      const apy = await computeStakingApy(block);
      if (!apy) {
        skipped++;
        continue; // early samples: no distributions / no pool liquidity yet
      }
      const ethUsd = nearestUsd(ethHist, Number(timestamp) * 1000);
      const rawPrice =
        apy.slvrPerEth > 0 && ethUsd > 0 ? (1 / apy.slvrPerEth) * ethUsd : null;
      const slvrPriceUsd =
        rawPrice !== null && rawPrice >= 0.01 && rawPrice <= 5000 ? rawPrice : null;
      await writeSnapshot({
        metricName: "staking_apr",
        value: apy.permanentAprPercent,
        value2: apy.baseAprPercent,
        value3: slvrPriceUsd,
        metadata: {
          by_lock: apy.byLock,
          window_days: apy.windowDays,
          slvr_per_eth: apy.slvrPerEth,
          slvr_price_usd: slvrPriceUsd,
          eth_usd: ethUsd,
          total_weight: apy.totalWeight,
          delta_rpw: apy.deltaRpw,
          permanent_multiplier: apy.permanentMultiplier,
          block: block.toString(),
          reward_token: "ETH",
          method: "trailing_24h_pool_priced",
          source: "archival_backfill_staking_apy",
        },
        snapshotAt,
        blockNumber: block,
        backfill: true,
      });
      processed++;
      console.log(
        `[backfill][staking-apy] ${i + 1}/${samples.length} block=${block} ` +
        `permanent=${apy.permanentAprPercent.toFixed(0)}% (${apy.windowDays}d) SLVR $${slvrPriceUsd?.toFixed(2) ?? "?"}`
      );
    } catch (e) {
      console.error(`[backfill][staking-apy] block=${block} Error:`, String(e));
    }
    if ((i + 1) % 5 === 0) {
      const elapsed = (Date.now() - t0) / 1000;
      const rate = processed / Math.max(elapsed, 0.001);
      const eta = rate > 0 ? (samples.length - i - 1) / rate : 0;
      console.log(`[backfill][staking-apy] ${i + 1}/${samples.length} | elapsed ${elapsed.toFixed(0)}s | ETA ${eta.toFixed(0)}s`);
    }
  }
  console.log(`[backfill][staking-apy] Done. Wrote ${processed}, skipped ${skipped} (no rate yet).`);
}

// ---------------------------------------------------------------------------
// LP-staking-APY backfill: reconstruct lp_staking_apr over the hooked V4 pool's
// life (it's young). At each hourly block, computeLpStakingApy(block) reads the
// pool price, exactly values the staked positions, and measures the trailing
// sell-tax reward — all archival.
// ---------------------------------------------------------------------------
const LP_POOL_CREATION_BLOCK = 20959201n;
async function lpStakingApyBackfill(): Promise<void> {
  console.log("[backfill][lp-staking-apy] Rebuilding lp_staking_apr over the pool's life (hourly)");
  await sql`DELETE FROM metrics.metric_snapshots WHERE metric_name = 'lp_staking_apr'`;
  const head = await getHead();
  const STEP = 36000n; // ~1h at 100ms blocks
  const samples: bigint[] = [];
  for (let b = LP_POOL_CREATION_BLOCK; b < head.block; b += STEP) samples.push(b);
  samples.push(head.block);
  console.log(`[backfill][lp-staking-apy] ${samples.length} hourly samples ${LP_POOL_CREATION_BLOCK}→${head.block}`);

  let processed = 0;
  let skipped = 0;
  const t0 = Date.now();
  for (let i = 0; i < samples.length; i++) {
    const block = samples[i];
    try {
      const blk = await archivalGetBlock(block);
      const ts = blk ? Number(blk.timestamp) : Math.floor(Date.now() / 1000);
      // Retry — rapid archival bursts occasionally get throttled ("missing params").
      let lp: Awaited<ReturnType<typeof computeLpStakingApy>> = null;
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          lp = await computeLpStakingApy(block);
          break;
        } catch (err) {
          if (attempt === 3) throw err;
          await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
        }
      }
      if (!lp) {
        skipped++;
        continue; // pre-staking sample
      }
      await writeSnapshot({
        metricName: "lp_staking_apr",
        value: lp.aprPercent,
        value2: lp.concentratedApr,
        value3: lp.fullRangeApr,
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
          source: "archival_backfill_lp_apy",
        },
        snapshotAt: new Date(ts * 1000),
        blockNumber: block,
        backfill: true,
      });
      processed++;
      console.log(
        `[backfill][lp-staking-apy] ${i + 1}/${samples.length} block=${block} ` +
        `apr=${lp.aprPercent.toFixed(0)}% staked=${lp.stakedValueEth.toFixed(2)}ETH pos=${lp.positionCount} rew=${lp.rewardSlvrPerDay.toFixed(1)}/d`
      );
    } catch (e) {
      console.error(`[backfill][lp-staking-apy] block=${block} Error:`, String(e).slice(0, 100));
    }
    await new Promise((r) => setTimeout(r, 700)); // pace archival calls between samples
    if ((i + 1) % 5 === 0) {
      const el = (Date.now() - t0) / 1000;
      console.log(`[backfill][lp-staking-apy] ${i + 1}/${samples.length} | ${el.toFixed(0)}s`);
    }
  }
  console.log(`[backfill][lp-staking-apy] done: ${processed} written, ${skipped} skipped`);
}

// ---------------------------------------------------------------------------
// Buyback backfill: rebuild the buyback_totals cumulative series (SLVR burned +
// ETH spent) at hourly marks over the mechanism's life. All BuybackBurned events
// are fetched ONCE, then each hourly point sums events up to that block.
// ---------------------------------------------------------------------------
async function buybacksBackfill(): Promise<void> {
  console.log("[backfill][buybacks] Rebuilding buyback_totals cumulative series (hourly)");
  await sql`DELETE FROM metrics.metric_snapshots WHERE metric_name = 'buyback_totals'`;

  const head = await getHead();
  const events = await fetchBuybackEvents(DEPLOY_BLOCK_BUYBACK, head.block);
  if (events.length === 0) {
    console.log("[backfill][buybacks] No BuybackBurned events found — nothing to backfill.");
    return;
  }
  const firstBlock = events[0].block;
  console.log(
    `[backfill][buybacks] ${events.length} events from block ${firstBlock} → ${head.block}`
  );

  const STEP = 36_000n; // ~1h at 100ms blocks
  const samples: bigint[] = [];
  for (let b = firstBlock; b < head.block; b += STEP) samples.push(b);
  samples.push(head.block);

  // Historical ETH/USD (hourly) to denominate spend in USD.
  let ethHist: Array<[number, number]> = [];
  try {
    ethHist = await fetchEthUsdHistory(10);
  } catch (e) {
    console.warn("[backfill][buybacks] ETH/USD history fetch failed — USD will be null:", String(e));
  }

  const DAY = 86_400;
  const winBlocks = BigInt(DAY * APPROX_BLOCKS_PER_SEC);
  let processed = 0;
  for (let i = 0; i < samples.length; i++) {
    const block = samples[i];
    try {
      const blk = await archivalGetBlock(block);
      const ts = blk ? Number(blk.timestamp) : Math.floor(Date.now() / 1000);

      // Cumulative up to this block.
      let cumSlvr = 0n;
      let cumEth = 0n;
      let count = 0;
      // Trailing ≤24h window for the daily rate at this block.
      const floor = block > winBlocks ? block - winBlocks : 0n;
      const wStart = firstBlock > floor ? firstBlock : floor;
      let winSlvr = 0n;
      let winEth = 0n;
      for (const e of events) {
        if (e.block > block) break; // events are sorted ascending
        cumSlvr += e.slvrRaw;
        cumEth += e.ethInRaw;
        count++;
        if (e.block >= wStart) {
          winSlvr += e.slvrRaw;
          winEth += e.ethInRaw;
        }
      }
      const winSec = Math.max(1, Number(block - wStart) / APPROX_BLOCKS_PER_SEC);
      const dailySlvr = ((Number(winSlvr) / 1e18) / winSec) * DAY;
      const dailyEth = ((Number(winEth) / 1e18) / winSec) * DAY;
      const ethUsd = nearestUsd(ethHist, ts * 1000);
      const usd = (eth: number): number | null => (ethUsd > 0 ? eth * ethUsd : null);

      await writeSnapshot({
        metricName: "buyback_totals",
        value: Number(cumSlvr) / 1e18,
        value2: Number(cumEth) / 1e18,
        value3: dailySlvr,
        metadata: {
          cumulative_slvr_burned: Number(cumSlvr) / 1e18,
          cumulative_eth_spent: Number(cumEth) / 1e18,
          cumulative_usd_spent: usd(Number(cumEth) / 1e18),
          buyback_count: count,
          daily_slvr: dailySlvr,
          daily_eth: dailyEth,
          daily_usd: usd(dailyEth),
          eth_usd: ethUsd || null,
          block: block.toString(),
          source: "archival_backfill_buybacks",
        },
        snapshotAt: new Date(ts * 1000),
        blockNumber: block,
        backfill: true,
      });
      processed++;
      console.log(
        `[backfill][buybacks] ${i + 1}/${samples.length} block=${block} ` +
        `cum=${(Number(cumSlvr) / 1e18).toFixed(2)} SLVR / ${(Number(cumEth) / 1e18).toFixed(4)} ETH (${count} buybacks)`
      );
    } catch (e) {
      console.error(`[backfill][buybacks] block=${block} Error:`, String(e).slice(0, 100));
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  console.log(`[backfill][buybacks] Done. Wrote ${processed}/${samples.length} slots.`);
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const aprOnly = args.includes("--apr-only");
  const stakingOnly = args.includes("--staking-only");
  const stakingApy = args.includes("--staking-apy");
  const lpStakingApy = args.includes("--lp-staking-apy");
  const buybacks = args.includes("--buybacks");

  if (dryRun) {
    console.log("[backfill] DRY RUN — will compute sample blocks but not write to DB");
  }
  if (aprOnly) {
    console.log("[backfill] APR-ONLY mode — overwriting null dividends_apr rows with correct V1/V2 routed values");
  }
  if (stakingOnly) {
    console.log("[backfill] STAKING-ONLY mode — rebuilding total_staked_slvr as a smooth per-slot ve series");
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

  // Staking-only mode: rebuild total_staked_slvr per sample block (FIX 2)
  if (stakingOnly) {
    await stakingOnlyBackfill(samples);
    const staked = await sql<Array<{ t: string; staked: string }>>`
      SELECT to_char(snapshot_at,'MM-DD HH24:MI') AS t, round(value::numeric, 0)::text AS staked
      FROM metrics.metric_snapshots
      WHERE metric_name = 'total_staked_slvr' AND value IS NOT NULL
      ORDER BY snapshot_at ASC
    `;
    console.log("\n[backfill][staking-only] total_staked_slvr series:");
    for (const r of staked) console.log(`  ${r.t}  ${r.staked}`);
    await sql.end();
    return;
  }

  // Staking-APY mode: rebuild the staking_apr series per sample block.
  if (stakingApy) {
    await stakingApyBackfill(samples);
    const rows = await sql<Array<{ t: string; perm: string }>>`
      SELECT to_char(snapshot_at,'MM-DD HH24:MI') AS t, round(value::numeric, 0)::text AS perm
      FROM metrics.metric_snapshots
      WHERE metric_name = 'staking_apr' AND value IS NOT NULL
      ORDER BY snapshot_at ASC
    `;
    console.log("\n[backfill][staking-apy] staking_apr (permanent) series:");
    for (const r of rows) console.log(`  ${r.t}  ${r.perm}%`);
    await sql.end();
    return;
  }

  // LP-staking-APY mode: rebuild lp_staking_apr over the hooked pool's life.
  if (lpStakingApy) {
    await lpStakingApyBackfill();
    const rows = await sql<Array<{ t: string; apr: string }>>`
      SELECT to_char(snapshot_at,'MM-DD HH24:MI') AS t, round(value::numeric, 0)::text AS apr
      FROM metrics.metric_snapshots
      WHERE metric_name = 'lp_staking_apr' AND value IS NOT NULL
      ORDER BY snapshot_at ASC
    `;
    console.log("\n[backfill][lp-staking-apy] lp_staking_apr series:");
    for (const r of rows) console.log(`  ${r.t}  ${r.apr}%`);
    await sql.end();
    return;
  }

  // Buyback mode: rebuild the buyback_totals cumulative series.
  if (buybacks) {
    await buybacksBackfill();
    const rows = await sql<Array<{ t: string; slvr: string; eth: string }>>`
      SELECT to_char(snapshot_at,'MM-DD HH24:MI') AS t,
             round(value::numeric, 2)::text AS slvr,
             round(value2::numeric, 4)::text AS eth
      FROM metrics.metric_snapshots
      WHERE metric_name = 'buyback_totals' AND value IS NOT NULL
      ORDER BY snapshot_at ASC
    `;
    console.log("\n[backfill][buybacks] buyback_totals (cumulative SLVR / ETH) series:");
    for (const r of rows) console.log(`  ${r.t}  ${r.slvr} SLVR  ${r.eth} ETH`);
    await sql.end();
    return;
  }

  // APR-only mode: re-compute just dividends_apr for all sample blocks
  if (aprOnly) {
    await aprOnlyBackfill(samples);
    const [aprSummary] = await sql<[{ total: string; non_null: string; min_val: string; max_val: string }]>`
      SELECT
        COUNT(*)::text AS total,
        COUNT(*) FILTER (WHERE value IS NOT NULL)::text AS non_null,
        MIN(value)::text AS min_val,
        MAX(value)::text AS max_val
      FROM metrics.metric_snapshots
      WHERE metric_name = 'dividends_apr'
    `;
    console.log(
      `\n[backfill][apr-only] Summary: total=${aprSummary?.total ?? 0}, ` +
      `non_null=${aprSummary?.non_null ?? 0}, ` +
      `min=${aprSummary?.min_val ?? "N/A"}%, ` +
      `max=${aprSummary?.max_val ?? "N/A"}%`
    );
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

    await writeBackfillSlot(block, timestamp, dryRun, i + 1, samples.length, cachedLpStakedRaw, head.block);
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

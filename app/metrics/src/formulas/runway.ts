/**
 * Emission rate and runway — based on the 500K EMISSION BUDGET using GROSS emission.
 *
 * The old model used NET supply change (totalSupply now − totalSupply 30d ago) and the
 * remaining = cap − totalSupply. Both are wrong for this token: burns (mostly permanent
 * ve-locks) exceed mints, so NET emission is negative and totalSupply understates how much
 * of the 500K has actually been emitted. Runway must be measured against the cap using how
 * fast SLVR is *minted* out of the budget (gross), not the net supply drift.
 *
 * Definitions (see supply.ts / burns.ts):
 *   emitted(b)     = totalSupply(b) + cumulativeBurned(b)   (total ever minted from 500K)
 *   remaining      = 500,000 − emitted(now)
 *   window         = [max(genesis, now − 30d), now]
 *   grossEmitted   = emitted(now) − emitted(windowStart)    (SLVR minted over the window)
 *   perDayGross    = grossEmitted / window_days
 *   runwayMonths   = remaining / perDayGross / 30.44
 *
 * If perDayGross ≤ 0 → dataStatus = "insufficient" (no runway estimate).
 *
 * cumulativeBurned(windowStartBlock) reuses the single burn-log scan (burns.ts), summing
 * only logs with blockNumber ≤ windowStartBlock.
 */

import {
  SLVR_TOKEN,
  SLVR_CAP,
  EMISSION_WINDOW_SECONDS,
} from "../constants";
import { archivalCall, decodeUint256 } from "../rpc";
import { resolveBlockAtTimestampFast, getHead, estimateBlockAtTimestamp } from "../block-resolver";
import { cumulativeBurnedAt } from "./burns";
import { DEPLOY_BLOCK_TOKEN } from "../constants";

const TOTAL_SUPPLY_SEL = "0x18160ddd";
const DAYS_PER_MONTH = 30.44;

export type RunwayResult = {
  // emitted accounting
  emittedNowRaw: bigint;
  emittedWindowStartRaw: bigint;
  grossEmittedRaw: bigint;        // emitted(now) − emitted(windowStart)  (SLVR minted over window)
  perDayGrossRaw: bigint;         // grossEmitted / windowDays  (raw units/day, floored)
  windowDays: number;
  // budget
  totalSupplyNowRaw: bigint;
  remainingCapRaw: bigint;        // 500,000 − emitted(now)
  runwayMonths: number | null;
  // window blocks
  blockNow: bigint;
  blockWindowStart: bigint;
  dataStatus: "ok" | "insufficient" | "pre_genesis_window";
  // legacy field kept for the emission_rate_30d snapshot metric (now = GROSS over window)
  emissionRate30dRaw: bigint;
};

/**
 * @param atBlock  block to evaluate "now" at (defaults to head).
 * @param scanTo   block to scan burn logs up to (cache key). Defaults to atBlock.
 */
export async function computeRunway(
  atBlock?: bigint,
  scanTo?: bigint
): Promise<RunwayResult> {
  const head = await getHead();
  const blockNow = atBlock ?? head.block;
  const scanToBlock = scanTo ?? blockNow;

  // Resolve the "now" timestamp for this block, then the window-start block at now−30d.
  const nowInfo = blockNow === head.block
    ? { block: head.block, timestamp: head.timestamp }
    : { block: blockNow, timestamp: await blockTimestamp(blockNow, head) };

  const nowTs = nowInfo.timestamp;
  const tsWindowStart = nowTs - BigInt(EMISSION_WINDOW_SECONDS);

  // Window start block: clamp to genesis (so early history uses genesis→now window).
  const windowStartInfo = await resolveBlockAtTimestampFast(tsWindowStart);
  const blockWindowStart =
    windowStartInfo.block < DEPLOY_BLOCK_TOKEN ? DEPLOY_BLOCK_TOKEN : windowStartInfo.block;

  // totalSupply at now and window-start.
  const [hexNow, hexStart] = await Promise.all([
    archivalCall(SLVR_TOKEN, TOTAL_SUPPLY_SEL, blockNow),
    archivalCall(SLVR_TOKEN, TOTAL_SUPPLY_SEL, blockWindowStart),
  ]);
  const totalSupplyNowRaw = decodeUint256(hexNow);
  const totalSupplyStartRaw = decodeUint256(hexStart);

  // cumulativeBurned at now and window-start (single shared scan up to scanToBlock).
  const [{ burnedRaw: burnedNow }, { burnedRaw: burnedStart }] = await Promise.all([
    cumulativeBurnedAt(blockNow, scanToBlock),
    cumulativeBurnedAt(blockWindowStart, scanToBlock),
  ]);

  const emittedNowRaw = totalSupplyNowRaw + burnedNow;
  const emittedWindowStartRaw = totalSupplyStartRaw + burnedStart;

  const remainingCapRaw = SLVR_CAP > emittedNowRaw ? SLVR_CAP - emittedNowRaw : 0n;

  // Gross emitted over the window (should be ≥ 0; clamp defensively).
  const grossEmittedRaw =
    emittedNowRaw > emittedWindowStartRaw ? emittedNowRaw - emittedWindowStartRaw : 0n;

  // Window duration in days (actual seconds between the two blocks).
  const startTs = windowStartInfo.timestamp;
  const windowSeconds = Number(nowTs - startTs);
  const windowDays = windowSeconds > 0 ? windowSeconds / 86400 : 0;

  if (grossEmittedRaw <= 0n || windowDays <= 0) {
    return {
      emittedNowRaw,
      emittedWindowStartRaw,
      grossEmittedRaw,
      perDayGrossRaw: 0n,
      windowDays,
      totalSupplyNowRaw,
      remainingCapRaw,
      runwayMonths: null,
      blockNow,
      blockWindowStart,
      dataStatus: "insufficient",
      emissionRate30dRaw: grossEmittedRaw,
    };
  }

  // Per-day gross emission (float math for the ratio; raw kept for metadata).
  const grossPerDay = Number(grossEmittedRaw) / 1e18 / windowDays;
  const remainingHuman = Number(remainingCapRaw) / 1e18;
  const runwayMonths = remainingHuman / grossPerDay / DAYS_PER_MONTH;

  const perDayGrossRaw = grossEmittedRaw / BigInt(Math.max(1, Math.round(windowDays)));

  return {
    emittedNowRaw,
    emittedWindowStartRaw,
    grossEmittedRaw,
    perDayGrossRaw,
    windowDays,
    totalSupplyNowRaw,
    remainingCapRaw,
    runwayMonths,
    blockNow,
    blockWindowStart,
    dataStatus: "ok",
    emissionRate30dRaw: grossEmittedRaw,
  };
}

// Resolve a block's timestamp; for head we already have it, else estimate+fetch via resolver.
async function blockTimestamp(
  block: bigint,
  head: { block: bigint; timestamp: bigint }
): Promise<bigint> {
  // Approximate then confirm: cheap for backfill slots (block already known).
  const { archivalGetBlock } = await import("../rpc");
  const b = await archivalGetBlock(block);
  if (b) return b.timestamp;
  // Fallback: linear estimate from head (should not normally happen).
  const est = await estimateBlockAtTimestamp(head.timestamp, head.block, head.timestamp);
  void est;
  return head.timestamp;
}

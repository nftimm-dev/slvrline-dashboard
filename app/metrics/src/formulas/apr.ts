/**
 * Dividends APR formula — trailing-24h index-delta method via archival eth_call.
 *
 * APR = (minerIndex(head) − minerIndex(block@now−24h)) / 1e18 × (SECONDS_PER_YEAR / windowSeconds)
 *
 * Where windowSeconds = min(24h, age of the active contract since its V2 deploy).
 *
 * The 24h trailing window provides a stable, fair rolling yield that:
 *   - Eliminates the launch spike that appeared during the first 7 days post-migration.
 *   - Reflects actual recent dividend accumulation without anchoring to launch.
 *   - Returns null (dataStatus="early") for the first 24h after migration so
 *     the chart never shows a misleading spike at launch.
 *
 * V1/V2 accumulators are INDEPENDENT — never mix them:
 *   - GridLotteryV1 (0x284Eb4016305...): accumulator active before block 16,764,101.
 *   - GridLotteryV2 (0xB0Cc994Ce4E8...): accumulator RESET to 0 at block 16,764,101.
 *
 * For the live headline (computeDividendsApr):
 *   - Always use V2's accumulator (post-migration).
 *   - If age < 24h → return apr: null, aprPercent: null, dataStatus: "early".
 *   - If age >= 24h → compute trailing-24h APR, dataStatus: "ok".
 *
 * For historical samples (computeHistoricalAprForBlock):
 *   - Only called for blocks >= V2 deploy (backfill starts at migration block).
 *   - If block age < 24h since V2 deploy → return null, dataStatus: "early".
 *   - If block age >= 24h → compute trailing-24h APR using V2 accumulator.
 *
 * selector: minerIndex() = 0x9806b4d2 (confirmed in RESEARCH.md)
 */

import {
  LOTTERY_V2,
  LOTTERY_V2_DEPLOY_BLOCK,
  WAD,
  APR_TRAIL_SECONDS,
  SECONDS_PER_YEAR,
} from "../constants";
import { archivalCall, archivalGetBlock, decodeUint256 } from "../rpc";
import { resolveBlockAtTimestampFast, getHead } from "../block-resolver";

// Function selector for minerIndex() — keccak256("minerIndex()")[0:4]
// Confirmed: 0x9806b4d2 (RESEARCH.md §4b, METHODOLOGY.md §APR)
const MINER_INDEX_SELECTOR = "0x9806b4d2";

export type AprResult = {
  apr: number | null;
  aprPercent: number | null; // apr * 100
  deltaIndex: bigint | null;
  indexNow: bigint | null;
  indexWindowStart: bigint | null;
  blockNow: bigint | null;
  blockWindowStart: bigint | null;
  tsWindowStart: bigint | null;
  windowSeconds: number;
  windowDays: number;
  contractVersion: "v1" | "v2";
  dataStatus: "ok" | "early" | "no_data";
};

/**
 * Compute the headline (current) dividends APR using the trailing-24h window on V2.
 * Returns apr: null / dataStatus: "early" if V2 is < 24h old (prevents launch spike).
 * Once V2 age >= 24h, returns the real trailing-24h annualised rate.
 */
export async function computeDividendsApr(
  asOfBlock?: bigint
): Promise<AprResult> {
  const head = await getHead();
  const nowBlock = asOfBlock ?? head.block;
  const nowTs = head.timestamp;

  // Fetch the V2 deploy block's timestamp to know how old V2 is
  const v2DeployBlockInfo = await archivalGetBlock(LOTTERY_V2_DEPLOY_BLOCK);
  if (!v2DeployBlockInfo) {
    throw new Error("Failed to fetch V2 deploy block");
  }
  const v2DeployTs = v2DeployBlockInfo.timestamp;

  // Age of V2 at this moment
  const v2AgeSeconds = Number(nowTs - v2DeployTs);

  // If V2 is less than 24h old, return null so there is no launch spike
  if (v2AgeSeconds < APR_TRAIL_SECONDS) {
    return {
      apr: null,
      aprPercent: null,
      deltaIndex: null,
      indexNow: null,
      indexWindowStart: null,
      blockNow: nowBlock,
      blockWindowStart: null,
      tsWindowStart: null,
      windowSeconds: v2AgeSeconds,
      windowDays: Math.round((v2AgeSeconds / 86400) * 10) / 10,
      contractVersion: "v2",
      dataStatus: "early",
    };
  }

  // Trailing-24h window (full)
  const effectiveWindowSeconds = APR_TRAIL_SECONDS;

  // Target timestamp for window start
  const tsWindowStart = nowTs - BigInt(effectiveWindowSeconds);

  // Resolve block at window start — clamp to V2 deploy block (never before it)
  const windowStartBlockInfo = await resolveBlockAtTimestampFast(tsWindowStart);
  const blockWindowStart =
    windowStartBlockInfo.block < LOTTERY_V2_DEPLOY_BLOCK
      ? LOTTERY_V2_DEPLOY_BLOCK
      : windowStartBlockInfo.block;

  // Read minerIndex at both blocks via archival eth_call on V2
  const [rawNow, rawWindowStart] = await Promise.all([
    archivalCall(LOTTERY_V2, MINER_INDEX_SELECTOR, nowBlock),
    archivalCall(LOTTERY_V2, MINER_INDEX_SELECTOR, blockWindowStart),
  ]);

  const indexNow = decodeUint256(rawNow);
  const indexWindowStart = decodeUint256(rawWindowStart);
  const deltaIndex = indexNow - indexWindowStart;

  if (deltaIndex <= 0n) {
    return {
      apr: 0,
      aprPercent: 0,
      deltaIndex: 0n,
      indexNow,
      indexWindowStart,
      blockNow: nowBlock,
      blockWindowStart,
      tsWindowStart,
      windowSeconds: effectiveWindowSeconds,
      windowDays: Math.round((effectiveWindowSeconds / 86400) * 10) / 10,
      contractVersion: "v2",
      dataStatus: "ok",
    };
  }

  // Core formula: (Δindex / WAD) × (SECONDS_PER_YEAR / effectiveWindow)
  const apr = (Number(deltaIndex) / Number(WAD)) * (SECONDS_PER_YEAR / effectiveWindowSeconds);

  return {
    apr,
    aprPercent: apr * 100,
    deltaIndex,
    indexNow,
    indexWindowStart,
    blockNow: nowBlock,
    blockWindowStart,
    tsWindowStart,
    windowSeconds: effectiveWindowSeconds,
    windowDays: Math.round((effectiveWindowSeconds / 86400) * 10) / 10,
    contractVersion: "v2",
    dataStatus: "ok",
  };
}

/**
 * Compute dividends APR for a historical backfill block (V2 only, post-migration).
 * Returns null APR with dataStatus="early" for the first 24h after migration.
 *
 * @param sampleBlock  The block number being sampled (must be >= V2 deploy block)
 * @param sampleTs     The Unix timestamp of sampleBlock
 */
export async function computeHistoricalAprForBlock(
  sampleBlock: bigint,
  sampleTs: bigint
): Promise<AprResult> {
  // All backfill samples are post-migration; always use V2 accumulator
  const contract = LOTTERY_V2;
  const contractDeployBlock = LOTTERY_V2_DEPLOY_BLOCK;
  const contractVersion: "v1" | "v2" = "v2";

  // Fetch deploy block timestamp to compute V2 age at sampleBlock
  const deployBlockInfo = await archivalGetBlock(contractDeployBlock);
  if (!deployBlockInfo) {
    throw new Error(`Failed to fetch V2 deploy block ${contractDeployBlock}`);
  }
  const contractDeployTs = deployBlockInfo.timestamp;

  // Age of V2 contract at sampleBlock
  const contractAgeAtSample = Number(sampleTs - contractDeployTs);

  // If age < 24h: return null so the first 24h are blank on the chart (no spike)
  if (contractAgeAtSample < APR_TRAIL_SECONDS) {
    return {
      apr: null,
      aprPercent: null,
      deltaIndex: null,
      indexNow: null,
      indexWindowStart: null,
      blockNow: sampleBlock,
      blockWindowStart: null,
      tsWindowStart: null,
      windowSeconds: contractAgeAtSample,
      windowDays: Math.round((contractAgeAtSample / 86400) * 10) / 10,
      contractVersion,
      dataStatus: "early",
    };
  }

  // Trailing-24h window (full)
  const effectiveWindowSeconds = APR_TRAIL_SECONDS;

  // Target timestamp for window start
  const tsWindowStart = sampleTs - BigInt(effectiveWindowSeconds);

  // Resolve block at window start — never before the V2 deploy block
  const windowStartBlockInfo = await resolveBlockAtTimestampFast(tsWindowStart);
  const blockWindowStart =
    windowStartBlockInfo.block < contractDeployBlock
      ? contractDeployBlock
      : windowStartBlockInfo.block;

  // Read minerIndex at both blocks via archival eth_call on V2
  const [rawNow, rawWindowStart] = await Promise.all([
    archivalCall(contract, MINER_INDEX_SELECTOR, sampleBlock),
    archivalCall(contract, MINER_INDEX_SELECTOR, blockWindowStart),
  ]);

  const indexNow = decodeUint256(rawNow);
  const indexWindowStart = decodeUint256(rawWindowStart);
  const deltaIndex = indexNow - indexWindowStart;

  if (deltaIndex <= 0n) {
    return {
      apr: 0,
      aprPercent: 0,
      deltaIndex: 0n,
      indexNow,
      indexWindowStart,
      blockNow: sampleBlock,
      blockWindowStart,
      tsWindowStart,
      windowSeconds: effectiveWindowSeconds,
      windowDays: Math.round((effectiveWindowSeconds / 86400) * 10) / 10,
      contractVersion,
      dataStatus: "ok",
    };
  }

  const apr = (Number(deltaIndex) / Number(WAD)) * (SECONDS_PER_YEAR / effectiveWindowSeconds);

  return {
    apr,
    aprPercent: apr * 100,
    deltaIndex,
    indexNow,
    indexWindowStart,
    blockNow: sampleBlock,
    blockWindowStart,
    tsWindowStart,
    windowSeconds: effectiveWindowSeconds,
    windowDays: Math.round((effectiveWindowSeconds / 86400) * 10) / 10,
    contractVersion,
    dataStatus: "ok",
  };
}

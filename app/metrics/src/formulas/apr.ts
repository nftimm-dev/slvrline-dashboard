/**
 * Dividends APR formula — index-delta method via archival eth_call.
 *
 * APR = (minerIndex(head) − minerIndex(block@now−W)) / 1e18 × (SECONDS_PER_YEAR / W)
 *
 * Where W = min(7 days, age of the active contract since its deploy).
 *
 * Source: METHODOLOGY.md §APR, RESEARCH.md §4c.
 * The minerIndex is the cumulative refining fee per 1e18 unclaimed SLVR.
 * Δindex/WAD is the exact fractional return for a continuously-unclaimed miner over window W.
 *
 * V1/V2 accumulators are INDEPENDENT — never mix them:
 *   - GridLotteryV1 (0x284Eb4016305...): accumulator active before block 16,764,101.
 *   - GridLotteryV2 (0xB0Cc994Ce4E8...): accumulator RESET to 0 at block 16,764,101.
 *
 * For the live headline (computeDividendsApr):
 *   - Always use V2's accumulator.
 *   - Window = min(7d, seconds since V2 deploy). When < 7d the figure is labeled "early".
 *   - Once V2 has >= 7 days of data the window becomes the standard 7-day rolling figure.
 *   - The 7-day window matures on ~2026-07-29.
 *
 * For historical samples (computeHistoricalAprForBlock):
 *   - If block < 16,764,101 → use V1, window = min(7d, block age since V1 deploy).
 *   - If block >= 16,764,101 → use V2, window = min(7d, block age since V2 deploy).
 *
 * selector: minerIndex() = 0x9806b4d2 (confirmed in RESEARCH.md)
 */

import {
  LOTTERY_V1,
  LOTTERY_V2,
  LOTTERY_V2_DEPLOY_BLOCK,
  DEPLOY_BLOCK_TOKEN,
  WAD,
  APR_WINDOW_SECONDS,
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
 * Compute the headline (current) dividends APR using V2's available window.
 * Window = min(7 days, seconds elapsed since V2 deploy block).
 * Returns a non-null APR with dataStatus="early" while V2 is < 7 days old.
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

  // Effective window: clamped to V2's age (at minimum 10 minutes to avoid division by zero)
  const v2AgeSeconds = Number(nowTs - v2DeployTs);
  const effectiveWindowSeconds = Math.min(APR_WINDOW_SECONDS, Math.max(v2AgeSeconds, 600));
  const isEarlyWindow = effectiveWindowSeconds < APR_WINDOW_SECONDS;

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
      dataStatus: isEarlyWindow ? "early" : "ok",
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
    dataStatus: isEarlyWindow ? "early" : "ok",
  };
}

/**
 * Compute dividends APR for a historical backfill block.
 * Routes to V1 or V2 based on whether the sample block is before or after migration.
 *
 * @param sampleBlock  The block number being sampled
 * @param sampleTs     The Unix timestamp of sampleBlock
 */
export async function computeHistoricalAprForBlock(
  sampleBlock: bigint,
  sampleTs: bigint
): Promise<AprResult> {
  // Determine which contract was active at sampleBlock
  const useV2 = sampleBlock >= LOTTERY_V2_DEPLOY_BLOCK;
  const contract = useV2 ? LOTTERY_V2 : LOTTERY_V1;
  const contractDeployBlock = useV2 ? LOTTERY_V2_DEPLOY_BLOCK : DEPLOY_BLOCK_TOKEN;
  const contractVersion: "v1" | "v2" = useV2 ? "v2" : "v1";

  // Fetch deploy block timestamp to compute contract age at sampleBlock
  const deployBlockInfo = await archivalGetBlock(contractDeployBlock);
  if (!deployBlockInfo) {
    throw new Error(`Failed to fetch deploy block ${contractDeployBlock}`);
  }
  const contractDeployTs = deployBlockInfo.timestamp;

  // Effective window: min(7d, age of contract at sampleBlock)
  const contractAgeAtSample = Number(sampleTs - contractDeployTs);
  const effectiveWindowSeconds = Math.min(APR_WINDOW_SECONDS, Math.max(contractAgeAtSample, 600));
  const isEarlyWindow = effectiveWindowSeconds < APR_WINDOW_SECONDS;

  // Target timestamp for window start
  const tsWindowStart = sampleTs - BigInt(effectiveWindowSeconds);

  // Resolve block at window start — never before the contract's deploy block
  const windowStartBlockInfo = await resolveBlockAtTimestampFast(tsWindowStart);
  const blockWindowStart =
    windowStartBlockInfo.block < contractDeployBlock
      ? contractDeployBlock
      : windowStartBlockInfo.block;

  // Read minerIndex at both blocks via archival eth_call on the active contract
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
      dataStatus: isEarlyWindow ? "early" : "ok",
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
    dataStatus: isEarlyWindow ? "early" : "ok",
  };
}

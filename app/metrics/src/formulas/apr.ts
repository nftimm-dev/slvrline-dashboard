/**
 * Dividends APR formula — trailing-24h index-delta method via archival eth_call.
 *
 * APR = (minerIndex(head) − minerIndex(block@now−24h)) / 1e18 × (SECONDS_PER_YEAR / windowSeconds)
 *
 * Where windowSeconds = min(24h, age of the active miner-state accumulator).
 *
 * The 24h trailing window provides a stable, fair rolling yield that:
 *   - Eliminates the launch spike that appeared during the first 7 days post-migration.
 *   - Reflects actual recent dividend accumulation without anchoring to launch.
 *   - Returns null (dataStatus="early") for the first 24h after migration so
 *     the chart never shows a misleading spike at launch.
 *
 * Every pre-vault lottery accumulator and the vault accumulator are INDEPENDENT
 * — never mix them:
 *   - GridLotteryV1 (0x284Eb4016305...): accumulator active before block 16,764,101.
 *   - GridLotteryV2 (0xB0Cc994Ce4E8...): accumulator RESET to 0 at block 16,764,101.
 *   - SlvrMinerVault (0x2070b4B0c57E...): permanent miner state from round 33,500.
 *
 * For the live headline (computeDividendsApr):
 *   - Always use the permanent vault's accumulator.
 *   - If age < 24h → return apr: null, aprPercent: null, dataStatus: "early".
 *   - If age >= 24h → compute trailing-24h APR, dataStatus: "ok".
 *
 * For historical samples (computeHistoricalAprForBlock):
 *   - Route each sample to the accumulator active at that block.
 *   - Return "early" until that accumulator has a complete 24h window.
 *
 * selector: minerIndex() = 0x9806b4d2 (confirmed in RESEARCH.md)
 */

import {
  LOTTERY_V2,
  LOTTERY_V2_DEPLOY_BLOCK,
  MINER_VAULT,
  MINER_VAULT_DEPLOY_BLOCK,
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
  contractVersion: "v1" | "v2" | "vault";
  dataStatus: "ok" | "early" | "no_data";
};

/**
 * Compute the headline dividends APR from the permanent miner-state vault.
 * Returns apr: null / dataStatus: "early" if its accumulator is < 24h old.
 */
export async function computeDividendsApr(
  asOfBlock?: bigint
): Promise<AprResult> {
  const head = await getHead();
  const nowBlock = asOfBlock ?? head.block;
  const nowTs = head.timestamp;

  const vaultDeployBlockInfo = await archivalGetBlock(MINER_VAULT_DEPLOY_BLOCK);
  if (!vaultDeployBlockInfo) {
    throw new Error("Failed to fetch miner vault deploy block");
  }
  const vaultDeployTs = vaultDeployBlockInfo.timestamp;

  const vaultAgeSeconds = Number(nowTs - vaultDeployTs);

  if (vaultAgeSeconds < APR_TRAIL_SECONDS) {
    return {
      apr: null,
      aprPercent: null,
      deltaIndex: null,
      indexNow: null,
      indexWindowStart: null,
      blockNow: nowBlock,
      blockWindowStart: null,
      tsWindowStart: null,
      windowSeconds: vaultAgeSeconds,
      windowDays: Math.round((vaultAgeSeconds / 86400) * 10) / 10,
      contractVersion: "vault",
      dataStatus: "early",
    };
  }

  // Trailing-24h window (full)
  const effectiveWindowSeconds = APR_TRAIL_SECONDS;

  // Target timestamp for window start
  const tsWindowStart = nowTs - BigInt(effectiveWindowSeconds);

  // Never cross the accumulator reset at the vault deployment.
  const windowStartBlockInfo = await resolveBlockAtTimestampFast(tsWindowStart);
  const blockWindowStart =
    windowStartBlockInfo.block < MINER_VAULT_DEPLOY_BLOCK
      ? MINER_VAULT_DEPLOY_BLOCK
      : windowStartBlockInfo.block;

  // Miner state belongs to the vault, not the current lottery generation.
  const [rawNow, rawWindowStart] = await Promise.all([
    archivalCall(MINER_VAULT, MINER_INDEX_SELECTOR, nowBlock),
    archivalCall(MINER_VAULT, MINER_INDEX_SELECTOR, blockWindowStart),
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
      contractVersion: "vault",
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
    contractVersion: "vault",
    dataStatus: "ok",
  };
}

/**
 * Compute dividends APR for a historical backfill block, routing across the
 * V2-lottery → permanent-vault accumulator reset.
 *
 * @param sampleBlock  The block number being sampled (must be >= V2 deploy block)
 * @param sampleTs     The Unix timestamp of sampleBlock
 */
export async function computeHistoricalAprForBlock(
  sampleBlock: bigint,
  sampleTs: bigint
): Promise<AprResult> {
  const vaultEra = sampleBlock >= MINER_VAULT_DEPLOY_BLOCK;
  const contract = vaultEra ? MINER_VAULT : LOTTERY_V2;
  const contractDeployBlock = vaultEra
    ? MINER_VAULT_DEPLOY_BLOCK
    : LOTTERY_V2_DEPLOY_BLOCK;
  const contractVersion: "v2" | "vault" = vaultEra ? "vault" : "v2";

  // Fetch the active accumulator's deploy block to avoid crossing a reset.
  const deployBlockInfo = await archivalGetBlock(contractDeployBlock);
  if (!deployBlockInfo) {
    throw new Error(`Failed to fetch accumulator deploy block ${contractDeployBlock}`);
  }
  const contractDeployTs = deployBlockInfo.timestamp;

  // Age of the selected accumulator at sampleBlock.
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

  // Resolve block at window start without crossing this accumulator's reset.
  const windowStartBlockInfo = await resolveBlockAtTimestampFast(tsWindowStart);
  const blockWindowStart =
    windowStartBlockInfo.block < contractDeployBlock
      ? contractDeployBlock
      : windowStartBlockInfo.block;

  // Read minerIndex at both blocks from the selected state source.
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

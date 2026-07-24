/**
 * Dividends APR formula — index-delta method via archival eth_call.
 *
 * APR = (minerIndex(head) − minerIndex(block@now−7d)) / 1e18 × (SECONDS_PER_YEAR / W)
 *
 * Where W = 7 days (604,800 seconds).
 *
 * Source: METHODOLOGY.md §1, RESEARCH.md §4c.
 * The minerIndex is the cumulative refining fee per 1e18 unclaimed SLVR.
 * Δindex/WAD is the exact fractional return for a continuously-unclaimed miner over window W.
 *
 * V1/V2 continuity: V2 started its accumulator fresh at block 16,764,101.
 * For the live headline, use V2 exclusively.
 * APR is NULL if the 7d-ago block precedes V2 deploy.
 *
 * selector: minerIndex() = 0x9806b4d2 (confirmed in RESEARCH.md)
 */

import {
  LOTTERY_V2,
  LOTTERY_V2_DEPLOY_BLOCK,
  WAD,
  APR_WINDOW_SECONDS,
  SECONDS_PER_YEAR,
} from "../constants";
import { archivalCall, decodeUint256 } from "../rpc";
import { resolveBlockAtTimestampFast, getHead } from "../block-resolver";

// Function selector for minerIndex() — keccak256("minerIndex()")[0:4]
// Confirmed: 0x9806b4d2 (RESEARCH.md §4b, METHODOLOGY.md §2)
const MINER_INDEX_SELECTOR = "0x9806b4d2";

export type AprResult = {
  apr: number | null;
  aprPercent: number | null; // apr * 100
  deltaIndex: bigint | null;
  indexNow: bigint | null;
  index7dAgo: bigint | null;
  blockNow: bigint | null;
  block7dAgo: bigint | null;
  ts7dAgo: bigint | null;
  windowSeconds: number;
  contractVersion: "v2";
  dataStatus: "ok" | "insufficient_v2_data" | "v2_too_early";
};

export async function computeDividendsApr(
  asOfBlock?: bigint
): Promise<AprResult> {
  const head = await getHead();
  const nowBlock = asOfBlock ?? head.block;
  const nowTs = head.timestamp; // approximation for recent block

  // Target timestamp 7 days ago
  const ts7dAgo = nowTs - BigInt(APR_WINDOW_SECONDS);

  // Resolve the block at 7d ago
  const block7dInfo = await resolveBlockAtTimestampFast(ts7dAgo);
  const block7dAgo = block7dInfo.block;

  // If 7d-ago block precedes V2 deploy, APR is NULL
  if (block7dAgo < LOTTERY_V2_DEPLOY_BLOCK) {
    // Still read current minerIndex for display
    let indexNow: bigint | null = null;
    try {
      const rawNow = await archivalCall(LOTTERY_V2, MINER_INDEX_SELECTOR, nowBlock);
      indexNow = decodeUint256(rawNow);
    } catch {
      // ignore
    }
    return {
      apr: null,
      aprPercent: null,
      deltaIndex: null,
      indexNow,
      index7dAgo: null,
      blockNow: nowBlock,
      block7dAgo,
      ts7dAgo,
      windowSeconds: APR_WINDOW_SECONDS,
      contractVersion: "v2",
      dataStatus: "v2_too_early",
    };
  }

  // Read minerIndex at both blocks via archival eth_call
  const [rawNow, rawAgo] = await Promise.all([
    archivalCall(LOTTERY_V2, MINER_INDEX_SELECTOR, nowBlock),
    archivalCall(LOTTERY_V2, MINER_INDEX_SELECTOR, block7dAgo),
  ]);

  const indexNow = decodeUint256(rawNow);
  const index7dAgo = decodeUint256(rawAgo);
  const deltaIndex = indexNow - index7dAgo;

  if (deltaIndex <= 0n) {
    return {
      apr: 0,
      aprPercent: 0,
      deltaIndex,
      indexNow,
      index7dAgo,
      blockNow: nowBlock,
      block7dAgo,
      ts7dAgo,
      windowSeconds: APR_WINDOW_SECONDS,
      contractVersion: "v2",
      dataStatus: "ok",
    };
  }

  // Core formula: (Δindex / WAD) × (SECONDS_PER_YEAR / W)
  const apr = (Number(deltaIndex) / Number(WAD)) * (SECONDS_PER_YEAR / APR_WINDOW_SECONDS);

  return {
    apr,
    aprPercent: apr * 100,
    deltaIndex,
    indexNow,
    index7dAgo,
    blockNow: nowBlock,
    block7dAgo,
    ts7dAgo,
    windowSeconds: APR_WINDOW_SECONDS,
    contractVersion: "v2",
    dataStatus: "ok",
  };
}

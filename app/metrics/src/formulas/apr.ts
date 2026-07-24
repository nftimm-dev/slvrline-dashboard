/**
 * Dividends APR formula — index-delta method.
 *
 * APR = (minerIndex(t) − minerIndex(t − W)) / 1e18 × (SECONDS_PER_YEAR / W)
 *
 * Where W = 7 days (604,800 seconds).
 *
 * Source: METHODOLOGY.md §1, RESEARCH.md §4c.
 * The minerIndex is the cumulative refining fee per 1e18 unclaimed SLVR.
 * Δindex/WAD is the exact fractional return for a continuously-unclaimed miner over window W.
 *
 * V1/V2 continuity: V2 started its accumulator fresh at block 16,764,101.
 * For the live headline, use V2 exclusively.
 * If V2 has no rows, fall back to V1 for historical context (mark contractVersion = "v1").
 */

import { sql } from "../db";
import {
  LOTTERY_V1,
  LOTTERY_V2,
  WAD,
  APR_WINDOW_SECONDS,
  SECONDS_PER_YEAR,
} from "../constants";

export type AprResult = {
  apr: number | null;
  deltaIndex: bigint | null;
  indexNow: bigint | null;
  index7dAgo: bigint | null;
  blockNow: bigint | null;
  block7dAgo: bigint | null;
  windowSeconds: number;
  contractVersion: "v1" | "v2";
  dataStatus: "ok" | "insufficient_v2_data" | "no_events";
};

type IndexRow = {
  new_index: string; // NUMERIC comes back as string from postgres.js
  block_number: string;
  block_time: number;
};

export async function computeDividendsApr(asOfTime?: Date): Promise<AprResult> {
  const t = asOfTime ?? new Date();
  const tEpoch = Math.floor(t.getTime() / 1000);
  const windowStart = tEpoch - APR_WINDOW_SECONDS;

  const v2Addr = LOTTERY_V2.toLowerCase();
  const v1Addr = LOTTERY_V1.toLowerCase();

  // --- Try V2 first (always preferred for live and recent historical) ---
  const [indexNowRow] = await sql<IndexRow[]>`
    SELECT new_index, block_number, block_time
    FROM slvr.dividend_index_update
    WHERE contract_address = ${v2Addr}
      AND block_time <= ${tEpoch}
    ORDER BY block_number DESC
    LIMIT 1
  `;

  if (!indexNowRow) {
    // V2 has no data at all — try V1 as fallback for historical context
    const [v1NowRow] = await sql<IndexRow[]>`
      SELECT new_index, block_number, block_time
      FROM slvr.dividend_index_update
      WHERE contract_address = ${v1Addr}
        AND block_time <= ${tEpoch}
      ORDER BY block_number DESC
      LIMIT 1
    `;
    if (!v1NowRow) {
      return {
        apr: null,
        deltaIndex: null,
        indexNow: null,
        index7dAgo: null,
        blockNow: null,
        block7dAgo: null,
        windowSeconds: APR_WINDOW_SECONDS,
        contractVersion: "v2",
        dataStatus: "no_events",
      };
    }

    // V1 path
    const [v1AgoRow] = await sql<IndexRow[]>`
      SELECT new_index, block_number, block_time
      FROM slvr.dividend_index_update
      WHERE contract_address = ${v1Addr}
        AND block_time >= ${windowStart}
        AND block_time <= ${tEpoch}
      ORDER BY block_number ASC
      LIMIT 1
    `;

    if (!v1AgoRow) {
      return {
        apr: null,
        deltaIndex: null,
        indexNow: BigInt(v1NowRow.new_index),
        index7dAgo: null,
        blockNow: BigInt(v1NowRow.block_number),
        block7dAgo: null,
        windowSeconds: APR_WINDOW_SECONDS,
        contractVersion: "v1",
        dataStatus: "insufficient_v2_data",
      };
    }

    const indexNow = BigInt(v1NowRow.new_index);
    const index7dAgo = BigInt(v1AgoRow.new_index);
    const deltaIndex = indexNow - index7dAgo;

    if (deltaIndex <= 0n) {
      return {
        apr: 0,
        deltaIndex,
        indexNow,
        index7dAgo,
        blockNow: BigInt(v1NowRow.block_number),
        block7dAgo: BigInt(v1AgoRow.block_number),
        windowSeconds: APR_WINDOW_SECONDS,
        contractVersion: "v1",
        dataStatus: "ok",
      };
    }

    const apr = (Number(deltaIndex) / Number(WAD)) * (SECONDS_PER_YEAR / APR_WINDOW_SECONDS);
    return {
      apr,
      deltaIndex,
      indexNow,
      index7dAgo,
      blockNow: BigInt(v1NowRow.block_number),
      block7dAgo: BigInt(v1AgoRow.block_number),
      windowSeconds: APR_WINDOW_SECONDS,
      contractVersion: "v1",
      dataStatus: "ok",
    };
  }

  // V2 has current data — find the oldest V2 event within the 7-day window
  const [index7dAgoRow] = await sql<IndexRow[]>`
    SELECT new_index, block_number, block_time
    FROM slvr.dividend_index_update
    WHERE contract_address = ${v2Addr}
      AND block_time >= ${windowStart}
      AND block_time <= ${tEpoch}
    ORDER BY block_number ASC
    LIMIT 1
  `;

  if (!index7dAgoRow) {
    // V2 exists but has fewer than 7 days of data — null APR per plan spec
    return {
      apr: null,
      deltaIndex: null,
      indexNow: BigInt(indexNowRow.new_index),
      index7dAgo: null,
      blockNow: BigInt(indexNowRow.block_number),
      block7dAgo: null,
      windowSeconds: APR_WINDOW_SECONDS,
      contractVersion: "v2",
      dataStatus: "insufficient_v2_data",
    };
  }

  const indexNow = BigInt(indexNowRow.new_index);
  const index7dAgo = BigInt(index7dAgoRow.new_index);
  const deltaIndex = indexNow - index7dAgo;

  if (deltaIndex <= 0n) {
    return {
      apr: 0,
      deltaIndex,
      indexNow,
      index7dAgo,
      blockNow: BigInt(indexNowRow.block_number),
      block7dAgo: BigInt(index7dAgoRow.block_number),
      windowSeconds: APR_WINDOW_SECONDS,
      contractVersion: "v2",
      dataStatus: "ok",
    };
  }

  // Core formula: (Δindex / WAD) × (SECONDS_PER_YEAR / W)
  const apr = (Number(deltaIndex) / Number(WAD)) * (SECONDS_PER_YEAR / APR_WINDOW_SECONDS);

  return {
    apr,
    deltaIndex,
    indexNow,
    index7dAgo,
    blockNow: BigInt(indexNowRow.block_number),
    block7dAgo: BigInt(index7dAgoRow.block_number),
    windowSeconds: APR_WINDOW_SECONDS,
    contractVersion: "v2",
    dataStatus: "ok",
  };
}

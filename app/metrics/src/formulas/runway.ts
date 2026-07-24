/**
 * Mining runway computation.
 *
 * remaining_cap = 500,000e18 − total_emitted
 * rate_30d      = SUM(token_transfer.value WHERE is_mint=true AND block_time >= NOW()-30d)
 * runway_months = remaining_cap / rate_30d
 *                 (remaining_cap and rate_30d both in raw units; result = months remaining)
 *
 * Emissions source: token_transfer WHERE is_mint=true (Transfer from 0x0).
 * This is canonical per RESEARCH.md §1c: Hub RewardMinted is a per-game signal;
 * token Transfer-from-zero is the supply ground truth (also captures 8%/4% team/growth).
 *
 * If rate_30d == 0 (no emissions in last 30 days), runway_months = null.
 */

import { sql } from "../db";
import { SLVR_CAP } from "../constants";

export type RunwayResult = {
  remainingCapRaw: bigint;
  totalEmittedRaw: bigint;
  rate30dRaw: bigint;
  runwayMonths: number | null;
  hubConfiguredRatePerSec: bigint | null;
  dataStatus: "ok" | "no_emissions_in_30d";
};

export async function computeRunway(asOfTime?: Date): Promise<RunwayResult> {
  const tEpoch = asOfTime ? Math.floor(asOfTime.getTime() / 1000) : Math.floor(Date.now() / 1000);
  const thirtyDaysAgo = tEpoch - 30 * 24 * 3600;

  // Total ever emitted (mints from 0x0 address)
  const [emitRow] = await sql<[{ total: string | null }]>`
    SELECT SUM(value)::text AS total
    FROM slvr.token_transfer
    WHERE is_mint = true
      AND block_time <= ${tEpoch}
  `;
  const totalEmittedRaw = BigInt(emitRow?.total ?? "0");
  const remainingCapRaw = SLVR_CAP > totalEmittedRaw ? SLVR_CAP - totalEmittedRaw : 0n;

  // 30-day emission rate
  const [rate30dRow] = await sql<[{ total: string | null }]>`
    SELECT SUM(value)::text AS total
    FROM slvr.token_transfer
    WHERE is_mint = true
      AND block_time >= ${thirtyDaysAgo}
      AND block_time <= ${tEpoch}
  `;
  const rate30dRaw = BigInt(rate30dRow?.total ?? "0");

  // Latest hub_emission_rate for audit cross-check
  let hubConfiguredRatePerSec: bigint | null = null;
  try {
    const [hubRow] = await sql<[{ rate_per_sec: string }]>`
      SELECT rate_per_sec::text
      FROM slvr.hub_emission_rate
      ORDER BY block_number DESC
      LIMIT 1
    `;
    if (hubRow) {
      hubConfiguredRatePerSec = BigInt(hubRow.rate_per_sec);
    }
  } catch {
    hubConfiguredRatePerSec = null;
  }

  if (rate30dRaw === 0n) {
    return {
      remainingCapRaw,
      totalEmittedRaw,
      rate30dRaw,
      runwayMonths: null,
      hubConfiguredRatePerSec,
      dataStatus: "no_emissions_in_30d",
    };
  }

  // runway_months = remaining_cap / rate_30d
  // (rate_30d is SLVR emitted over 30 days; remaining / rate = months remaining)
  const runwayMonths = Number(remainingCapRaw) / Number(rate30dRaw);

  return {
    remainingCapRaw,
    totalEmittedRaw,
    rate30dRaw,
    runwayMonths,
    hubConfiguredRatePerSec,
    dataStatus: "ok",
  };
}

/**
 * veSLVR staking totals.
 *
 * Total locked = SUM(ve_lock.current_amount) WHERE is_active = true
 * Timelocked   = above WHERE is_permanent = false
 * Permanent    = above WHERE is_permanent = true
 *
 * NOTE: LP staking positions hold LP tokens (not raw SLVR) and are NOT summed here.
 * They are displayed separately on the frontend (Phase 5).
 *
 * NOTE on permanent locks: permanently locked SLVR is burned from totalSupply()
 * (RESEARCH.md §5). Counting it in total_staked is informational — it shows how much
 * SLVR was committed to permanent locks (even though those tokens are now burned).
 *
 * For the live (non-backfill) snapshot, use the current-state ve_lock table (fast).
 * For historical backfill, use ve_lock_event to reconstruct state as of asOfTime.
 */

import { sql } from "../db";

export type StakingResult = {
  totalLockedRaw: bigint;
  timelockedRaw: bigint;
  permanentRaw: bigint;
  activeLockCount: number;
  lpTotalNote: string;
};

type StakingRow = {
  total_locked: string | null;
  timelocked: string | null;
  permanent: string | null;
  active_lock_count: string | null;
};

export async function computeStaking(asOfTime?: Date): Promise<StakingResult> {
  // For live snapshot: query current-state ve_lock table directly (accurate + fast)
  // For historical backfill: use ve_lock_event with block_time filter (see backfill.ts)
  const [row] = await sql<StakingRow[]>`
    SELECT
      SUM(current_amount) FILTER (WHERE is_active = true)::text                              AS total_locked,
      SUM(current_amount) FILTER (WHERE is_active = true AND is_permanent = false)::text     AS timelocked,
      SUM(current_amount) FILTER (WHERE is_active = true AND is_permanent = true)::text      AS permanent,
      COUNT(*)            FILTER (WHERE is_active = true)::text                              AS active_lock_count
    FROM slvr.ve_lock
  `;

  // Suppress unused parameter warning — asOfTime is used in backfill.ts via ve_lock_event
  void asOfTime;

  return {
    totalLockedRaw: BigInt(row?.total_locked ?? "0"),
    timelockedRaw: BigInt(row?.timelocked ?? "0"),
    permanentRaw: BigInt(row?.permanent ?? "0"),
    activeLockCount: Number(row?.active_lock_count ?? 0),
    lpTotalNote:
      "LP staking holds LP tokens (not raw SLVR) — excluded from total. Display LP staked separately (Phase 5).",
  };
}

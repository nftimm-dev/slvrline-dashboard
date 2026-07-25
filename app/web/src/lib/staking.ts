/**
 * Shared types for the staking page. The actual data is served by
 * /api/staking, which reads the LATEST `total_staked_slvr` snapshot from
 * metrics.metric_snapshots (top-lockers + size-buckets are precomputed by the
 * metrics job every 10 min). No on-request chain enumeration lives here.
 *
 * The heavy ve enumeration now runs only in app/metrics (formulas/staking.ts).
 * lib/veLocks.ts is retained for that side / reference and is NOT in the
 * request path.
 */

export interface TopLocker {
  owner: string;
  label: string | null;
  amountSlvr: number;
  lockCount: number;
  /** True if all of this owner's locks are permanent. */
  allPermanent: boolean;
  hasPermanent: boolean;
}

export interface SizeBucket {
  range: string;
  count: number;
  totalSlvr: number;
}

export interface StakingData {
  totalLockedSlvr: number;
  permanentSlvr: number;
  timelockedSlvr: number;
  activeLockCount: number;
  avgLockSlvr: number;
  lpStaked: number;
  uniqueOwners: number;
  topLockers: TopLocker[];
  sizeBuckets: SizeBucket[];
  /** ISO timestamp of the source snapshot row. */
  updatedAt: string;
}

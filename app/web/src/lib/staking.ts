/**
 * Staking page aggregation. Wraps the heavy on-chain ve enumeration
 * (lib/veLocks) and derives display-oriented rollups: top lockers (grouped by
 * owner), lock-size distribution buckets, and averages.
 *
 * The ve enumeration is ~1,600 tokenIds / ~40s uncached, so we cache the whole
 * aggregate for 30 minutes.
 */
import { withCache } from "./cache";
import { computeVeAggregate, type VeLock } from "./veLocks";
import { getLabel } from "./labels";

const CACHE_TTL = 1800; // 30 min
const CACHE_KEY = "staking:page";
const TOP_LOCKERS = 12;

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
  atBlock: string;
  cachedAt: string;
  cacheTtlSeconds: number;
}

const SCALE = 1e18;

// Bucket edges in whole SLVR. Last bucket is open-ended.
const BUCKET_EDGES = [1, 10, 50, 100, 500, 1000];

function bucketLabel(i: number): string {
  if (i === 0) return `< ${BUCKET_EDGES[0]}`;
  if (i === BUCKET_EDGES.length) return `${BUCKET_EDGES[i - 1]}+`;
  return `${BUCKET_EDGES[i - 1]}–${BUCKET_EDGES[i]}`;
}

function bucketIndex(amountSlvr: number): number {
  for (let i = 0; i < BUCKET_EDGES.length; i++) {
    if (amountSlvr < BUCKET_EDGES[i]) return i;
  }
  return BUCKET_EDGES.length;
}

function buildBuckets(locks: VeLock[]): SizeBucket[] {
  const counts = new Array(BUCKET_EDGES.length + 1).fill(0);
  const totals = new Array(BUCKET_EDGES.length + 1).fill(0);
  for (const l of locks) {
    const amt = Number(l.amountRaw) / SCALE;
    const idx = bucketIndex(amt);
    counts[idx] += 1;
    totals[idx] += amt;
  }
  return counts.map((count, i) => ({
    range: bucketLabel(i),
    count,
    totalSlvr: totals[i],
  }));
}

function buildTopLockers(locks: VeLock[]): {
  top: TopLocker[];
  uniqueOwners: number;
} {
  const byOwner = new Map<
    string,
    { amount: bigint; count: number; perm: number }
  >();
  for (const l of locks) {
    const cur = byOwner.get(l.owner) ?? { amount: 0n, count: 0, perm: 0 };
    cur.amount += l.amountRaw;
    cur.count += 1;
    if (l.permanent) cur.perm += 1;
    byOwner.set(l.owner, cur);
  }

  const all = [...byOwner.entries()].map(([owner, agg]) => ({
    owner,
    label: getLabel(owner),
    amountSlvr: Number(agg.amount) / SCALE,
    lockCount: agg.count,
    allPermanent: agg.perm === agg.count,
    hasPermanent: agg.perm > 0,
  }));

  all.sort((a, b) => b.amountSlvr - a.amountSlvr);

  return { top: all.slice(0, TOP_LOCKERS), uniqueOwners: byOwner.size };
}

async function fetchStaking(): Promise<StakingData> {
  const agg = await computeVeAggregate();

  const totalLockedSlvr = Number(agg.totalLockedRaw) / SCALE;
  const permanentSlvr = Number(agg.permanentRaw) / SCALE;
  const timelockedSlvr = Number(agg.timelockedRaw) / SCALE;
  const lpStaked = Number(agg.lpStakedRaw) / SCALE;
  const avgLockSlvr =
    agg.activeLockCount > 0 ? totalLockedSlvr / agg.activeLockCount : 0;

  const { top: topLockers, uniqueOwners } = buildTopLockers(agg.locks);
  const sizeBuckets = buildBuckets(agg.locks);

  return {
    totalLockedSlvr,
    permanentSlvr,
    timelockedSlvr,
    activeLockCount: agg.activeLockCount,
    avgLockSlvr,
    lpStaked,
    uniqueOwners,
    topLockers,
    sizeBuckets,
    atBlock: agg.atBlock,
    cachedAt: new Date().toISOString(),
    cacheTtlSeconds: CACHE_TTL,
  };
}

export async function getStakingData(): Promise<StakingData> {
  return withCache(CACHE_KEY, CACHE_TTL, fetchStaking);
}

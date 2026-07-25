/**
 * GET /api/staking
 *
 * veSLVR + LP staking snapshot, served DIRECTLY from the DB — no on-request chain
 * enumeration. The metrics job (every 10 min) enumerates every ve lock NFT, reads
 * each lock's on-chain state, and writes the rolled-up top-lockers / size-buckets
 * into the LATEST `total_staked_slvr` snapshot's metadata. We just read that row.
 *
 * <100ms. The heavy enumeration lives in app/metrics (formulas/staking.ts) and
 * lib/veLocks.ts is kept for that side / not in this request path.
 */
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getLabel } from "@/lib/labels";

export const dynamic = "force-dynamic";

interface TopLockerMeta {
  owner: string;
  amount: number;
  permanent: boolean;
  lockCount?: number;
}

interface SizeBucketMeta {
  range: string;
  count: number;
  totalSlvr: number;
}

interface StakingSnapshotRow {
  value: string | null;
  value2: string | null;
  value3: string | null;
  metadata: {
    active_lock_count?: number;
    lp_staked_raw?: string;
    lp_staked_lp_tokens?: string;
    unique_owners?: number;
    top_lockers?: TopLockerMeta[];
    size_buckets?: SizeBucketMeta[];
  } | null;
  snapshot_at: Date;
}

export async function GET() {
  try {
    const db = getDb();
    const [row] = await db<StakingSnapshotRow[]>`
      SELECT value, value2, value3, metadata, snapshot_at
      FROM metrics.metric_snapshots
      WHERE metric_name = 'total_staked_slvr'
        AND value IS NOT NULL
      ORDER BY snapshot_at DESC
      LIMIT 1
    `;

    if (!row) {
      return NextResponse.json(
        { error: "Staking data not yet computed" },
        { status: 503 }
      );
    }

    const meta = row.metadata ?? {};
    const num = (v: string | null): number => (v !== null ? parseFloat(v) : 0);

    const totalLockedSlvr = num(row.value);
    const activeLockCount = meta.active_lock_count ?? 0;
    const lpStaked = meta.lp_staked_raw ? Number(meta.lp_staked_raw) / 1e18 : 0;

    const topLockers = (meta.top_lockers ?? []).map((l) => ({
      owner: l.owner,
      label: getLabel(l.owner),
      amountSlvr: l.amount,
      lockCount: l.lockCount ?? 1,
      // The metrics job flags a locker permanent iff ALL their locks are permanent.
      allPermanent: l.permanent,
      hasPermanent: l.permanent,
    }));

    const sizeBuckets = (meta.size_buckets ?? []).map((b) => ({
      range: b.range,
      count: b.count,
      totalSlvr: b.totalSlvr,
    }));

    return NextResponse.json(
      {
        totalLockedSlvr,
        permanentSlvr: num(row.value2),
        timelockedSlvr: num(row.value3),
        activeLockCount,
        avgLockSlvr: activeLockCount > 0 ? totalLockedSlvr / activeLockCount : 0,
        uniqueOwners: meta.unique_owners ?? topLockers.length,
        lpStaked,
        topLockers,
        sizeBuckets,
        updatedAt: row.snapshot_at.toISOString(),
      },
      {
        headers: {
          "Cache-Control": "public, max-age=60",
          "X-Data-Sources": "metrics-db",
        },
      }
    );
  } catch (err) {
    console.error("[/api/staking] error:", err);
    return NextResponse.json(
      { error: "Staking data temporarily unavailable" },
      { status: 502 }
    );
  }
}

/**
 * Writes one row to metrics.metric_snapshots.
 *
 * For live runs: always append (no ON CONFLICT) — each run produces a new time-series point.
 * For backfill runs: pass backfill=true to get idempotent ON CONFLICT DO NOTHING behavior.
 *
 * The metrics schema is separate from slvr (which Ponder owns and rebuilds).
 * This prevents Ponder from dropping metric_snapshots during re-indexes.
 */

import { sql } from "./db";

export type SnapshotParams = {
  metricName: string;
  value: number | null;
  value2?: number | null;
  value3?: number | null;
  metadata?: Record<string, unknown>;
  snapshotAt?: Date;
  blockNumber: bigint;
  backfill?: boolean;
};

export async function writeSnapshot(params: SnapshotParams): Promise<void> {
  const {
    metricName,
    value,
    value2 = null,
    value3 = null,
    metadata = {},
    snapshotAt = new Date(),
    blockNumber,
    backfill = false,
  } = params;

  const metadataJson = JSON.stringify(metadata);

  if (backfill) {
    // Idempotent: skip if a row for (metric_name, snapshot_at) already exists
    await sql`
      INSERT INTO metrics.metric_snapshots
        (metric_name, value, value2, value3, metadata, snapshot_at, block_number)
      VALUES (
        ${metricName},
        ${value},
        ${value2},
        ${value3},
        ${metadataJson}::jsonb,
        ${snapshotAt},
        ${blockNumber.toString()}
      )
      ON CONFLICT DO NOTHING
    `;
  } else {
    // Live run: always append a new row
    await sql`
      INSERT INTO metrics.metric_snapshots
        (metric_name, value, value2, value3, metadata, snapshot_at, block_number)
      VALUES (
        ${metricName},
        ${value},
        ${value2},
        ${value3},
        ${metadataJson}::jsonb,
        ${snapshotAt},
        ${blockNumber.toString()}
      )
    `;
  }
}

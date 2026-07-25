/**
 * GET /api/history?metric=<name>&range=<24h|7d|30d|90d|all>
 *
 * Returns time-series rows for a single metric from metrics.metric_snapshots.
 * Filters out NULL value rows so charts always have clean data.
 *
 * Cache: HTTP Cache-Control: public, max-age=300 (5 minutes via CDN/browser).
 * No in-process cache — the index makes these queries fast (<20ms).
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";

const KNOWN_METRICS = [
  "dividends_apr",
  "circulating_supply",
  "runway_months",
  "total_staked_slvr",
  "lottery_round_state",
  "emission_rate_30d",
] as const;

const KNOWN_RANGES = ["24h", "7d", "30d", "90d", "all"] as const;

const QuerySchema = z.object({
  metric: z.enum(KNOWN_METRICS, {
    errorMap: () => ({
      message: `metric must be one of: ${KNOWN_METRICS.join(", ")}`,
    }),
  }),
  range: z
    .enum(KNOWN_RANGES, {
      errorMap: () => ({
        message: `range must be one of: ${KNOWN_RANGES.join(", ")}`,
      }),
    })
    .default("7d"),
});

const RANGE_TO_INTERVAL: Record<string, string> = {
  "24h": "24 hours",
  "7d": "7 days",
  "30d": "30 days",
  "90d": "90 days",
};

interface HistoryRow {
  t: Date;
  v: string | null;
  v2: string | null;
  v3: string | null;
  block: string | null;
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const rawParams = {
    metric: searchParams.get("metric") ?? undefined,
    range: searchParams.get("range") ?? undefined,
  };

  const parsed = QuerySchema.safeParse(rawParams);
  if (!parsed.success) {
    const firstError = parsed.error.errors[0];
    return NextResponse.json(
      { error: firstError?.message ?? "invalid params" },
      { status: 400 }
    );
  }

  const { metric, range } = parsed.data;

  // Hard floor: never return data before the V2 migration (2026-07-22T21:53:52Z).
  // This rebases all charts to the GridLottery V2 deploy, ignoring pre-migration history.
  const MIGRATION_FLOOR = "2026-07-22T21:53:52Z";

  try {
    const db = getDb();
    let rows: HistoryRow[];

    if (range === "all") {
      rows = await db<HistoryRow[]>`
        SELECT
          snapshot_at  AS t,
          value        AS v,
          value2       AS v2,
          value3       AS v3,
          block_number AS block
        FROM metrics.metric_snapshots
        WHERE metric_name = ${metric}
          AND value IS NOT NULL
          AND snapshot_at >= ${MIGRATION_FLOOR}::timestamptz
        ORDER BY snapshot_at ASC
      `;
    } else {
      const interval = RANGE_TO_INTERVAL[range]!;
      rows = await db<HistoryRow[]>`
        SELECT
          snapshot_at  AS t,
          value        AS v,
          value2       AS v2,
          value3       AS v3,
          block_number AS block
        FROM metrics.metric_snapshots
        WHERE metric_name = ${metric}
          AND value IS NOT NULL
          AND snapshot_at >= GREATEST(NOW() - ${`${interval}`}::interval, ${MIGRATION_FLOOR}::timestamptz)
        ORDER BY snapshot_at ASC
      `;
    }

    const body = {
      metric,
      range,
      rows: rows.map((r) => ({
        t: r.t.toISOString(),
        v: r.v !== null ? parseFloat(r.v) : null,
        v2: r.v2 !== null ? parseFloat(r.v2) : null,
        v3: r.v3 !== null ? parseFloat(r.v3) : null,
        block: r.block !== null ? parseInt(r.block, 10) : null,
      })),
    };

    return NextResponse.json(body, {
      headers: {
        "Cache-Control": "public, max-age=300",
      },
    });
  } catch (err) {
    console.error("[/api/history] error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

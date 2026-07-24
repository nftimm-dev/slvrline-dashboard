/**
 * GET /api/vitals
 *
 * Returns the latest pre-computed snapshot for each headline metric plus live
 * SLVR price from the Dexscreener proxy.
 *
 * DB: single DISTINCT ON query, five rows.
 * Cache: 10s in-process TTL for DB result; 60s TTL for price (shared with /api/market).
 * Target: <200ms total (warm cache path typically <5ms).
 */
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { withCache } from "@/lib/cache";
import { getMarketData } from "@/lib/dexscreener";

const KNOWN_METRICS = [
  "dividends_apr",
  "circulating_supply",
  "runway_months",
  "total_staked_slvr",
  "lottery_round_state",
] as const;

type MetricName = (typeof KNOWN_METRICS)[number];

interface MetricRow {
  metric_name: string;
  value: string | null;
  value2: string | null;
  value3: string | null;
  snapshot_at: Date;
  block_number: string | null;
  metadata: Record<string, unknown> | null;
}

interface MetricResult {
  value: number | null;
  value2?: number | null;
  value3?: number | null;
  unit: string;
  snapshot_at: string;
  block_number: number | null;
  metadata?: Record<string, unknown> | null;
}

const UNITS: Record<MetricName, string> = {
  dividends_apr: "percent",
  circulating_supply: "slvr",
  runway_months: "months",
  total_staked_slvr: "slvr",
  lottery_round_state: "round",
};

async function fetchVitalsFromDb(): Promise<
  Record<string, MetricResult>
> {
  const db = getDb();
  const rows = await db<MetricRow[]>`
    SELECT DISTINCT ON (metric_name)
      metric_name,
      value,
      value2,
      value3,
      snapshot_at,
      block_number,
      metadata
    FROM metrics.metric_snapshots
    WHERE metric_name = ANY(${KNOWN_METRICS as unknown as string[]})
      AND value IS NOT NULL
    ORDER BY metric_name, snapshot_at DESC
  `;

  const result: Record<string, MetricResult> = {};
  for (const row of rows) {
    const name = row.metric_name as MetricName;
    result[name] = {
      value: row.value !== null ? parseFloat(row.value) : null,
      value2: row.value2 !== null ? parseFloat(row.value2) : null,
      value3: row.value3 !== null ? parseFloat(row.value3) : null,
      unit: UNITS[name] ?? "unknown",
      snapshot_at: row.snapshot_at.toISOString(),
      block_number:
        row.block_number !== null ? parseInt(row.block_number, 10) : null,
      metadata: row.metadata,
    };
  }
  return result;
}

export async function GET() {
  try {
    // Fetch DB metrics (10s TTL) and price (60s TTL) in parallel
    const [metrics, market] = await Promise.all([
      withCache("vitals:db", 10, fetchVitalsFromDb),
      getMarketData(),
    ]);

    const body = {
      ...metrics,
      price: {
        slvr_usd: market.slvr_usd,
        slvr_eth: market.slvr_eth,
        eth_usd: market.eth_usd,
        cached_at: market.cached_at,
        cache_ttl_seconds: market.cache_ttl_seconds,
      },
    };

    return NextResponse.json(body, {
      headers: {
        "Cache-Control": "no-store",
        "X-Data-Sources": "postgres,dexscreener",
      },
    });
  } catch (err) {
    console.error("[/api/vitals] error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/buybacks
 *
 * Buyback-and-burn snapshot: cumulative SLVR burned + ETH/USD spent, the current
 * daily rate, cadence, and the most recent buybacks. Served from the latest
 * `buyback_totals` row in metrics.metric_snapshots (written by the metrics cron
 * from the executor's on-chain BuybackBurned events).
 *
 * Cache: 30s in-process TTL.
 */
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { withCache } from "@/lib/cache";
import type { BuybackData, BuybackRecentEvent } from "@/lib/buybacks";

// Robinhood Chain ~10 blocks/sec — used to approximate an event's wall-clock time
// from its block relative to the snapshot's block/timestamp.
const APPROX_BLOCKS_PER_SEC = 10;

interface Row {
  value: string | null;
  value2: string | null;
  value3: string | null;
  metadata: Record<string, unknown> | null;
  snapshot_at: Date;
  block_number: string | null;
}

function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

async function fetchBuybacks(): Promise<BuybackData | null> {
  const db = getDb();
  const [row] = await db<Row[]>`
    SELECT value, value2, value3, metadata, snapshot_at, block_number
    FROM metrics.metric_snapshots
    WHERE metric_name = 'buyback_totals'
      AND value IS NOT NULL
    ORDER BY snapshot_at DESC
    LIMIT 1
  `;
  if (!row) return null;

  const m = (row.metadata ?? {}) as Record<string, unknown>;
  const num = (v: string | null): number => (v !== null ? parseFloat(v) : 0);

  const snapBlock = row.block_number !== null ? parseInt(row.block_number, 10) : null;
  const snapMs = row.snapshot_at.getTime();

  const recentRaw = Array.isArray(m.recent) ? (m.recent as Array<Record<string, unknown>>) : [];
  const recent: BuybackRecentEvent[] = recentRaw.map((e) => {
    const block = parseInt(String(e.block), 10);
    const approxTs =
      snapBlock !== null && Number.isFinite(block)
        ? snapMs - ((snapBlock - block) / APPROX_BLOCKS_PER_SEC) * 1000
        : snapMs;
    return {
      block: Number.isFinite(block) ? block : 0,
      eth: Number(e.eth) || 0,
      slvr: Number(e.slvr) || 0,
      approxTs,
    };
  });

  return {
    cumulativeSlvr: num(row.value),
    cumulativeEth: num(row.value2),
    cumulativeUsd: numOrNull(m.cumulative_usd_spent),
    dailySlvr: num(row.value3),
    dailyEth: numOrNull(m.daily_eth) ?? 0,
    dailyUsd: numOrNull(m.daily_usd),
    buybackCount: numOrNull(m.buyback_count) ?? 0,
    buybacksPerDay: numOrNull(m.buybacks_per_day),
    avgIntervalSec: numOrNull(m.avg_interval_sec),
    ethUsd: numOrNull(m.eth_usd),
    graveyardBalanceSlvr: numOrNull(m.graveyard_balance_slvr),
    graveyardMatch: typeof m.graveyard_match === "boolean" ? m.graveyard_match : null,
    recent,
    updatedAt: row.snapshot_at.toISOString(),
  };
}

export async function GET() {
  try {
    const data = await withCache("buybacks:latest", 30, fetchBuybacks);
    if (!data) {
      return NextResponse.json(
        { error: "Buyback data not yet computed" },
        { status: 503 }
      );
    }
    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "no-store",
        "X-Data-Sources": "postgres",
      },
    });
  } catch (err) {
    console.error("[/api/buybacks] error:", err);
    return NextResponse.json(
      { error: "Buyback data temporarily unavailable" },
      { status: 502 }
    );
  }
}

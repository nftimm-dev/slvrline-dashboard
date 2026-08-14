/**
 * GET /api/buybacks
 *
 * Buyback-and-burn snapshot. Cumulative SLVR burned + ETH/USD spent and the daily
 * rate come from the latest `buyback_totals` row in metrics.metric_snapshots. The
 * recent-buybacks feed + cadence are read LIVE from the executor's on-chain
 * BuybackBurned events (fresh to the second, and never blank between cron ticks).
 *
 * Cache: 30s in-process TTL.
 */
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { withCache } from "@/lib/cache";
import { ethBlockNumber, getLogsAdaptive } from "@/lib/rpc";
import type { BuybackData, BuybackRecentEvent } from "@/lib/buybacks";

// Buyback executor (emits BuybackBurned) + event topic0.
const BUYBACK_EXECUTOR = "0xacdd8E9bad637798dBdb23a59cfa314743668bA4";
const BUYBACK_BURNED_TOPIC0 =
  "0xc65a4c73cfd820dccb7079db9e52bb2c09dfd56f9221e7d815e201b726b5c39d";
// Robinhood Chain ~10 blocks/sec.
const BLOCKS_PER_SEC = 10;
// Look back ~4h so the recent-buybacks feed shows real history, not just ~30 min.
const RECENT_WINDOW_BLOCKS = 150_000n;
const RECENT_LIMIT = 200;
// Cadence is measured over a shorter, more representative recent window.
const CADENCE_WINDOW_BLOCKS = 30_000n;

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

/** Decode BuybackBurned(ethIn, tokensBurned) from a log's data blob → SLVR/ETH. */
function decode(data: string): { eth: number; slvr: number } {
  const body = data && data !== "0x" ? data.replace(/^0x/, "") : "";
  const eth = body.length >= 64 ? Number(BigInt("0x" + body.slice(0, 64))) / 1e18 : 0;
  const slvr = body.length >= 128 ? Number(BigInt("0x" + body.slice(64, 128))) / 1e18 : 0;
  return { eth, slvr };
}

interface LiveRecent {
  recent: BuybackRecentEvent[];
  avgIntervalSec: number | null;
  buybacksPerDay: number | null;
}

/** Live recent buybacks + cadence from the executor's BuybackBurned events. */
async function fetchRecentLive(): Promise<LiveRecent | null> {
  try {
    const head = await ethBlockNumber();
    const from = head > RECENT_WINDOW_BLOCKS ? head - RECENT_WINDOW_BLOCKS : 0n;
    const logs = await getLogsAdaptive({
      address: BUYBACK_EXECUTOR,
      topics: [BUYBACK_BURNED_TOPIC0],
      fromBlock: from,
      toBlock: head,
    });

    const evs = logs
      .map((l) => {
        const { eth, slvr } = decode(l.data);
        return { block: Number(BigInt(l.blockNumber)), eth, slvr };
      })
      .sort((a, b) => b.block - a.block); // newest first

    if (evs.length === 0) return { recent: [], avgIntervalSec: null, buybacksPerDay: null };

    const headNum = Number(head);
    const nowMs = Date.now();
    const recent: BuybackRecentEvent[] = evs.slice(0, RECENT_LIMIT).map((e) => ({
      block: e.block,
      eth: e.eth,
      slvr: e.slvr,
      approxTs: nowMs - ((headNum - e.block) / BLOCKS_PER_SEC) * 1000,
    }));

    // Cadence: average gap over the recent (shorter) window so it reflects the
    // CURRENT rate, not a 4h average that a gap could skew.
    const cadenceFloor = headNum - Number(CADENCE_WINDOW_BLOCKS);
    const cadEvs = evs.filter((e) => e.block >= cadenceFloor);
    let avgIntervalSec: number | null = null;
    let buybacksPerDay: number | null = null;
    if (cadEvs.length > 1) {
      const spanSec = (cadEvs[0].block - cadEvs[cadEvs.length - 1].block) / BLOCKS_PER_SEC;
      avgIntervalSec = spanSec / (cadEvs.length - 1);
      buybacksPerDay = avgIntervalSec > 0 ? 86_400 / avgIntervalSec : null;
    }
    return { recent, avgIntervalSec, buybacksPerDay };
  } catch {
    return null; // fall back to snapshot metadata
  }
}

async function fetchBuybacks(): Promise<BuybackData | null> {
  const db = getDb();
  const [[row], live] = await Promise.all([
    db<Row[]>`
      SELECT value, value2, value3, metadata, snapshot_at, block_number
      FROM metrics.metric_snapshots
      WHERE metric_name = 'buyback_totals'
        AND value IS NOT NULL
      ORDER BY snapshot_at DESC
      LIMIT 1
    `,
    fetchRecentLive(),
  ]);
  if (!row) return null;

  const m = (row.metadata ?? {}) as Record<string, unknown>;
  const num = (v: string | null): number => (v !== null ? parseFloat(v) : 0);

  // Snapshot-metadata recent (fallback) — approx time from snapshot block/time.
  const snapBlock = row.block_number !== null ? parseInt(row.block_number, 10) : null;
  const snapMs = row.snapshot_at.getTime();
  const metaRecentRaw = Array.isArray(m.recent) ? (m.recent as Array<Record<string, unknown>>) : [];
  const metaRecent: BuybackRecentEvent[] = metaRecentRaw.map((e) => {
    const block = parseInt(String(e.block), 10);
    return {
      block: Number.isFinite(block) ? block : 0,
      eth: Number(e.eth) || 0,
      slvr: Number(e.slvr) || 0,
      approxTs:
        snapBlock !== null && Number.isFinite(block)
          ? snapMs - ((snapBlock - block) / BLOCKS_PER_SEC) * 1000
          : snapMs,
    };
  });

  // Prefer the live feed; fall back to snapshot metadata if the RPC is unavailable.
  const recent = live && live.recent.length ? live.recent : metaRecent;
  const avgIntervalSec = live?.avgIntervalSec ?? numOrNull(m.avg_interval_sec);
  const buybacksPerDay = live?.buybacksPerDay ?? numOrNull(m.buybacks_per_day);

  return {
    cumulativeSlvr: num(row.value),
    cumulativeEth: num(row.value2),
    cumulativeUsd: numOrNull(m.cumulative_usd_spent),
    dailySlvr: num(row.value3),
    dailyEth: numOrNull(m.daily_eth) ?? 0,
    dailyUsd: numOrNull(m.daily_usd),
    buybackCount: numOrNull(m.buyback_count) ?? 0,
    buybacksPerDay,
    avgIntervalSec,
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
        "X-Data-Sources": "postgres,robinhood-rpc",
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

/**
 * GET /api/markets
 *
 * SLVR liquidity + volume across every Dexscreener-indexed pool on Robinhood
 * Chain: headline totals, per-pair rows, and a liquidity-by-venue rollup.
 * Cache: 60-second in-process TTL (via lib/markets).
 */
import { NextResponse } from "next/server";
import { getMarketsData } from "@/lib/markets";

export async function GET() {
  try {
    const data = await getMarketsData();
    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "no-store",
        "X-Data-Sources": "dexscreener",
      },
    });
  } catch (err) {
    console.error("[/api/markets] error:", err);
    return NextResponse.json(
      { error: "Markets data temporarily unavailable" },
      { status: 502 }
    );
  }
}

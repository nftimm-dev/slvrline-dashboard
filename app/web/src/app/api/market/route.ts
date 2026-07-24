/**
 * GET /api/market
 *
 * Returns SLVR price and total liquidity aggregated across ALL Dexscreener pools.
 * ETH price from slvr.fun/api/price/eth.
 * Cache: 60-second in-process TTL (shared with /api/vitals price field).
 */
import { NextResponse } from "next/server";
import { getMarketData } from "@/lib/dexscreener";

export async function GET() {
  try {
    const data = await getMarketData();
    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "no-store",
        "X-Data-Sources": "dexscreener,slvr.fun",
      },
    });
  } catch (err) {
    console.error("[/api/market] error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

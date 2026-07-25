/**
 * GET /api/lottery
 *
 * Live GridLottery V2 snapshot: current round, jackpot (ETH), unclaimed rewards
 * pool (SLVR), cumulative refined (SLVR), and the current refining index.
 * Cache: 30-second in-process TTL.
 */
import { NextResponse } from "next/server";
import { getLotteryData } from "@/lib/lottery";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const data = await getLotteryData();
    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "no-store",
        "X-Data-Sources": "robinhood-rpc",
      },
    });
  } catch (err) {
    console.error("[/api/lottery] error:", err);
    return NextResponse.json(
      { error: "Lottery data temporarily unavailable" },
      { status: 502 }
    );
  }
}

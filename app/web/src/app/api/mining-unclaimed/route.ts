/**
 * GET /api/mining-unclaimed
 *
 * "Unclaimed SLVR by miner" — a per-miner breakdown of the Grid Mining
 * unclaimed-rewards pool. Miner addresses are enumerated from BetPlaced events on
 * GridLottery V2, then getMinerState(miner) is Multicall3-batched to read each
 * miner's current unclaimed SLVR (rewardsSlvr). The sum reconciles to
 * totalUnclaimed(); the residual (lazy-checkpoint gap) is reported explicitly.
 *
 * Cache: 5-minute in-process TTL.
 */
import { NextResponse } from "next/server";
import { getMiningUnclaimed } from "@/lib/miningUnclaimed";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const data = await getMiningUnclaimed();
    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "no-store",
        "X-Data-Sources": "robinhood-rpc,multicall3",
      },
    });
  } catch (err) {
    console.error("[/api/mining-unclaimed] error:", err);
    return NextResponse.json(
      { error: "Unclaimed-by-miner data temporarily unavailable" },
      { status: 502 }
    );
  }
}

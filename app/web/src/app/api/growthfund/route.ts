/**
 * GET /api/growthfund
 *
 * Growth Fund flywheel: SLVR earned from rounds → ETH earned by staking → SLVR
 * bought back on-market (and kept). Assembled from Blockscout (reliable per-address
 * history), the on-chain round counter, and the market price. Cached 5 min.
 */
import { NextResponse } from "next/server";
import { getGrowthFundData } from "@/lib/growthFund";

export async function GET() {
  try {
    const data = await getGrowthFundData();
    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "no-store",
        "X-Data-Sources": "blockscout,robinhood-rpc,dexscreener",
      },
    });
  } catch (err) {
    console.error("[/api/growthfund] error:", err);
    return NextResponse.json(
      { error: "Growth Fund data temporarily unavailable" },
      { status: 502 }
    );
  }
}

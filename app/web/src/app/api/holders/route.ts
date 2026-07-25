/**
 * GET /api/holders
 *
 * SLVR holder distribution from Blockscout: total holder count, top-N ranked
 * balances with protocol labels + contract flags, and top-10 concentration.
 * "% of supply" is against current totalSupply(). Cache: 5-minute TTL.
 *
 * ?economic=1 → ECONOMIC holders: the Grid Mining unclaimed pool and the Vote
 * Escrow time-locked pool are reattributed to the individual miners / stakers
 * who own them (permanent ve locks are burned → excluded). Same total, ranked by
 * true economic weight. Heavier (drives on-chain enumerations, cached ~5 min).
 */
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getHoldersData, getEconomicHoldersData } from "@/lib/holders";

export async function GET(req: NextRequest) {
  const economic = req.nextUrl.searchParams.get("economic") === "1";
  try {
    const data = economic
      ? await getEconomicHoldersData()
      : await getHoldersData();
    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "no-store",
        "X-Data-Sources": economic
          ? "blockscout,robinhood-rpc,multicall3"
          : "blockscout",
      },
    });
  } catch (err) {
    console.error("[/api/holders] error:", err);
    return NextResponse.json(
      { error: "Holder data temporarily unavailable" },
      { status: 502 }
    );
  }
}

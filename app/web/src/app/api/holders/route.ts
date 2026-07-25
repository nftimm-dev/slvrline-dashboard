/**
 * GET /api/holders
 *
 * SLVR holder distribution from Blockscout: total holder count, top-N ranked
 * balances with protocol labels + contract flags, and top-10 concentration.
 * "% of supply" is against current totalSupply(). Cache: 5-minute TTL.
 */
import { NextResponse } from "next/server";
import { getHoldersData } from "@/lib/holders";

export async function GET() {
  try {
    const data = await getHoldersData();
    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "no-store",
        "X-Data-Sources": "blockscout",
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

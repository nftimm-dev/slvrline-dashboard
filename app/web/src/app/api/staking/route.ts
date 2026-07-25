/**
 * GET /api/staking
 *
 * veSLVR + LP staking snapshot, reconstructed from on-chain state:
 * total/permanent/time-locked SLVR, active lock count, average lock, top
 * lockers (grouped by owner), and a lock-size distribution.
 *
 * Heavy: enumerates ~1,600 ve lock NFTs + reads each lock's state (~40s cold).
 * Cached 30 minutes in-process (lib/staking).
 */
import { NextResponse } from "next/server";
import { getStakingData } from "@/lib/staking";

// Allow the cold on-chain enumeration room to complete.
export const maxDuration = 120;
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const data = await getStakingData();
    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "no-store",
        "X-Data-Sources": "robinhood-rpc",
      },
    });
  } catch (err) {
    console.error("[/api/staking] error:", err);
    return NextResponse.json(
      { error: "Staking data temporarily unavailable" },
      { status: 502 }
    );
  }
}

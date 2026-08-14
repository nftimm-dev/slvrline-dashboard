/**
 * GET /api/growthfund/recent
 *
 * Live recent Growth-Fund buybacks (last ~20), fetched from the first Blockscout
 * page only (~2 calls) so the unified recent-buybacks table can show fresh flywheel
 * rows without dragging the heavy /api/growthfund payload live. Wrapped in a 30s
 * in-process cache to keep it cheap under refresh.
 */
import { NextResponse } from "next/server";
import { withCache } from "@/lib/cache";
import { getGrowthFundRecent, type GrowthFundRecent } from "@/lib/growthFund";
import { getMarketData } from "@/lib/dexscreener";

export const runtime = "nodejs";
export const maxDuration = 20;

interface RecentResponse {
  recent: GrowthFundRecent[];
  ethUsd: number | null;
}

async function fetchRecent(): Promise<RecentResponse> {
  const [recent, market] = await Promise.all([
    getGrowthFundRecent(),
    getMarketData().catch(() => null),
  ]);
  return { recent, ethUsd: market?.eth_usd ?? null };
}

export async function GET() {
  try {
    const data = await withCache("growthfund:recent", 30, fetchRecent);
    return NextResponse.json(data, {
      headers: { "Cache-Control": "no-store", "X-Data-Sources": "blockscout,dexscreener" },
    });
  } catch (err) {
    console.error("[/api/growthfund/recent] error:", err);
    // Degrade gracefully — the table just shows the burn rows.
    return NextResponse.json({ recent: [], ethUsd: null }, { status: 200 });
  }
}

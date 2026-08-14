/**
 * GET /api/growthfund
 *
 * Growth Fund flywheel: SLVR earned from rounds → ETH earned by staking → SLVR
 * bought back on-market (and kept). The FULL history (totals + cumulative series)
 * is slow to page from Blockscout (~30s), so it is precomputed into metrics.cache
 * by the cron and read back instantly here; the recent-buys feed is fetched live
 * from the first page (fast).
 */
import { NextResponse } from "next/server";
import { readDbCache } from "@/lib/dbCache";
import {
  getGrowthFundData,
  getGrowthFundRecent,
  getEthWaiting,
  type GrowthFundData,
} from "@/lib/growthFund";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  try {
    const cached = await readDbCache<GrowthFundData>("growthfund");
    // Full totals/series from cache (fast); the recent feed + the ETH war chest
    // are fetched live (both change faster than the 20-min cache).
    const [full, recent, waiting] = await Promise.all([
      cached ? Promise.resolve(cached.data) : getGrowthFundData(),
      getGrowthFundRecent().catch(() => null),
      getEthWaiting().catch(() => null),
    ]);

    const body: GrowthFundData = {
      ...full,
      recent: recent ?? full.recent ?? [],
      ...(waiting
        ? {
            ethWaiting: waiting.ethWaiting,
            ethWaitingUsd: full.ethUsd ? waiting.ethWaiting * full.ethUsd : null,
          }
        : {}),
      updatedAt: cached?.updatedAt ?? full.updatedAt,
    };

    return NextResponse.json(body, {
      headers: {
        "Cache-Control": "no-store",
        "X-Data-Sources": "blockscout,robinhood-rpc,dexscreener",
        "X-Cache": cached ? "hit" : "miss",
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

/**
 * GET /api/growthfund
 *
 * Growth Fund flywheel. The full totals/series/recent are precomputed into
 * metrics.cache by the cron (the ~30s Blockscout paging can't run per-request);
 * this route reads that back instantly and only refreshes the ETH war chest live
 * (a few cheap RPC calls). It NEVER runs the heavy compute inline — on a cold
 * cache it returns a fast partial (war chest only) and lets the cron fill the rest.
 */
import { NextResponse } from "next/server";
import { readDbCache } from "@/lib/dbCache";
import { getEthWaiting, type GrowthFundData } from "@/lib/growthFund";

export const runtime = "nodejs";
export const maxDuration = 30;

const EMPTY: GrowthFundData = {
  slvrBought: 0,
  buyCount: 0,
  ethDeployed: 0,
  usdDeployed: null,
  deployed24hEth: 0,
  deployed24hUsd: null,
  ethWaiting: 0,
  ethWaitingUsd: null,
  slvrEarned: 0,
  roundId: null,
  avgIntervalSec: null,
  buysPerDay: null,
  slvrUsd: null,
  ethUsd: null,
  holdingsUsd: null,
  series: [],
  recent: [],
  updatedAt: new Date(0).toISOString(),
};

export async function GET() {
  try {
    const [cached, waiting] = await Promise.all([
      readDbCache<GrowthFundData>("growthfund"),
      getEthWaiting().catch(() => null),
    ]);

    const base = cached?.data ?? EMPTY;
    const body: GrowthFundData = {
      ...base,
      ...(waiting
        ? {
            ethWaiting: waiting.ethWaiting,
            ethWaitingUsd: base.ethUsd ? waiting.ethWaiting * base.ethUsd : null,
          }
        : {}),
      updatedAt: cached?.updatedAt ?? base.updatedAt,
    };

    return NextResponse.json(body, {
      headers: {
        "Cache-Control": "no-store",
        "X-Data-Sources": "postgres-cache,robinhood-rpc",
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

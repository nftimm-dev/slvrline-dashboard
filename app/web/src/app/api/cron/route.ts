import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { computeAndWrite } from "@slvrline/metrics/run";
import { getMiningUnclaimed } from "@/lib/miningUnclaimed";
import { getEconomicHoldersData } from "@/lib/holders";
import { getGrowthFundData } from "@/lib/growthFund";
import { writeDbCache } from "@/lib/dbCache";

/**
 * Reliable refresh, driven by Vercel Cron (Pro fires within ~1 min of schedule —
 * GitHub's scheduled runs lag badly). Writes the same data the GitHub job does:
 *   ?job=snapshot  → computeAndWrite()  → metrics.metric_snapshots (the vitals)
 *   ?job=caches    → precompute heavy payloads → metrics.cache
 *   ?job=all (default) → both
 * See app/web/vercel.json for the schedules. Guarded by CRON_SECRET so the
 * endpoint isn't publicly runnable.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  // Vercel Cron attaches `Authorization: Bearer <CRON_SECRET>` when the env var
  // is set. Anything else is rejected.
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const job = req.nextUrl.searchParams.get("job") ?? "all";
  const t0 = Date.now();
  const result: Record<string, string | number> = { job };

  if (job === "snapshot" || job === "all") {
    try {
      await computeAndWrite();
      result.snapshot = "ok";
    } catch (e) {
      result.snapshot = `error: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  if (job === "caches" || job === "all") {
    // Order matters: holders_economic can take ~280s (near the 300s function
    // limit), so run the cheaper tasks FIRST to guarantee they populate.
    const tasks: Array<[string, () => Promise<unknown>]> = [
      ["mining_unclaimed", getMiningUnclaimed],
      ["growthfund", getGrowthFundData],
      ["holders_economic", getEconomicHoldersData],
    ];
    for (const [key, fn] of tasks) {
      try {
        await writeDbCache(key, await fn());
        result[key] = "ok";
      } catch (e) {
        result[key] = `error: ${e instanceof Error ? e.message : String(e)}`;
      }
    }
  }

  result.ms = Date.now() - t0;
  const failed = Object.values(result).some(
    (v) => typeof v === "string" && v.startsWith("error")
  );
  return NextResponse.json(result, { status: failed ? 500 : 200 });
}

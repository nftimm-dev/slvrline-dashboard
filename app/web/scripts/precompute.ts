/**
 * Precompute the heavy, serverless-unfriendly route payloads and store them in
 * metrics.cache. Run by the GitHub Actions cron (every ~15 min) alongside the
 * app/metrics snapshot job, and once manually before the first deploy.
 *
 *   DATABASE_URL=<supabase session pooler> npx tsx scripts/precompute.ts
 *
 * Each task is independent — one failing (e.g. a flaky RPC) must not block the
 * others, so failures are caught per-task and the process still exits 0 unless
 * every task failed.
 */
import { getMiningUnclaimed } from "@/lib/miningUnclaimed";
import { getEconomicHoldersData } from "@/lib/holders";
import { getGrowthFundData } from "@/lib/growthFund";
import { writeDbCache } from "@/lib/dbCache";
import { getDb } from "@/lib/db";

type Task = { key: string; run: () => Promise<unknown> };

const TASKS: Task[] = [
  { key: "mining_unclaimed", run: getMiningUnclaimed },
  { key: "growthfund", run: getGrowthFundData },
  { key: "holders_economic", run: getEconomicHoldersData },
];

async function main() {
  let ok = 0;
  for (const task of TASKS) {
    const t0 = Date.now();
    try {
      const data = await task.run();
      await writeDbCache(task.key, data);
      ok++;
      console.log(`[precompute] ${task.key} ✓ ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    } catch (err) {
      console.error(`[precompute] ${task.key} ✗`, err instanceof Error ? err.message : err);
    }
  }
  await getDb().end({ timeout: 5 });
  console.log(`[precompute] done: ${ok}/${TASKS.length} tasks succeeded`);
  if (ok === 0) process.exit(1);
}

main().catch((err) => {
  console.error("[precompute] fatal:", err);
  process.exit(1);
});

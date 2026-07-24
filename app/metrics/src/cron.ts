/**
 * cron.ts — Live metrics cron loop.
 *
 * Runs computeAndWrite() on a fixed interval (default: 60 seconds / VITALS_INTERVAL_MS).
 * Start with: ts-node src/cron.ts
 */

import { computeAndWrite } from "./run";
import { sql } from "./db";
import { VITALS_INTERVAL_MS } from "./constants";

async function main() {
  console.log(`[metrics-cron] Starting. Interval: ${VITALS_INTERVAL_MS}ms (${VITALS_INTERVAL_MS / 1000}s)`);

  while (true) {
    const t0 = Date.now();
    try {
      await computeAndWrite();
      console.log(`[metrics-cron] Snapshot written in ${Date.now() - t0}ms`);
    } catch (e) {
      console.error("[metrics-cron] Uncaught error:", e);
    }
    const elapsed = Date.now() - t0;
    const sleep = Math.max(0, VITALS_INTERVAL_MS - elapsed);
    await new Promise((r) => setTimeout(r, sleep));
  }
}

main().catch((e) => {
  console.error("[metrics-cron] Fatal:", e);
  sql.end();
  process.exit(1);
});

/**
 * backfill.ts — LEGACY: event-based backfill (requires Ponder indexer data in slvr schema).
 *
 * This file is superseded by archival-backfill.ts which uses archival eth_call directly.
 * Kept for reference only. Use archival-backfill.ts instead.
 *
 * Run: ts-node src/archival-backfill.ts
 */

console.warn("[backfill] This is the legacy event-based backfill. Use archival-backfill.ts instead.");
console.warn("[backfill] Run: ts-node src/archival-backfill.ts");
process.exit(0);

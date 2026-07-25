/**
 * DB-backed precompute cache (metrics.cache).
 *
 * Some routes are too heavy to run per-request on serverless (mining-unclaimed
 * ~33s, economic holders ~20s — both enumerate on-chain state over RPC). The
 * cron worker (app/web/scripts/precompute.ts) recomputes those payloads every
 * ~15 min and upserts them here; the API routes read them back instantly.
 *
 * Distinct from ./cache.ts, which is a per-process in-memory TTL map.
 */
import { getDb } from "./db";

export interface CachedPayload<T> {
  data: T;
  updatedAt: string;
}

export async function readDbCache<T>(key: string): Promise<CachedPayload<T> | null> {
  // Any failure here (table absent in local dev, transient DB error) must
  // degrade gracefully to null so the caller falls back to live computation.
  try {
    const sql = getDb();
    const rows = await sql<{ data: T; updated_at: Date }[]>`
      SELECT data, updated_at FROM metrics.cache WHERE key = ${key} LIMIT 1
    `;
    if (!rows.length) return null;
    return { data: rows[0].data, updatedAt: new Date(rows[0].updated_at).toISOString() };
  } catch (err) {
    console.warn(`[dbCache] read "${key}" failed, falling back to live:`, err instanceof Error ? err.message : err);
    return null;
  }
}

export async function writeDbCache(key: string, data: unknown): Promise<void> {
  const sql = getDb();
  await sql`
    INSERT INTO metrics.cache (key, data, updated_at)
    VALUES (${key}, ${sql.json(data as never)}, now())
    ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = now()
  `;
}

/**
 * Postgres client for metrics.metric_snapshots.
 * Uses postgres.js (same driver as app/metrics/).
 * DB: postgresql://timwilliams@localhost:5433/slvrline
 */
import postgres from "postgres";

const DB_URL =
  process.env.DATABASE_URL ||
  "postgresql://timwilliams@localhost:5433/slvrline";

// Single global connection pool — Next.js keeps module singletons across requests.
let _sql: ReturnType<typeof postgres> | null = null;

export function getDb(): ReturnType<typeof postgres> {
  if (!_sql) {
    _sql = postgres(DB_URL, {
      max: 5,
      idle_timeout: 30,
      connect_timeout: 10,
    });
  }
  return _sql;
}

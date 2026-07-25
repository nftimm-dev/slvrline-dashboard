/**
 * Postgres client for metrics.metric_snapshots.
 * Uses postgres.js (same driver as app/metrics/).
 * DB: postgresql://timwilliams@localhost:5433/slvrline
 */
import postgres from "postgres";

const DB_URL =
  process.env.DATABASE_URL ||
  "postgresql://timwilliams@localhost:5433/slvrline";

// Supabase connection handling:
//  - Any *.supabase.* host requires TLS (`ssl: 'require'`).
//  - The TRANSACTION pooler (port 6543, used by Vercel serverless) does not
//    support prepared statements, so `prepare` must be false there. The session
//    pooler (5432) and local Postgres are happy either way.
const isSupabase = DB_URL.includes("supabase.");
const isTxPooler = DB_URL.includes("pooler.supabase.com:6543");

// Single global connection pool — Next.js keeps module singletons across requests.
let _sql: ReturnType<typeof postgres> | null = null;

export function getDb(): ReturnType<typeof postgres> {
  if (!_sql) {
    _sql = postgres(DB_URL, {
      max: 5,
      idle_timeout: 30,
      connect_timeout: 10,
      ...(isSupabase ? { ssl: "require" as const } : {}),
      ...(isTxPooler ? { prepare: false } : {}),
    });
  }
  return _sql;
}

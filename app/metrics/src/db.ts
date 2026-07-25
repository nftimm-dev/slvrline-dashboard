import postgres from "postgres";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://timwilliams@localhost:5433/slvrline";

// Supabase pooling: *.supabase.* needs TLS; the transaction pooler (:6543, used
// when this runs inside the Vercel serverless cron) can't do prepared
// statements. Local Postgres and the session pooler (:5432) are happy either way.
const isSupabase = DATABASE_URL.includes("supabase.");
const isTxPooler = DATABASE_URL.includes("pooler.supabase.com:6543");

export const sql = postgres(DATABASE_URL, {
  max: 5,
  idle_timeout: 30,
  ...(isSupabase ? { ssl: "require" as const } : {}),
  ...(isTxPooler ? { prepare: false } : {}),
});

// Connection test (run with: ts-node src/db.ts). Guarded so importing this
// module (e.g. from the Vercel cron route) never trips over `require`.
if (typeof require !== "undefined" && require.main === module) {
  sql`SELECT current_database()`.then(([row]) => {
    console.log("DB connected:", (row as { current_database: string }).current_database);
    process.exit(0);
  }).catch((e) => { console.error(e); process.exit(1); });
}

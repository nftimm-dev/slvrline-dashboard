import postgres from "postgres";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://timwilliams@localhost:5433/slvrline";

export const sql = postgres(DATABASE_URL, {
  max: 5,
  idle_timeout: 30,
});

// Connection test (run with: ts-node src/db.ts)
if (require.main === module) {
  sql`SELECT current_database()`.then(([row]) => {
    console.log("DB connected:", (row as { current_database: string }).current_database);
    process.exit(0);
  }).catch((e) => { console.error(e); process.exit(1); });
}

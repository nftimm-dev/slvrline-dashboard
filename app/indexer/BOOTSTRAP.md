# Bootstrap Outcome

**Date:** 2026-07-24  
**Goal:** Prove Ponder 0.17 + local Postgres end-to-end on Robinhood Chain (id 4663).

---

## Result: SUCCESS

All three checks passed:
1. `pnpm ponder codegen` — OK
2. `npx tsc --noEmit` — OK (zero errors)
3. Live RPC sync + Postgres row writes — OK (1,008 rows in 90s)

---

## Environment

| Item | Value |
|---|---|
| DATABASE_URL | `postgresql://timwilliams@localhost:5433/slvrline` |
| Postgres | 18.x (Homebrew `postgresql@18`), port 5433 |
| Postgres data dir | `<repo-root>/.pgdata/` |
| Ponder | 0.17.1 |
| Chain | Robinhood Chain, id 4663 |
| RPC | `https://rpc.mainnet.chain.robinhood.com` |
| Node | v24.11.0 |
| pnpm | 10.30.0 |

---

## SLVR Token startBlock

**startBlock = 18,380,228**

Calculated as: chain head at bootstrap time (`0x1193914` = 18,430,228 in decimal,
recorded as ~18,382,100 in the ponder.config.ts comment) minus 50,000.

**PLACEHOLDER**: This is a proof-of-life start block only. Phase 1 work MUST replace this
with the real SLVR token deployment block (query Blockscout explorer for the
contract creation block of `0x791229E3EbD6CFdC3D8157f48722684173C29aD9`).

---

## Commands Used

```bash
# Start Postgres
/opt/homebrew/opt/postgresql@18/bin/pg_ctl \
  -D /path/to/repo/.pgdata -o "-p 5433" \
  -l /path/to/repo/.pgdata/logfile -w start

# Create database
/opt/homebrew/opt/postgresql@18/bin/createdb -p 5433 slvrline

# Install deps
cd app/indexer && pnpm install

# Codegen (generates ponder-env.d.ts)
pnpm ponder codegen

# Typecheck
npx tsc --noEmit

# Run indexer (dev mode, 90-second proof run)
pnpm ponder dev

# Verify rows
psql -p 5433 slvrline -c "SELECT COUNT(*) FROM transfer_event;"
psql -p 5433 slvrline -c "\dt *.*"
```

---

## Ponder Sync Log (key lines)

```
23:31:45.760 INFO  Connected to database type=postgres database=localhost:5433/slvrline (5ms)
23:31:46.102 INFO  Connected to JSON-RPC chain=robinhoodChain hostnames=["rpc.mainnet.chain.robinhood.com"] (340ms)
23:31:46.462 INFO  Created database tables count=1 tables=["transfer_event"] (5ms)
23:31:46.485 INFO  Created HTTP server port=42069 (4ms)
23:31:46.745 INFO  Started backfill indexing chain=robinhoodChain block_range=[18380228,18438211]
23:31:51.744 INFO  Updated backfill indexing progress progress=16.6%
23:31:56.745 INFO  Updated backfill indexing progress progress=41.0%
23:32:01.746 INFO  Updated backfill indexing progress progress=65.1% estimate=8s
[... continued to chain head, block 18,439,122 ...]
23:33:14.547 WARN  Received SIGTERM
```

---

## Postgres Evidence

```sql
SELECT COUNT(*) FROM transfer_event;
-- count: 1008

SELECT id, "from", "to", value::text, block_number
FROM transfer_event ORDER BY block_number DESC LIMIT 5;
-- Shows 5 real on-chain SLVR Transfer events
-- Example: mint to growth fund (0x1a1633...) at block 18,439,017
-- All values are bigint (no floats)
```

Ponder created these schemas in the `slvrline` database:
- `public.transfer_event` — indexed events (1,008 rows)
- `public._ponder_checkpoint` — sync checkpoint
- `public._reorg__transfer_event` — reorg shadow table
- `ponder_sync.*` — sync internals (blocks, logs, intervals, etc.)

---

## Issues Encountered

1. **libpq-only install**: `initdb` from `libpq` formula needed `postgres` binary. 
   Fixed: installed `postgresql@18` formula.

2. **tsconfig paths conflict**: Setting `"ponder:registry": ["./ponder-env.d.ts"]`
   in tsconfig paths caused `vite-tsconfig-paths` to redirect the virtual module
   import to the `.d.ts` file at runtime, returning `undefined` for `ponder`.
   Fixed: removed the paths block entirely. Type resolution for `ponder:registry`
   works via the `/// <reference types="ponder/virtual" />` in `ponder-env.d.ts`.

3. **Ponder 0.17 requires `src/api/index.ts`**: Must export a Hono instance.
   Fixed: created minimal stub with `new Hono()` default export. Added `hono`
   as an explicit dependency (it's a transitive dep of ponder but not hoisted).

4. **`schema` key not in Ponder 0.17 database config**: The `schema` property
   does not exist on the Postgres database config type. Removed; Ponder uses
   `public` schema by default.

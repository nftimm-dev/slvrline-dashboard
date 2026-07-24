# Architecture Research

**Domain:** Self-hosted EVM analytics platform (indexer + derived metrics + API + frontend)
**Researched:** 2026-07-24
**Confidence:** HIGH (component model, Ponder specifics, Robinhood Chain) / MEDIUM (derived metrics snapshot strategy, Uniswap V4 pool indexing)

---

## Standard Architecture

### System Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│  CHAIN LAYER                                                         │
│  Robinhood Chain (EVM, id 4663) — 100ms blocks, Arbitrum Nitro L2   │
│  RPC: https://rpc.mainnet.chain.robinhood.com                        │
└───────────────────────────────┬──────────────────────────────────────┘
                                │ eth_getLogs / eth_getBlockByNumber
                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│  INDEXER LAYER (Ponder — TypeScript, Node.js)                        │
│                                                                      │
│  ┌────────────────┐  ┌────────────────┐  ┌──────────────────────┐   │
│  │  Backfill sync │  │  Realtime sync │  │  Contract registry   │   │
│  │  (parallelized │  │  (head-follow, │  │  (per-contract ABI,  │   │
│  │  block ranges) │  │  reorg detect) │  │  startBlock/endBlock)│   │
│  └───────┬────────┘  └───────┬────────┘  └──────────────────────┘   │
│          └─────────┬─────────┘                                       │
│                    ▼                                                  │
│  ┌─────────────────────────────────────────────────────────────┐     │
│  │  Indexing functions (TypeScript event handlers)             │     │
│  │  – Decode event log (topic0 → ABI → typed args)            │     │
│  │  – Apply domain logic (scale decimals, label addresses)     │     │
│  │  – Upsert into PostgreSQL via context.db (Drizzle ORM)     │     │
│  └─────────────────────────────────────────────────────────────┘     │
└───────────────────────────────┬──────────────────────────────────────┘
                                │ SQL writes (atomic per-block tx)
                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│  DATA LAYER (PostgreSQL + optional TimescaleDB extension)            │
│                                                                      │
│  ┌─────────────────────────┐  ┌──────────────────────────────────┐   │
│  │  Raw event tables       │  │  Derived metrics tables          │   │
│  │  (append-only, keyed    │  │  (computed snapshots, written by │   │
│  │   chain_id + address    │  │   scheduled cron job or Ponder   │   │
│  │   + tx_hash + log_idx)  │  │   block-interval handler)        │   │
│  └─────────────────────────┘  └──────────────────────────────────┘   │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │  Checkpoint / sync-state table                               │    │
│  │  (last processed block per contract; drives resume/reorg)    │    │
│  └──────────────────────────────────────────────────────────────┘    │
└───────────────────────────────┬──────────────────────────────────────┘
                                │ SQL reads / Ponder GraphQL / SQL-over-HTTP
                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│  API LAYER (Next.js Route Handlers or standalone Node service)       │
│                                                                      │
│  ┌──────────────────┐  ┌─────────────────────┐  ┌───────────────┐   │
│  │  /api/vitals     │  │  /api/charts/[metric]│  │  /api/status  │   │
│  │  (current-state  │  │  (time-series rows,  │  │  (indexer     │   │
│  │   snapshot,      │  │   paginated, cached) │  │   lag, health)│   │
│  │   short TTL)     │  └─────────────────────┘  └───────────────┘   │
│  └──────────────────┘                                                │
│  Caching: in-memory (node-cache) for vitals (~10s TTL),             │
│            HTTP Cache-Control for chart data (longer TTL)           │
└───────────────────────────────┬──────────────────────────────────────┘
                                │ JSON over HTTP / REST
                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│  FRONTEND LAYER (Next.js app, React)                                 │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐     │
│  │  Vitals strip (SWR polling, ~10s interval)                  │     │
│  │  Dividends APR · SLVR staked · supply/runway · price        │     │
│  └─────────────────────────────────────────────────────────────┘     │
│  ┌─────────────────────────────────────────────────────────────┐     │
│  │  Historical charts (Recharts/ECharts, data fetched on load) │     │
│  │  Supply, emissions, burns, staking, price, round activity   │     │
│  └─────────────────────────────────────────────────────────────┘     │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Component Responsibilities

| Component | Responsibility | Communicates With |
|-----------|---------------|-------------------|
| Ponder indexer | Fetches logs from RPC, decodes events, upserts rows, handles reorgs, manages backfill | Chain RPC (inbound), PostgreSQL (outbound) |
| PostgreSQL (raw event tables) | Append-only canonical record of every indexed event; primary key prevents double-counting | Ponder indexer (writes), metrics job + API (reads) |
| Metrics snapshot job | Reads raw tables, computes derived values (APR, circulating supply, runway), writes timestamped rows into metrics tables | PostgreSQL raw tables (reads), PostgreSQL metrics tables (writes) |
| PostgreSQL (metrics tables) | Time-series of computed metrics; what charts query; decoupled from raw event churn | Metrics job (writes), API layer (reads) |
| API layer | Aggregates and serves data to the frontend; adds caching; hides DB internals | PostgreSQL (reads), Frontend (inbound requests) |
| Frontend | Displays vitals strip (live polling) and historical charts (load-time fetch) | API layer (reads) |
| Goldsky subgraph | Reference/cross-check source only; used for bootstrap validation | Not part of production path |

---

## Recommended Project Structure

```
slvrline-dashboard/
├── indexer/                   # Ponder project (standalone Node.js process)
│   ├── ponder.config.ts       # Chain, contracts, startBlock/endBlock per contract
│   ├── ponder.schema.ts       # onchainTable definitions (raw event tables)
│   ├── src/
│   │   ├── handlers/          # One file per contract (SlvrToken.ts, GridLottery.ts, etc.)
│   │   └── utils/             # Shared helpers (decimal scaling, address labels)
│   └── abis/                  # ABI JSON files for every indexed contract
│
├── metrics/                   # Derived metrics computation (Node.js cron process)
│   ├── jobs/
│   │   ├── computeVitals.ts   # APR, staked totals, supply, runway — written every ~1 min
│   │   └── computeHistory.ts  # Hourly/daily snapshots for chart tables
│   └── lib/
│       ├── db.ts              # Shared PostgreSQL connection
│       └── formulas.ts        # APR formula, circulating supply calc, runway math
│
├── api/                       # Next.js app (or standalone Express) serving JSON
│   ├── app/
│   │   └── api/
│   │       ├── vitals/route.ts        # GET /api/vitals — current headline numbers
│   │       ├── charts/[metric]/route.ts # GET /api/charts/apr?from=&to=
│   │       └── status/route.ts        # GET /api/status — indexer lag
│   └── lib/
│       └── cache.ts           # Short-TTL in-memory cache for vitals
│
├── web/                       # Next.js frontend (can be same app as api/)
│   ├── app/
│   │   ├── page.tsx           # Main dashboard (vitals strip + charts)
│   │   └── components/
│   │       ├── VitalsStrip.tsx        # SWR polling component
│   │       ├── SupplyChart.tsx
│   │       ├── StakingChart.tsx
│   │       ├── PriceChart.tsx
│   │       └── RoundsChart.tsx
│   └── hooks/
│       └── useVitals.ts       # SWR hook, 10s revalidation
│
└── db/
    └── migrations/            # SQL migration files (schema evolution)
```

### Structure Rationale

- **indexer/** is a fully separate Ponder process — it has its own process lifecycle and must be able to restart and resume independently from the API.
- **metrics/** is kept separate from the indexer so derived computation does not block event ingestion; it reads raw tables and writes its own output tables.
- **api/** and **web/** can coexist in a single Next.js app for a v1 monorepo; split into separate services only if API traffic outpaces UI serving.
- **db/migrations/** is separate from both the indexer schema (managed by Ponder) and the metrics tables (managed by raw SQL migrations) to keep schema ownership clear.

---

## Data Flow (Explicit)

### Ingestion Flow (backfill + live)

```
Robinhood Chain RPC
    │  eth_getLogs (block range, filter by contract address + topic0)
    ▼
Ponder sync engine
    │  Parallel batches during backfill; polling/subscription at head
    ▼
Indexing function (TypeScript handler)
    │  Decode log args → compute domain values → context.db.insert/upsert
    ▼
PostgreSQL (raw event tables)
    │  Atomic per-block transaction; ON CONFLICT DO NOTHING for idempotency
    ▼
Checkpoint updated (inside same transaction)
```

### Derived Metrics Flow

```
PostgreSQL (raw event tables)
    │  Scheduled cron read (every 60s for vitals; every 1h for chart snapshots)
    ▼
Metrics computation job (Node.js)
    │  - Joins lottery_bets + lottery_wins + token_transfers
    │  - Computes APR formula (see Dividends APR note below)
    │  - Computes circulating supply (total supply minus team/growth/locked wallets)
    │  - Computes runway (remaining cap / current emission rate)
    │  - Writes timestamped row to metric_snapshots table
    ▼
PostgreSQL (metric_snapshots table)
    │  Indexed on (metric_name, snapshot_at) for fast range queries
    ▼
API layer reads latest snapshot for vitals; reads time-range for charts
```

### Frontend Request Flow

```
Browser (user visits dashboard)
    │  Next.js SSR renders shell with most recent vitals (server-side DB read)
    ▼
Page loads → SWR hook fires
    │  GET /api/vitals (10s polling interval)
    ▼
API route → reads metric_snapshots (latest, cached 10s in memory)
    │  Returns JSON: { apr, staked, circulatingSupply, runway, price }
    ▼
VitalsStrip component updates
```

```
Browser (chart section enters viewport)
    │  GET /api/charts/apr?from=UNIX&to=UNIX&interval=1h
    ▼
API route → reads metric_snapshots (range query, HTTP cache 5m)
    │  Returns time-series JSON array
    ▼
Recharts/ECharts renders line chart
```

### Reorg Flow (Robinhood Chain specifics)

```
Ponder realtime sync detects block number did not increase OR parent hash mismatch
    │  Emits reorg event with list of reorgedBlocks
    ▼
Ponder rolls back indexed rows for affected blocks (Drizzle transaction)
    │  Checkpoint rewound to fork point
    ▼
Re-ingests from fork point forward
    ▼
Metrics snapshot job reads only committed, current state — no action needed
```

Note: Robinhood Chain is Arbitrum Nitro L2 with 100ms blocks. Soft confirmations are sub-second. Full L1 (Ethereum) settlement takes ~13 minutes. For the analytics use case, indexing unfinalized L2 blocks is fine — reorg depth on an Arbitrum L2 sequencer is very shallow (typically 0–1 blocks). Ponder's built-in reorg detection is sufficient; there is no need to wait for L1 finality.

---

## Critical Pattern: Round-12,500 Migration Split

The Grid Lottery migrated contracts at round 12,500 (cutover 2026-07-23 01:09:24 UTC). Both old and new contracts must be indexed, with events attributed to the correct contract and rounds never double-counted.

**Implementation in Ponder config:**

```typescript
// ponder.config.ts
import { createConfig } from "ponder";
import { GridLotteryAbi } from "./abis/GridLottery";

export default createConfig({
  chains: {
    robinhoodChain: {
      id: 4663,
      rpc: process.env.PONDER_RPC_URL,
    },
  },
  contracts: {
    // Old lottery: index from deployment up to (and including) the last block
    // that contains round 12,499's finalization. Set endBlock to the block
    // containing the last old-contract event before cutover.
    GridLotteryV1: {
      abi: GridLotteryAbi,
      chain: "robinhoodChain",
      address: "0x284Eb4016305Fa7FbC162Fb68F27227271001c7f",
      startBlock: GENESIS_BLOCK,
      endBlock: MIGRATION_BLOCK,  // block of 2026-07-23 01:09:24 UTC
    },
    // New lottery: index from migration block onward
    GridLotteryV2: {
      abi: GridLotteryAbi,
      chain: "robinhoodChain",
      address: "0xB0Cc994Ce4E8fb106da9Eb36e26fDd8C5f1e0c71",
      startBlock: MIGRATION_BLOCK,
    },
  },
});
```

**Database keying pattern:**

Every raw event table row carries `(chain_id, contract_address, tx_hash, log_index)` as its composite primary key. This ensures:
- The same log cannot be inserted twice (idempotency, `ON CONFLICT DO NOTHING`)
- Queries can filter by contract address to get pre- or post-migration events
- Round numbers are sourced from event data, not inferred from contract address
- A `source_contract` column on the `lottery_rounds` table records which contract produced each round for auditability

**Circulating supply keying:**

Exclude these wallets from circulating supply by address label:
- Team vesting: `0xFAfcBd4D09C096Eb06Aa2256C7A65CEAB2db39F5`
- Growth fund: `0x1A1633FDB2f19082099A6AD6C3d4F1Ec6BCE9729`
- Protocol deployer: `0x11111972FE1b7e52D36609bCaF8702c65b025B46`
- Growth recipient: `0x4444479B89b684e79392924B3A70BE03733190dE`
- Any veSLVR permanent-lock NFT holders (locked = not circulating)

---

## Critical Pattern: Derived Metrics Snapshot Strategy

Metrics like Dividends APR and mining runway are time-varying computed values — they cannot be reconstructed from a single event log row and are expensive to compute on every API request.

**Recommended approach: scheduled snapshot job writing to a dedicated metrics table.**

Do NOT use PostgreSQL materialized views for this. Materialized views in standard PostgreSQL block reads during refresh, cannot accept external inputs (like price feeds), and cannot encode the custom multi-step formulas required for APR or runway. Use a cron job instead.

**Schema:**

```sql
CREATE TABLE metric_snapshots (
  id           BIGSERIAL PRIMARY KEY,
  metric_name  TEXT NOT NULL,         -- 'dividends_apr', 'circulating_supply', 'runway_days', etc.
  value        NUMERIC NOT NULL,
  metadata     JSONB,                 -- supporting data (e.g., inputs used in formula)
  snapshot_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  block_number BIGINT                 -- chain block at time of computation
);

CREATE INDEX idx_metric_snapshots_name_time
  ON metric_snapshots (metric_name, snapshot_at DESC);
```

**Cadence:**
- Vitals queries (APR, staked, price, supply): snapshot every 60 seconds
- Chart data (historical time-series): snapshot every 1 hour for most metrics, every 10 minutes for price/volume

**API query pattern for charts:**

```sql
SELECT snapshot_at, value
FROM metric_snapshots
WHERE metric_name = 'dividends_apr'
  AND snapshot_at BETWEEN $from AND $to
ORDER BY snapshot_at ASC;
```

**Dividends APR note (LOW confidence — formula must be verified from contract source):**
Based on PROJECT.md description: "yield earned by miners who have not yet claimed their mining rewards, funded by other miners." The formula is likely: `APR = (annual_dividends_distributed / unclaimed_mining_rewards_pool) * 100`. The exact inputs (which events represent dividends funded, what constitutes the unclaimed pool) must be reverse-engineered from the Grid Lottery ABI + Goldsky subgraph during implementation. This is the trickiest metric and should be verified against the Goldsky subgraph numbers as a cross-check during development.

---

## Architectural Patterns

### Pattern 1: Atomic Per-Block Transaction

**What:** Wrap all database writes for a single block inside one PostgreSQL transaction. Advance the checkpoint inside the same transaction.
**When to use:** Always. Non-negotiable for correctness.
**Trade-offs:** Slightly more memory per block (holds rows until commit); eliminates all partial-state bugs.

```typescript
// Ponder handles this automatically — each indexing function call
// operates within an implicit per-event transaction. The checkpoint
// advances only after all handlers for a block complete.
ponder.on("GridLotteryV2:RoundComplete", async ({ event, context }) => {
  await context.db
    .insert(lotteryRound)
    .values({
      id: `${event.log.address}-${event.args.roundId}`,
      contractAddress: event.log.address,
      chainId: 4663,
      roundId: event.args.roundId,
      winner: event.args.winner,
      prize: event.args.prize,
      blockNumber: event.block.number,
      blockTimestamp: event.block.timestamp,
    })
    .onConflictDoNothing();  // idempotency — safe to replay
});
```

### Pattern 2: Dual-Name Same-ABI Contract Registration

**What:** Register the old and new lottery contracts as `GridLotteryV1` and `GridLotteryV2` with non-overlapping block ranges.
**When to use:** Any time a contract migrates to a new address with the same ABI and semantic continuity is required.
**Trade-offs:** Two sets of indexing functions to register (or one shared handler per event name, invoked for both); requires verifying the exact migration block number.

### Pattern 3: Separate Metrics Process

**What:** Derived metrics are computed by a separate process (cron job) that reads raw event tables and writes to a metrics snapshot table. This process is entirely stateless — it can be restarted at any time without data loss.
**When to use:** Any metric that requires multi-table joins, external price feeds, or formula logic that cannot be expressed purely in SQL.
**Trade-offs:** 60-second metric lag is acceptable for analytics; avoids making the indexer responsible for business logic.

### Pattern 4: API Caching Layer (In-Memory, Short TTL)

**What:** The API layer holds the most recent vitals response in memory for 10 seconds. Chart data responses set `Cache-Control: public, max-age=300`.
**When to use:** Vitals strip polls every 10 seconds from potentially many concurrent users; without caching, each poll would hit PostgreSQL.
**Trade-offs:** Up to 10-second metric staleness on vitals; acceptable for analytics context.

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Computing APR or Supply in the API Request Path

**What people do:** Run multi-table SQL aggregations inside the API route handler on every request.
**Why it's wrong:** APR requires joining multiple tables (lottery events, transfers, staking events) and is expensive. At 10-second polling cadence it will thrash the DB.
**Do this instead:** Pre-compute in the metrics snapshot job; API reads a single pre-computed row.

### Anti-Pattern 2: Single Contract Registration for Both Pre- and Post-Migration Lottery

**What people do:** Try to index both lottery contracts by passing an array of two addresses to one contract config.
**Why it's wrong:** Ponder would index both from `startBlock: 0` — the old contract would be scanned for events beyond its deactivation, generating noise. More critically, the indexing function has no block-range awareness and cannot know which address belongs to which round epoch.
**Do this instead:** Use two named contract entries with explicit, non-overlapping `startBlock`/`endBlock`. Store `contract_address` on every row; filter in queries.

### Anti-Pattern 3: Using PostgreSQL Materialized Views for APR Snapshots

**What people do:** Define a `CREATE MATERIALIZED VIEW apr_mv AS SELECT ...` and refresh on a cron.
**Why it's wrong:** `REFRESH MATERIALIZED VIEW` takes an `ExclusiveLock` in standard PostgreSQL (blocks reads until complete). For complex multi-table aggregations this can be minutes. `REFRESH MATERIALIZED VIEW CONCURRENTLY` avoids read blocking but requires a unique index and doubles storage.
**Do this instead:** A Node.js cron job that computes metrics and INSERTs rows into a plain append-only metrics table. Queries read the latest row; old rows become historical data for free.

### Anti-Pattern 4: Indexing Only the New Lottery Contract

**What people do:** Set `startBlock` to the migration block and only configure the new contract.
**Why it's wrong:** All round history before round 12,500 lives on the old contract. The historical charts for rounds, emissions, and wins would be missing months of data.
**Do this instead:** Index both contracts in full (V1 from genesis to migration, V2 from migration onward).

### Anti-Pattern 5: Keying Rows by Round Number Alone

**What people do:** Use `roundId` as the primary key for lottery rounds.
**Why it's wrong:** Round IDs may overlap or reset between old and new contracts, causing V2 round 1 to overwrite V1 round 1.
**Do this instead:** Composite key of `(chain_id, contract_address, round_id)` or a synthetic `id` of `"${address}-${roundId}"`.

### Anti-Pattern 6: Ignoring Uniswap V4 Pool ID Semantics

**What people do:** Treat V4 pool IDs like V2 pair addresses.
**Why it's wrong:** Uniswap V4 pools are identified by a `bytes32` hash derived from a `PoolKey` struct, not a deployed contract address. All pools share the single `PoolManager` contract. You must filter by pool ID in `event.args` (emitted as `id` on Swap, ModifyLiquidity, Initialize events), not by log contract address.
**Do this instead:** Index `PoolManager` contract events; filter by the known pool IDs (`0xb7d8f0dc9cd5f756a792e3fb8e5422d40a0ac1ededd735479f3689e883d023b3` for SLVR/ETH, `0xd3d9204b35522f142d7283eaffac9dddd2319fe27d5d808a6f201acfa7776f6a` for SLVR/USDG) inside the indexing function.

---

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| Robinhood Chain RPC (`https://rpc.mainnet.chain.robinhood.com`) | Ponder's chain config; `eth_getLogs` for backfill, `eth_subscribe` (or polling) for head | Single endpoint; Ponder supports `fallback` transport for redundancy |
| Goldsky subgraph (`api.goldsky.com/...`) | Cross-check only during development — GraphQL queries to validate our indexed counts match | Not in production critical path; used as a sanity check during phase 1-2 |
| Dexscreener API | REST fetch from the metrics job for price data; fallback or supplement to on-chain V2/V4 pool computation | Public API, no auth; rate-limit aware |
| slvr.fun API proxies (`/api/round-state`, `/api/price/eth`) | Reference only; used to cross-check values during development | Protocol-controlled; do not use as production data source |
| Blockscout explorer API (`https://robinhoodchain.blockscout.com/api/v2/`) | Optional: historical ABI lookup, address labels | Supplementary only |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| Indexer → PostgreSQL | Direct SQL (Drizzle ORM, context.db) | Indexer owns the raw event schema; migrations managed by Ponder |
| Metrics job → PostgreSQL | Direct SQL (pg/postgres.js) | Reads indexer's raw tables; writes its own `metric_snapshots` table |
| API → PostgreSQL | Direct SQL (postgres.js or Prisma) | Read-only access to both raw event tables and metric_snapshots |
| Frontend → API | HTTP REST + JSON | SWR for vitals (polling); standard fetch for charts |
| Metrics job → Dexscreener | HTTP REST | Price data supplement; cached in metrics table, not fetched per API request |

---

## Suggested Build Order (Dependency-Driven)

Phase order is driven by dependencies: you cannot compute metrics without indexed data; you cannot display charts without an API; the frontend is last.

### Phase 1: Indexer Foundation

Must exist before anything else. Index the two core contracts first to prove the pattern works on Robinhood Chain.

- Configure Ponder with Robinhood Chain (id 4663)
- Index SLVR token (transfers, supply events, burns)
- Index GridLotteryV1 (rounds 1–12,499) and GridLotteryV2 (rounds 12,500+) with non-overlapping block ranges
- Validate round counts and event counts against Goldsky subgraph

### Phase 2: Full Contract Coverage

Expand indexing once the migration split is proven correct.

- Index veSLVR vote-escrow (locks, permanent locks)
- Index veSLVR staking contract (staking events, revenue distributions)
- Index LP staking (deposits, withdrawals)
- Index SLVR Hub (revenue routing events)
- Index Uniswap V2 pair (swaps, sync events for price/liquidity)
- Index Uniswap V4 PoolManager (filter by SLVR pool IDs for Swap and ModifyLiquidity)

### Phase 3: Derived Metrics Layer

Depends on Phase 2 (needs all tables populated).

- Build circulating supply computation (total supply minus excluded wallets)
- Build staked/permanent-lock totals (aggregate from veSLVR events)
- Build emissions and burns time-series (from token transfer events)
- Build mining runway (remaining cap / rolling emission rate)
- Build Dividends APR (cross-check formula against Goldsky subgraph)
- Implement cron snapshot writer, metric_snapshots table

### Phase 4: API Layer

Depends on Phase 3 (needs snapshot table populated).

- `/api/vitals` — returns latest snapshot for headline metrics
- `/api/charts/[metric]` — returns time-range rows from metric_snapshots
- `/api/status` — returns indexer lag (latest indexed block vs chain head)
- Add in-memory caching for vitals

### Phase 5: Frontend

Depends on Phase 4 (needs API endpoints stable).

- Vitals strip with SWR polling
- Historical charts for supply, staking, price, rounds
- Brand identity ("silver" aesthetic)
- Responsive layout, SSR shell with server-fetched initial vitals

---

## Scaling Considerations

| Concern | At 100 users | At 10K users | At 1M users |
|---------|--------------|--------------|-------------|
| API read load | Single Postgres instance, in-memory cache for vitals | Postgres read replica; Redis for vitals cache | CDN-cached chart JSON at edge; API stateless behind LB |
| Indexer throughput | Single Ponder process, one RPC endpoint | Same; Robinhood Chain is L2, high throughput RPC is not the bottleneck | Archive node or SQD Portal for history; live sync only for head |
| Metrics job | Single cron process, 60s cadence | Same; computation is cheap (aggregate queries on indexed tables) | Partition metric_snapshots by month; no scaling concern at this query volume |
| Database size | Event logs are compact; full history ~weeks/months of blocks | TimescaleDB extension for automatic chunk compression on old metric rows | Partition raw event tables by month; archive pre-migration lottery events to cold storage |

### Scaling Priorities

1. **First bottleneck (v1):** Vitals API being hit ~6×/minute/user × N concurrent users. Fix: 10s in-memory cache in the API process. Zero DB reads for cached responses.
2. **Second bottleneck (v2):** Chart data queries becoming slow as metric_snapshots grows. Fix: add index on `(metric_name, snapshot_at)`; add `LIMIT` + cursor pagination; cache chart responses with longer TTL.

---

## Sources

- Ponder official docs (contracts/networks, indexing functions, schema): Context7 /ponder-sh/ponder, HIGH confidence
- Ponder reorg detection implementation: Context7 /ponder-sh/ponder (source code reference), HIGH confidence
- Ponder contract migration pattern (named contracts with non-overlapping block ranges): https://ponder.sh/docs/contracts-and-networks, HIGH confidence
- Crash-safe idempotent EVM indexer patterns (atomic transactions, ON CONFLICT DO NOTHING, checkpoint-in-transaction): https://dev.to/nihalpandey2302/designing-a-crash-safe-idempotent-evm-indexer-in-rust-3ca8, MEDIUM confidence
- EVM event log architecture (Extract-Decode-Transform-Store, reorg strategy, proxy handling): https://sqd.dev/learn/what-is-an-evm-indexer/, HIGH confidence
- Robinhood Chain chain ID, block time (100ms), Arbitrum Nitro L2 architecture: https://docs.robinhood.com/chain/ via WebSearch, MEDIUM confidence
- Uniswap V4 pool ID as bytes32 PoolKey hash, events on PoolManager: https://developers.uniswap.org/docs/ecosystem/subgraphs/concepts/v4/entities + WebSearch, MEDIUM confidence
- PostgreSQL metrics snapshot table vs materialized view trade-offs: industry pattern (multiple sources agree), MEDIUM confidence
- TimescaleDB for time-series metrics compression and continuous aggregates: WebSearch (multiple credible sources), MEDIUM confidence
- Dividends APR formula: LOW confidence — derived from PROJECT.md description only; must be verified from contract ABI + Goldsky subgraph during implementation

---

*Architecture research for: SLVRline — self-hosted EVM analytics platform*
*Researched: 2026-07-24*

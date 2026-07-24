# Project Research Summary

**Project:** SLVRline — SLVR protocol analytics platform
**Domain:** Self-hosted EVM analytics platform (indexer + derived metrics + API + frontend)
**Researched:** 2026-07-24
**Confidence:** HIGH (stack, architecture, pitfall taxonomy) / MEDIUM (SLVR-specific feature patterns) / LOW (Dividends APR formula)

## Executive Summary

SLVRline is a read-only protocol analytics platform for SLVR on Robinhood Chain (EVM chain ID 4663). All four research streams independently converged on the same architectural spine: Ponder as the indexer (connecting to Robinhood Chain via plain `id + rpc` config), PostgreSQL as the datastore, a scheduled cron job computing derived metrics into an append-only `metric_snapshots` table, a Next.js API layer reading those snapshots, and a Next.js frontend displaying a vitals strip with historical charts. The independence of this stack from the existing Goldsky subgraph is the core product value — SLVRline must compute from raw chain data, not trust the protocol's own infra.

The single highest-risk item in the project is the Dividends APR formula. This is simultaneously the dashboard's most important headline metric and the only metric where the computation cannot be deduced from ecosystem documentation — it requires reverse-engineering the Grid Lottery + SLVR Hub contract ABIs and cross-validating against the Goldsky subgraph before a single line of calculation code is written. Every other metric (supply, staking, price, round activity) follows well-documented EVM analytics patterns. APR does not. It is a hard research gate on the metrics phase.

The second structural constraint is the round-12,500 lottery contract migration (cutover 2026-07-23). The old Grid Lottery (`0x284Eb4...`) and the new one (`0xB0Cc99...`) must be indexed with non-overlapping `startBlock`/`endBlock` in Ponder config, and every event row must carry `(chain_id, contract_address)` in its primary key so rounds can never be double-counted or silently dropped. Getting this wrong at the schema design stage requires a full re-index to fix. The recommended build order — indexer foundation → full contract coverage → derived-metrics layer → API → frontend — enforces that the migration split is validated against the Goldsky subgraph before any downstream metrics are computed.

## Key Findings

### Recommended Stack

Ponder 0.17.1 is the clear indexer choice. Robinhood Chain is not in any indexer's pre-integrated chain list, but Ponder's RPC-based path is its only path — there is no "degraded mode" for unknown chains. The chain config is a single `{ id: 4663, rpc: "https://rpc.mainnet.chain.robinhood.com" }` pair. Ponder provides built-in reorg detection via shadow tables, parallel backfill batching, and auto-generated GraphQL + SQL-over-HTTP APIs that write directly to user-supplied Postgres. It runs as a long-running Node.js process, which means it must be deployed on Railway or Fly.io — not Vercel or any serverless platform.

The frontend stack is Next.js 15 (App Router) + Tailwind CSS v4 + shadcn/ui for dashboard primitives + TradingView lightweight-charts for OHLC/price charts + Apache ECharts for multi-series analytics charts. viem 2.35+ handles all on-chain reads (`defineChain` for the custom chain, multicall3 batching for bulk state reads, StateView contract reads for Uniswap V4 pools). Recharts and Nivo are explicitly excluded — both SVG-based and slow above 5,000 data points; neither supports OHLC.

**Core technologies:**
- **Ponder 0.17.1**: EVM indexer — only self-hosted TypeScript indexer that works on arbitrary EVM chains via plain RPC, with built-in reorg handling and direct Postgres output
- **PostgreSQL 16**: Datastore — Ponder's native target; split into a raw event schema (Ponder-owned) and a `metric_snapshots` table (cron-owned); no TimescaleDB needed at SLVR's data volume
- **Node.js cron service**: Derived metrics computation — reads raw event tables, computes APR / supply / runway, writes timestamped rows to `metric_snapshots`; keeps complex business logic out of the indexer and API request path
- **Next.js 15 (App Router)**: Frontend + API layer — Route Handlers proxy Dexscreener (CORS) and serve computed metrics; App Router pages render dashboard with SWR polling for live vitals
- **viem 2.35+**: Chain reads — `defineChain` for Robinhood Chain, multicall3 auto-batching, V4 StateView reads, Uniswap V2 `getReserves()` for price
- **TradingView lightweight-charts 5.2 + Apache ECharts**: Charting — lightweight-charts for OHLC/price (canvas, 12 KB); ECharts for multi-series analytics (APR over time, supply/emissions/burns stacked area)
- **Tailwind CSS v4 + shadcn/ui**: Styling + components — v4 drops config file; shadcn/ui fully updated for v4; all components copied to codebase, no lock-in

### Expected Features

All four researchers independently ranked the Dividends APR as both the most important headline metric and the highest-risk implementation item. The vitals strip is the anchor — everything else builds below it.

**Must have (table stakes):**
- Headline vitals strip (Dividends APR, total SLVR staked, supply/runway, price) — the "hero" per PROJECT.md; every analytics site leads with this
- Data freshness indicator ("Last updated X min ago") — without this, users cannot trust numbers
- Supply time-series chart (circulating / total / max, cumulative burns, cumulative emissions) — foundational tokenomics view
- Staking chart (veSLVR + LP staking, permanent-lock breakdown) — core protocol health signal
- Grid Lottery activity chart (bets/round, winners, jackpot state) — proves the game is active
- SLVR price + liquidity chart — expected on any token page; Dexscreener API covers most of this
- Methodology / transparency page — community trust depends on "how is this calculated?" being answerable; especially critical for Dividends APR
- Mobile-responsive layout — vitals strip must work at 375px
- Historical time-series with time range selector (24H / 7D / 30D / 90D / ALL) — universal crypto analytics convention
- Contract address labels + Blockscout explorer links

**Should have (differentiators):**
- Dividends APR as the singular headline stat — no existing site prominently displays this yield metric; it is SLVRline's most distinctive number
- Mining runway projection ("~X months at current emission rate") — unique to SLVR's 500k fixed-cap model; no competitor shows this
- Permanent-lock breakdown (permanent veSLVR vs. time-decaying) — ve(3,3) governance health signal; modeled on Aerodrome/Blockworks analytics
- Multi-pool market view (V2 + V4 + SwapHood aggregated) — traders want total liquidity across all 16+ SLVR markets in one view
- Emissions-to-revenue ratio (protocol sustainability gauge) — Aerodrome analytics cites this as "the protocol's most important fundamental metric"
- Screenshot-friendly stat card layout — vitals strip designed to photograph cleanly at iPhone viewport width
- Independent source-of-truth positioning copy ("computed from indexed chain data, not the protocol frontend")

**Defer (v2+):**
- Wallet connect / personal position dashboard — explicit v2 per PROJECT.md; global stats ship first
- Subgraph diff view (compare SLVRline numbers to Goldsky subgraph) — high complexity; valuable for power users but not v1
- CSV / API export — serve the Goldsky subgraph endpoint in the meantime
- Jackpot insurance analytics — out of scope until the insurance contract source is verified

### Architecture Approach

The architecture is a four-layer pipeline with strict separation of concerns: (1) Ponder ingests raw events from the chain into Postgres event tables; (2) a scheduled cron job reads those tables and writes computed metrics to an append-only `metric_snapshots` table; (3) Next.js Route Handlers read `metric_snapshots` and serve JSON to the frontend; (4) the frontend polls `/api/vitals` every 10 seconds for live numbers and fetches chart data on viewport entry. Derived metrics — APR, circulating supply, runway — are never computed in the indexer or in the API request path. They live exclusively in the cron job, which is stateless and restartable without data loss.

**Major components:**
1. **Ponder indexer** (`/indexer`) — long-running Node.js process; registers all contracts with `startBlock`/`endBlock` per contract; event handlers upsert into raw event tables with `ON CONFLICT DO NOTHING` for idempotency; reorg detection built-in via shadow tables
2. **Metrics cron job** (`/metrics`) — separate stateless Node.js process; reads raw event tables; computes APR formula, circulating supply, runway; writes timestamped rows to `metric_snapshots`; cadence: 60s for vitals, 1h for chart history
3. **`metric_snapshots` table** — append-only Postgres table indexed on `(metric_name, snapshot_at DESC)`; single source of truth for all derived metrics; API reads latest row for vitals, reads time-range for charts
4. **Next.js API layer** (`/api` Route Handlers) — proxies Dexscreener (CORS), aggregates vitals from `metric_snapshots`, serves chart time-series, exposes `/api/status` for indexer lag; in-memory 10s cache for vitals
5. **Next.js frontend** (`/web`) — vitals strip with 10s SWR polling; charts with time range selector; SSR shell with server-fetched initial vitals; Ponder SQL-over-HTTP (`@ponder/client`) for direct indexed-data queries where needed

### Critical Pitfalls

All four researchers flagged the same top pitfalls. The first three are schema-level — fixing them after data is loaded requires a full re-index.

1. **Round-12,500 migration double-count or missing rounds** — Register `GridLotteryV1` (genesis to `MIGRATION_BLOCK`) and `GridLotteryV2` (`MIGRATION_BLOCK` onward) as separate named contracts in `ponder.config.ts` with non-overlapping `startBlock`/`endBlock`. Key every event row by `(chain_id, contract_address, tx_hash, log_index)`. After backfill, run a validation query asserting zero round numbers appear in events from both contract addresses. Use block number (not wall-clock timestamp) as the split boundary.

2. **Float arithmetic on 18-decimal token amounts** — Store all raw token amounts as `NUMERIC` (Postgres) or `TEXT`, never as `FLOAT8`. JavaScript `number` loses precision above `2^53 - 1` (~9 quadrillion), which is less than 10 SLVR in raw wei-equivalent units. Do all arithmetic in BigInt; convert to display strings exactly once at the rendering layer. Write a unit test: sum 1,000 transfers of `12345678901234567890` and assert the BigInt total matches.

3. **Non-idempotent event processing causing silent duplicate rows** — Every insert uses `ON CONFLICT DO NOTHING` on a primary key of `(chain_id, block_number, tx_hash, log_index)`. Test by running the same block-range backfill twice and asserting row counts are identical. Ponder handles this pattern natively; do not bypass it.

4. **Dividends APR formula errors** — Wrong numerator (using total emissions instead of dividends funded by other miners), wrong denominator (using total staked SLVR instead of unclaimed reward pool), or wrong annualization window (24h spike annualized produces astronomical APR) all produce a misleading headline number. Derive the exact formula from the Grid Lottery + SLVR Hub contract ABIs during the metrics phase; cross-validate against the Goldsky subgraph before shipping. Use a 7-day rolling window; label it "7-Day APR" explicitly.

5. **Computing APR or circulating supply in the API request path** — Multi-table joins across lottery events, transfers, and staking events are expensive. At 10s polling cadence they thrash the database. Pre-compute in the metrics cron job; the API reads a single pre-computed row from `metric_snapshots`. Never put aggregation SQL inside a Route Handler.

## Implications for Roadmap

Research is unambiguous about phase order: each layer is a dependency of the next. The indexer must be proven correct before metrics can be computed; metrics must be proven correct before the API can serve them; the API must be stable before the frontend is built. Shortcuts collapse correctness guarantees.

### Phase 1: Indexer Foundation

**Rationale:** Nothing else is possible without indexed data. The round-12,500 migration split must be in the initial schema — it cannot be retrofitted. Float precision and idempotency must be established before the first byte is written.
**Delivers:** Ponder running on Robinhood Chain (id 4663), indexing SLVR token transfers and both Grid Lottery contracts (V1 + V2) with non-overlapping block ranges. Event counts validated against the Goldsky subgraph. All rows keyed by `(chain_id, contract_address, tx_hash, log_index)`. All amounts stored as `NUMERIC`. Idempotency tested by double-backfill. Gap detection query passing. Dividends APR formula researched and documented before Phase 3 begins.
**Addresses:** Round-12,500 correctness, float precision, idempotency, data freshness baseline
**Avoids:** Pitfalls 1, 2, 3 (all schema-level; only fixable here)
**Research flag:** Needs deeper research — Dividends APR formula must be derived from Grid Lottery + SLVR Hub ABIs during this phase (treat as a deliverable, not a discovery task). Also: verify exact migration block number from Blockscout; empirically measure Robinhood Chain RPC rate limits to tune `ethGetLogsBlockRange` (start at 500 blocks/request).

### Phase 2: Full Contract Coverage

**Rationale:** Depends on Phase 1 proving the migration split and indexer pattern. Expand to all contracts once the core correctness pattern is established and validated.
**Delivers:** Full event indexing for all production contracts: veSLVR vote-escrow (locks, permanent locks, decay), veSLVR staking (deposits, revenue distributions), LP staking, SLVR Hub (revenue routing), Uniswap V2 SLVR/WETH pair (swaps, sync events for price/liquidity), Uniswap V4 PoolManager (Swap + ModifyLiquidity events filtered by SLVR pool IDs — `bytes32`, not addresses). Historical indexing for superseded contracts where historical event data is needed.
**Addresses:** All headline metric dependencies; staking analytics; market analytics; veNFT permanent-lock breakdown
**Avoids:** V4 pool ID anti-pattern (must use `bytes32` pool IDs with StateView, not PoolManager address directly); veNFT double-counting (canonical source = Vote Escrow `supply()`, not Transfer event sums); fee-on-transfer mismatch (use `balanceOf()` snapshots for balance tracking)
**Research flag:** Moderate — V4 pool IDs should be verified on-chain from PoolManager Initialize events on Blockscout. Superseded contract ABIs need confirmation before indexing.

### Phase 3: Derived Metrics Layer

**Rationale:** Depends on Phase 2 (all tables populated). This is where the APR formula researched in Phase 1 is implemented. Do not begin until the formula is confirmed and documented.
**Delivers:** `metric_snapshots` table; cron job writing: Dividends APR (7-day rolling, validated against Goldsky subgraph), circulating supply (totalSupply - burned - team vesting - undeployed growth fund; veSLVR-locked SLVR is NOT excluded from circulating — tracked separately as "staked"), staking totals (veSLVR + permanent-lock + LP), mining runway (remaining cap / current emission rate), emissions and burns time-series, current round state. All stored as `NUMERIC` strings.
**Addresses:** Dividends APR, supply analytics, staking analytics, mining runway, emissions-to-revenue ratio
**Avoids:** APR formula errors (formula confirmed in Phase 1); materialized view anti-pattern (append-only table + cron, not `REFRESH MATERIALIZED VIEW`); computing metrics in the API request path
**Research flag:** HIGH — APR formula validation is the single largest unknown. Cross-check computed APR against Goldsky subgraph for a known 7-day window before shipping the metric.

### Phase 4: API Layer

**Rationale:** Depends on Phase 3 (`metric_snapshots` populated). The API is intentionally thin — reads pre-computed rows, adds short in-memory cache, proxies external feeds. No business logic here.
**Delivers:** `/api/vitals` (latest snapshot per metric, 10s in-memory cache), `/api/charts/[metric]` (time-range query on `metric_snapshots`), `/api/status` (indexer lag: chain head block vs. last indexed block), Dexscreener proxy Route Handler (CORS bypass, 60s cache), ETH price proxy. All token amounts returned as strings, not JavaScript numbers.
**Addresses:** Staleness indicator (via `/api/status`), Dexscreener multi-market aggregation, RPC single-point-of-failure (fallback configured in Ponder; slvr.fun price endpoint cached in metrics cron)
**Avoids:** Aggregation SQL in Route Handlers; CORS failures on Dexscreener; hardcoded ETH/USD price
**Research flag:** Low — standard Next.js Route Handler patterns.

### Phase 5: Frontend

**Rationale:** Depends on Phase 4 (stable API endpoints). Frontend is last because visual decisions are easier to make when data shapes are confirmed.
**Delivers:** Vitals strip (APR, staked, supply/runway, price) with 10s SWR polling and data freshness indicator; historical charts (supply/emissions/burns stacked area, staking + permanent-lock, price/volume OHLC, round activity bar); time range selector (24H / 7D / 30D / 90D / ALL); methodology page (formula per metric, contract addresses, Goldsky subgraph link); mobile-responsive layout; staleness warning banner if indexer lag exceeds 5 minutes; "silver" brand aesthetic.
**Addresses:** Screenshot-friendly layout, mobile responsiveness, independent source-of-truth positioning, UX pitfalls (round APR to 2 decimal places; show "data pending" not 0 for unprocessed metrics)
**Avoids:** Recharts (use ECharts + lightweight-charts instead); Nivo (too heavy); tRPC in v1 (Ponder SQL-over-HTTP + Route Handlers sufficient); wallet connect (explicit v2 deferral)
**Research flag:** Low — well-documented stack; no unknowns beyond Phase 3 resolution.

### Phase Ordering Rationale

- **Schema-level decisions cannot be deferred.** Float precision (NUMERIC, not FLOAT8), idempotency (ON CONFLICT DO NOTHING), and the round-12,500 split (per-contract `startBlock`/`endBlock`) are all Phase 1 requirements because fixing any of them after data is loaded requires a full re-index. There is no safe shortcut.
- **The Dividends APR formula is a research gate, not just a code gate.** It must be derived and documented in Phase 1 before the metrics layer is built in Phase 3. Writing the cron job without a validated formula produces a misleading headline number that damages community trust.
- **Derived metrics are decoupled from the indexer by design.** The metrics cron job reads raw event tables and writes to `metric_snapshots`. Re-computing with a corrected formula requires only re-running the cron, not re-indexing the chain. The indexer never blocks on aggregation. The API request path is always fast.
- **Goldsky subgraph is a cross-check, never the source.** Used in Phases 1, 2, and 3 to validate row counts and metric values. Never in the production data path.

### Research Flags

Phases needing deeper research during planning:
- **Phase 1 (Indexer Foundation):** Dividends APR formula extraction from contract ABIs is a required deliverable. Verify the exact migration block number from Blockscout. Measure Robinhood Chain RPC rate limits empirically during initial backfill.
- **Phase 2 (Full Contract Coverage):** Verify Uniswap V4 SLVR pool IDs on-chain from PoolManager Initialize events. Confirm superseded contract ABIs from Blockscout before indexing.
- **Phase 3 (Derived Metrics):** HIGH flag — APR formula cross-validation against Goldsky subgraph is mandatory before shipping.

Phases with standard patterns (no additional research needed):
- **Phase 4 (API Layer):** Next.js Route Handlers + in-memory cache are well-documented patterns with no unknowns.
- **Phase 5 (Frontend):** ECharts + lightweight-charts + shadcn/ui + Tailwind v4 are established patterns with clear documentation.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Ponder 0.17.1, viem 2.35+, Next.js 15, Tailwind v4, shadcn/ui all confirmed against official docs and current releases |
| Features | MEDIUM-HIGH | Patterns verified across DefiLlama, Aerodrome/Blockworks, Token Terminal, Dexscreener; SLVR-specific metric definitions inferred from PROJECT.md and general DeFi patterns, not from confirmed contract source |
| Architecture | HIGH | Four-layer pipeline is the standard pattern for self-hosted EVM analytics; Ponder specifics confirmed via official docs; derived metrics snapshot approach confirmed as superior to materialized views for this use case |
| Pitfalls | HIGH (patterns) / LOW (chain-specific) | EVM indexing correctness pitfalls are well-documented; SLVR-specific risks derived from protocol structure; Robinhood Chain RPC behavior requires empirical measurement |

**Overall confidence:** MEDIUM-HIGH

### Gaps to Address

- **Dividends APR formula (LOW confidence):** The exact events and field values representing "dividends paid" vs. "unclaimed mining rewards pool" in the Grid Lottery + SLVR Hub contracts have not been confirmed from contract source. Resolution: inspect contract ABIs on Blockscout and cross-validate against Goldsky subgraph event schemas during Phase 1. This is a required deliverable before Phase 3 begins, not an optional discovery task.

- **Robinhood Chain RPC behavior (LOW confidence):** Rate limits, maximum `eth_getLogs` block range without timeout, and actual reorg depth are not publicly documented. Resolution: measure empirically during Phase 1 backfill. Start with 500-block ranges. Monitor reorg depth via Blockscout over the first two weeks to calibrate the finality buffer (start at 64 blocks).

- **V4 pool ID verification:** The `bytes32` pool IDs in PROJECT.md should be verified from PoolManager `Initialize` event logs on Blockscout before indexing V4 events. V4 pool IDs are deterministic from `PoolKey` struct and can be confirmed programmatically.

- **Historical contract ABIs:** Several superseded contracts have "obsolete/unverified" status per PROJECT.md. Their ABIs must be confirmed from Blockscout before indexing. Unverified ABIs cause silent misparsing.

- **Circulating supply definition for growth fund:** The growth fund (`0x1A1633FDB2f19082099A6AD6C3d4F1Ec6BCE9729`) exclusion from circulating supply depends on whether it has been deployed. Requires a one-time balance check before finalizing the supply formula.

## Sources

### Primary (HIGH confidence)
- Ponder official docs + Context7 (`/ponder-sh/ponder`) — chain configuration, reorg handling, SQL-over-HTTP, contract migration patterns, per-block atomic transactions
- viem Context7 (`/wevm/viem`) — `defineChain`, multicall, custom chain pattern
- Uniswap V4 StateView official docs (`https://docs.uniswap.org/contracts/v4/guides/state-view`) — pool ID format, StateView query pattern
- Next.js 15 + shadcn/ui Tailwind v4 support (`https://ui.shadcn.com/docs/tailwind-v4`) — component compatibility confirmed
- TradingView lightweight-charts npm (`https://www.npmjs.com/package/lightweight-charts`) — v5.2.0 confirmed
- Curve Voting Escrow Docs (`https://docs.curve.finance/curve_dao/voting-escrow/voting-escrow/`) — veNFT mechanics and permanent lock patterns
- PROJECT.md — authoritative spec for all contract addresses, chain config, scope boundaries, and constraints

### Secondary (MEDIUM confidence)
- Sentio/Envio indexer benchmark (May 2025) — Ponder vs. Envio performance on RPC-only chains
- Aerodrome Finance analytics (Blockworks) — ve(3,3) feature patterns and permanent-lock breakdown as a dashboard signal
- DefiLlama, Token Terminal, Dexscreener product feature analysis — table-stakes feature patterns for crypto analytics dashboards
- PostgreSQL metrics snapshot table vs. materialized view trade-offs — industry consensus from multiple sources
- TimescaleDB vs. PostgreSQL at analytics scale — pgbench.com comparison, confirmed by architecture reasoning
- Railway vs. Fly.io hosting pricing — accurate as of 2026-07-24

### Tertiary (LOW confidence)
- Robinhood Chain RPC rate limits and reorg depth — no public documentation; requires empirical measurement during Phase 1
- Dividends APR formula — inferred from PROJECT.md description ("yield earned by miners who have not yet claimed their mining rewards, funded by other miners"); not confirmed from contract source; treat as unverified until Phase 1 contract research completes
- Annualization window risk for APR — derived from DeFi analytics community practice, not a formal source

---
*Research completed: 2026-07-24*
*Ready for roadmap: yes*

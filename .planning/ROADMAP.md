# Roadmap: SLVRline

## Overview

SLVRline is built in five sequential layers, each a hard dependency of the next. The indexer must be proven correct before metrics are computed; metrics must be correct before the API serves them; the API must be stable before the frontend is built. The critical path runs: indexer foundation (with the Dividends APR formula derived as a deliverable) → full contract expansion → derived metrics computation → thin API layer → branded frontend. Skipping any layer collapses the correctness guarantees that make SLVRline an independent source of truth.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Indexer Foundation** - Ponder running on Robinhood Chain, SLVR token + both Grid Lottery contracts indexed with migration-safe schema; Dividends APR formula derived and documented
- [ ] **Phase 2: Full Contract Coverage** - All production contracts indexed: veSLVR, LP staking, SLVR Hub, V2 + V4 DEX pools; historical contracts where needed
- [ ] **Phase 3: Derived Metrics** - Cron job writes APR, supply/runway, staking totals, round state, emissions/burns to metric_snapshots; all cross-validated against Goldsky subgraph
- [ ] **Phase 4: API Layer** - Thin Next.js Route Handlers serve pre-computed metrics, proxy Dexscreener + ETH price, expose freshness/status endpoint
- [ ] **Phase 5: Frontend** - Branded "silver" analytics site: vitals strip with SWR polling, historical charts, time-range selector, methodology page, mobile-responsive layout

## Phase Details

### Phase 1: Indexer Foundation
**Goal**: SLVRline independently indexes SLVR protocol history on Robinhood Chain with correctness guarantees that cannot be retrofitted
**Depends on**: Nothing (first phase)
**Requirements**: DATA-01, DATA-02, DIV-01
**Success Criteria** (what must be TRUE):
  1. A validation query against the indexed database returns zero round numbers that appear in events from both the old Grid Lottery (`0x284Eb4...`) and the new one (`0xB0Cc99...`) — the migration split is clean
  2. A double-backfill test (same block range indexed twice) returns identical row counts with no duplicates — idempotency holds
  3. Running the same aggregation (e.g. total transfers) using raw NUMERIC amounts in BigInt matches the Goldsky subgraph total within rounding tolerance — no float precision loss
  4. The Dividends APR formula (numerator, denominator, annualization window) is documented in .planning/ with the specific contract events and field values it uses, derived from the Grid Lottery + SLVR Hub ABIs and cross-referenced against at least one known Goldsky subgraph value
**Plans**: TBD

### Phase 2: Full Contract Coverage
**Goal**: Every production contract contributing to staking, DEX liquidity, and lottery history is indexed, ready for the metrics layer to read
**Depends on**: Phase 1
**Requirements**: STK-01, STK-02, LOT-02
**Success Criteria** (what must be TRUE):
  1. A query against indexed veSLVR event tables returns a total locked SLVR amount that matches the Vote Escrow NFT contract's on-chain `supply()` call within 0.01% (canonical source beats Transfer event sums)
  2. Historical Grid Lottery activity across both contracts spans rounds from genesis through the current round with no gap at the round-12,500 boundary — a chart of bets-per-round shows a continuous series
  3. At least one V4 SLVR pool (bytes32 pool ID verified from PoolManager Initialize events on Blockscout) has indexed Swap events with correct token amounts stored as NUMERIC
  4. LP staking deposits and withdrawals are indexed with balances reconciling against the LP staking contract's on-chain `totalSupply()` call
**Plans**: TBD

### Phase 3: Derived Metrics
**Goal**: A cron job reliably computes all protocol metrics from indexed data and writes them to metric_snapshots — the API will only ever read this table, never aggregate raw events
**Depends on**: Phase 2
**Requirements**: SUP-01, SUP-02, SUP-03, LOT-01
**Success Criteria** (what must be TRUE):
  1. The Dividends APR value in metric_snapshots (7-day rolling) is within 5% of the value derivable from the Goldsky subgraph for the same 7-day window — cross-validation passes before this metric is marked shippable
  2. Circulating supply in metric_snapshots equals on-chain SLVR `totalSupply()` minus cumulative confirmed burns minus team-vesting and undeployed growth-fund balances — value verifiable by a developer with a block explorer in under 5 minutes
  3. Mining runway displays as "~X months at current emission rate" with the current 30-day emission rate and remaining cap (500,000 minus total emitted) both present as intermediate values in metric_snapshots
  4. Current Grid Lottery round state (round number, active bet count, jackpot size) in metric_snapshots matches the on-chain `round-state` endpoint within one round
**Plans**: TBD

### Phase 4: API Layer
**Goal**: Next.js Route Handlers expose pre-computed metrics over HTTP — all numbers come from metric_snapshots, no aggregation happens in the request path
**Depends on**: Phase 3
**Requirements**: MKT-01, MKT-02
**Success Criteria** (what must be TRUE):
  1. `GET /api/vitals` returns a JSON object with all headline metrics (APR, staked, circulating supply, runway, price) in under 200ms — verified by timing the endpoint with curl against the running server
  2. `GET /api/status` returns the current indexed block height and chain head block height, allowing a visitor (or monitoring tool) to compute indexer lag in blocks without reading the database directly
  3. SLVR price from `GET /api/vitals` matches Dexscreener's reported price for the primary pool within 1% — the Dexscreener proxy is working and aggregating correctly
  4. SLVR total liquidity in `GET /api/vitals` aggregates across all pools Dexscreener reports for the SLVR token address — not just the primary pool
**Plans**: TBD

### Phase 5: Frontend
**Goal**: A visitor landing on SLVRline can immediately read the protocol's live vitals, drill into historical charts, and trust the numbers because the methodology is documented and the data source is labeled
**Depends on**: Phase 4
**Requirements**: DATA-03, DATA-04, DATA-05, VITALS-01, VITALS-02, DIV-02, UI-01, UI-02
**Success Criteria** (what must be TRUE):
  1. A visitor sees all five headline vitals (Dividends APR, total SLVR staked, circulating supply, mining runway, SLVR price) in a single glanceable strip without scrolling on a 375px viewport — screenshot taken at iPhone width looks clean and share-worthy
  2. Every live number in the vitals strip shows a "last updated X min ago" or "block #N" freshness indicator — a visitor can judge data staleness without reading documentation
  3. A visitor can navigate to the methodology page and find the exact formula, contract addresses, and data source for every metric displayed — including the Dividends APR annualization window and the circulating supply exclusions
  4. Every contract address and labeled wallet on the site links to its Blockscout explorer page and displays a human-readable protocol label (e.g. "SLVR Hub" not "0x55FC0d...")
  5. Historical charts for supply, staking, price, and lottery activity each support a 24H / 7D / 30D / 90D / ALL time-range selector that filters chart data without a page reload
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Indexer Foundation | 0/TBD | Not started | - |
| 2. Full Contract Coverage | 0/TBD | Not started | - |
| 3. Derived Metrics | 0/TBD | Not started | - |
| 4. API Layer | 0/TBD | Not started | - |
| 5. Frontend | 0/TBD | Not started | - |

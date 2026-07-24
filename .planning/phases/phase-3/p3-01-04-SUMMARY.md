---
phase: 3
plans: "01-04"
subsystem: metrics
tags: [postgres, typescript, viem, metrics, time-series, derived-data]
dependency_graph:
  requires: [slvr.token_transfer, slvr.token_burn, slvr.dividend_index_update, slvr.ve_lock, slvr.ve_lock_event, slvr.lottery_round, slvr.lottery_bet, slvr.hub_emission_rate]
  provides: [metrics.metric_snapshots]
  affects: [phase-4-api]
tech_stack:
  added: [postgres@3.4.4, viem@2.26.7, ts-node@10.9.2]
  patterns: [time-series-append, formula-modules, separate-schema-isolation, per-metric-try-catch]
key_files:
  created:
    - app/metrics/package.json
    - app/metrics/tsconfig.json
    - app/metrics/src/db.ts
    - app/metrics/src/constants.ts
    - app/metrics/src/formulas/apr.ts
    - app/metrics/src/formulas/supply.ts
    - app/metrics/src/formulas/runway.ts
    - app/metrics/src/formulas/staking.ts
    - app/metrics/src/formulas/lottery.ts
    - app/metrics/src/snapshot.ts
    - app/metrics/src/run.ts
    - app/metrics/src/cron.ts
    - app/metrics/src/backfill.ts
    - db/migrations/003_metric_snapshots.sql
decisions:
  - "metrics schema separate from slvr — Ponder rebuilds slvr on re-index; metrics must survive"
  - "value column nullable (not NOT NULL) to support insufficient_data states with metadata.data_status"
  - "jackpot ETH from jackpot contract balance (jackpot() returns address; getBalance on that address)"
  - "currentRoundId() selector confirmed as 0x9cbe5efd (not roundId() which does not exist)"
  - "dividends_apr stores value as percentage points (e.g. 1229.4) not decimal ratio"
  - "emission_cumulative uses token_transfer.is_mint sum (not hub RewardMinted) per RESEARCH.md §1c"
metrics:
  duration: "~25 minutes"
  completed: "2026-07-25"
  tasks_completed: 4
  files_created: 14
---

# Phase 3 Plans 01-04: Derived Metrics Layer Summary

One-liner: Standalone TS metrics package (postgres.js + viem) computing 7 protocol metrics from slvr.* tables and live eth_calls, writing append-only rows to metrics.metric_snapshots with zero runtime errors against partial backfill data.

## What Was Built

`app/metrics/` — standalone Node/TypeScript package. Four plans (scaffold, formulas, orchestrator, backfill) implemented atomically.

### Package Structure

```
app/metrics/
  package.json         @slvrline/metrics, private, deps: postgres + viem
  tsconfig.json        target ES2020, CommonJS, strict
  src/
    db.ts              postgres.js pool, DATABASE_URL env
    constants.ts       addresses, WAD, APR params, cron intervals
    formulas/
      apr.ts           7-day rolling minerIndex delta APR
      supply.ts        totalSupply() eth_call minus excluded balances
      runway.ts        500k cap minus total_emitted, 30-day rate
      staking.ts       ve_lock SUM by is_active/is_permanent
      lottery.ts       currentRoundId() eth_call + indexed bet count + jackpot balance
    snapshot.ts        writeSnapshot() insert helper (live + backfill modes)
    run.ts             computeAndWrite() — 7 metrics, per-metric try/catch
    cron.ts            60-second interval loop around computeAndWrite()
    backfill.ts        hourly slot walk, idempotent, uses ve_lock_event for staking history

db/migrations/
  003_metric_snapshots.sql   CREATE SCHEMA metrics; CREATE TABLE metrics.metric_snapshots
```

### DB Schema

`metrics.metric_snapshots` (schema: `metrics`, NOT `slvr`):
- `id BIGSERIAL`, `metric_name TEXT NOT NULL`, `value NUMERIC` (nullable — null = insufficient data),
  `value2 NUMERIC`, `value3 NUMERIC`, `metadata JSONB`, `snapshot_at TIMESTAMPTZ`, `block_number BIGINT`
- Indexes: `(metric_name, snapshot_at DESC)` and `(block_number DESC)`

**Correction vs plan:** Plan specified `value NUMERIC NOT NULL`. Changed to nullable to support
metrics returning NULL (e.g. dividends_apr when < 7 days of V2 data). This is required by the
formula specs in the same plan document (metadata.data_status pattern). The API will read NULL
as "data not yet available" and display accordingly.

## One-Shot Run Results (against partial backfill data)

Run at 2026-07-24 21:20:55 UTC | latest indexed block: 5,645,037

```
metric_name          | value              | value2             | block_number | snapshot_at
---------------------+--------------------+--------------------+--------------+---------------------
dividends_apr        | NULL               | NULL               | 5645037      | 2026-07-25 00:20:55
circulating_supply   | 6294.086238599213  | 6378.086282433622  | 5645037      | 2026-07-25 00:20:55
emission_cumulative  | 1033.6             | 149                | 5645037      | 2026-07-25 00:20:55
runway_months        | 482.74613003095976 | 498966.39999999997 | 5645037      | 2026-07-25 00:20:55
emission_rate_30d    | 1033.6             | NULL               | 5645037      | 2026-07-25 00:20:55
total_staked_slvr    | 149                | 0                  | 5645037      | 2026-07-25 00:20:55
lottery_round_state  | 14267              | 0                  | 5645037      | 2026-07-25 00:20:55
```

### Metric-by-metric status

| metric_name | Status | Value | Why |
|---|---|---|---|
| `dividends_apr` | NULL (expected) | — | No `dividend_index_update` rows yet (indexer at block 5,645,037; MinerIndexUpdated events come from GridLottery, not token contract) |
| `circulating_supply` | Computed | 6,294.09 SLVR | totalSupply() 6,378.09 minus 84 SLVR across excluded wallets |
| `emission_cumulative` | Computed | 1,033.6 emitted, 149 burned | Partial (backfill at block 5,645,037 of ~18,464,209 head) |
| `runway_months` | Computed | 482.75 months | remaining cap / 30-day rate |
| `emission_rate_30d` | Computed | 1,033.6 SLVR | Partial 30-day window |
| `total_staked_slvr` | Computed | 149 SLVR (3 locks) | 2 permanent + 1 time lock; ve_lock table current state |
| `lottery_round_state` | Computed | round 14267, jackpot 29.46 ETH | eth_call live on-chain; 0 bets indexed (lottery_bet not yet populated) |

**WARNING logged (expected):** lottery roundId (14267) is 14267 rounds ahead of indexed (0) — indexer has not reached GridLottery blocks yet. This is not a bug; it's a data status message. Once backfill reaches block 16,764,101+ (GridLottery V2 deploy), indexed and live will converge.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] value column must be nullable**
- Found during: Plan 01 schema review (formula specs in same plan doc require NULL for dividends_apr)
- Issue: Plan's SQL said `value NUMERIC NOT NULL` but the per-metric spec says return `apr: null` when insufficient data
- Fix: Changed migration to `value NUMERIC` (nullable). API reads NULL as "data pending"
- Files modified: db/migrations/003_metric_snapshots.sql

**2. [Rule 1 - Bug] currentRoundId() selector differs from plan**
- Found during: Plan 03 lottery.ts implementation + live verification
- Issue: Plan cited `roundId()` as the public getter, but ABI inspection + eth_call showed:
  - `roundId()` selector 0x8cd221c9 → reverts (does not exist)
  - `currentRoundId()` selector 0x9cbe5efd → returns 14264 (correct)
- Fix: Used `currentRoundId` as the function name in lottery.ts ABI; verified live
- Files modified: app/metrics/src/formulas/lottery.ts

**3. [Rule 1 - Bug] Jackpot balance from jackpot contract address, not a balance getter**
- Found during: Plan 03 lottery.ts — plan said "try jackpotBalance() or currentJackpot() getter"
- Issue: ABI inspection showed `jackpot()` returns an address (not a balance). No balance getter exists.
- Fix: Call `jackpot()` to get the jackpot contract address, then `eth_getBalance` on that address (29.46 ETH confirmed). Fall back to lottery contract balance if jackpot() fails.
- Files modified: app/metrics/src/formulas/lottery.ts

**4. [Rule 2 - Missing critical functionality] emission_rate_30d as separate metric row**
- Found during: Plan 03 run.ts — plan's metric table listed only 6 metrics but PLAN.md text referenced `emission_rate_30d` as separate from `emission_cumulative`
- Fix: Added `emission_rate_30d` as a 7th metric row (uses same runway computation, no extra RPC calls). This enables the API to query rate separately from cumulative totals.
- Files modified: app/metrics/src/run.ts

**5. [Rule 3 - Blocking] runway computation called twice in run.ts**
- Found during: run.ts implementation — emission_cumulative and runway_months both needed runway data
- Fix: Moved runway computation to a single call, shared between emission_cumulative and runway_months writes. Zero extra RPC or DB calls.
- Files modified: app/metrics/src/run.ts

### Schema Corrections vs Plan

| Item | Plan | Actual | Reason |
|---|---|---|---|
| Table schema | `public` (implied) | `metrics` | Plan said "separate schema metrics" in architecture but migration example was bare `metric_snapshots`. Used `metrics.metric_snapshots` per architecture decision. |
| `value` nullability | `NOT NULL` | nullable | Formula spec requires NULL for insufficient_data states |
| Lottery getter | `roundId()` | `currentRoundId()` | ABI mismatch; confirmed live |
| Jackpot source | `jackpotBalance()` getter | `eth_getBalance(jackpot())` | No balance getter in ABI |
| Metric count | 6 | 7 | Added `emission_rate_30d` as standalone row |

## Self-Check: PASSED

All 14 files created. All 4 commits found. 7 metric_snapshots rows written. tsc --noEmit: 0 errors.

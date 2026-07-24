# Phase 3: Derived Metrics — PLAN

**Requirements satisfied:** SUP-01, SUP-02, SUP-03, LOT-01
**Phase goal:** A scheduled Node/TS metrics job reads Phase 1/2 indexed tables, computes all
protocol metrics, and appends time-series rows to `metric_snapshots`. The API (Phase 4) will
read only this table — never the raw event tables — on the request path.

---

## Architecture Decision: Package Location

**Decision: `app/metrics/` as a standalone Node.js package (NOT inside `app/indexer/`).**

Rationale:
- The metrics job reads raw event tables via plain SQL (postgres.js) — no Ponder runtime
  context is needed. Coupling it to the indexer would force it through Ponder's startup/backfill
  lifecycle, blocking snapshot writes until backfill completes.
- The job must run one-shot for manual re-runs and on an interval for live vitals — a separate
  process achieves this cleanly without Ponder knowledge.
- The indexer (`app/indexer/`) must remain restartable without side effects; injecting a
  scheduler into it would violate that invariant.
- The API (`app/api/` or `app/`) will import only SQL reads from `metric_snapshots` — clean
  layering is maintained.

`app/metrics/` structure:
```
app/metrics/
  package.json          # name: "@slvrline/metrics", private
  tsconfig.json
  src/
    db.ts               # postgres.js pool, DATABASE_URL from env
    constants.ts        # addresses, WAD, chain ID, cap, exclusions
    formulas/
      apr.ts            # dividends APR index-delta computation
      supply.ts         # circulating supply + emission/burn totals
      runway.ts         # mining runway
      staking.ts        # ve + LP staking totals
      lottery.ts        # current round state via eth_call
    snapshot.ts         # write one metric_snapshots row (upsert helper)
    run.ts              # main entry: compute all metrics, write snapshot
    backfill.ts         # historical backfill: walk block history, write hourly snapshots
  scripts/
    run-once.ts         # one-shot: ts-node src/run.ts
    backfill.ts         # historical: ts-node src/backfill.ts --from=BLOCK --to=BLOCK
```

---

## `metric_snapshots` Schema

**Location:** Same PostgreSQL database as the indexer (`postgresql://timwilliams@localhost:5433/slvrline`).
Schema ownership: The metrics job owns `metric_snapshots`. Ponder owns the raw event tables.
Neither writes to the other's tables.

```sql
-- Run once on first deploy (or via db/migrations/003_metric_snapshots.sql)
CREATE TABLE IF NOT EXISTS metric_snapshots (
  id              BIGSERIAL PRIMARY KEY,
  metric_name     TEXT        NOT NULL,
  value           NUMERIC     NOT NULL,   -- primary scalar (always present)
  value2          NUMERIC,                -- secondary scalar (optional, see per-metric notes)
  value3          NUMERIC,                -- tertiary scalar (optional)
  metadata        JSONB,                  -- all intermediate values + inputs (required for audit)
  snapshot_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  block_number    BIGINT      NOT NULL    -- indexer's latest indexed block at time of computation
);

CREATE INDEX IF NOT EXISTS idx_metric_snapshots_name_time
  ON metric_snapshots (metric_name, snapshot_at DESC);

CREATE INDEX IF NOT EXISTS idx_metric_snapshots_block
  ON metric_snapshots (block_number DESC);
```

### Per-metric column mapping

| metric_name              | value                        | value2                 | value3               | metadata (JSONB)                                             |
|--------------------------|------------------------------|------------------------|----------------------|--------------------------------------------------------------|
| `dividends_apr`          | APR as decimal (e.g. 12.29)  | Δ minerIndex (bigint string) | annualization factor | `{ index_now, index_7d_ago, window_seconds, v2_contract, block_now, block_7d_ago }` |
| `circulating_supply`     | circulating SLVR / 1e18      | total_supply / 1e18    | burned / 1e18        | `{ total_supply_raw, burned_raw, excluded_balances: {team, growth, growth_recipient}, permanent_locked_raw }` |
| `emission_cumulative`    | total emitted SLVR / 1e18    | total burned / 1e18    | null                 | `{ mint_count, burn_count, net_change }` |
| `emission_rate_30d`      | SLVR emitted in last 30d / 1e18 | burns in 30d / 1e18  | null                 | `{ from_block, to_block, from_time, to_time }` |
| `runway_months`          | months remaining (float)     | remaining_cap / 1e18   | rate_30d / 1e18      | `{ cap_raw, total_emitted_raw, remaining_raw, rate_30d_raw, computed_at_block }` |
| `total_staked_slvr`      | total locked SLVR / 1e18     | timelocked / 1e18      | permanent / 1e18     | `{ ve_lock_count, lp_lp_token_total, lp_note: "LP tokens not SLVR — excluded from total" }` |
| `lottery_round_state`    | current round_id (integer)   | active_bet_count       | jackpot_eth / 1e18   | `{ round_id, bet_count, jackpot_wei, jackpot_eth, source: "eth_call", called_at }` |

All `value` columns store SLVR in human units (divided by 1e18) except `dividends_apr` (ratio,
not raw) and `lottery_round_state.value` (round number integer). The `metadata` JSONB stores raw
bigint values as decimal strings (no precision loss).

---

## Circulating Supply — Exclusion Set (Explicit)

**Definition:**
```
circulating_supply = on_chain_totalSupply() − cumulative_confirmed_burns − excluded_balances
```

**Excluded wallets (non-circulating SLVR):**

| Address | Label | Source | Rationale |
|---------|-------|--------|-----------|
| `0xFAfcBd4D09C096Eb06Aa2256C7A65CEAB2db39F5` | Team Vesting | RESEARCH.md §1c, ARCHITECTURE.md | 8% of every mint goes here; not circulating until vested |
| `0x1A1633FDB2f19082099A6AD6C3d4F1Ec6BCE9729` | Growth Fund | RESEARCH.md §1c | 4% of every mint goes here; reserved for protocol growth |
| `0x4444479B89b684e79392924B3A70BE03733190dE` | Growth Recipient | ARCHITECTURE.md | Downstream of growth fund; holds undeployed growth SLVR |

**Permanently locked SLVR:** NOT subtracted as a balance. Permanent locks BURN the underlying
SLVR (verified in RESEARCH.md §5: "Actually burn the tokens to reduce total supply"). This means
permanently locked SLVR is already NOT in `totalSupply()`. No separate subtraction needed.

**Time-locked SLVR (veSLVR):** NOT excluded. These tokens are escrowed in the veNFT contract
(`0xd9b8FBD61033145c5496132153CE675756313B71`) and ARE held as `balanceOf(veNFT)` in
`totalSupply()`. They are locked but not surrendered — comparable to staked but recoverable.
Following the same conventions as most DeFi analytics (e.g., CoinGecko circulating supply),
escrowed tokens count as circulating unless permanently destroyed. Document this assumption on the
methodology page.

**LP staked SLVR:** NOT excluded for the same reason — the underlying SLVR exists in the V2 pair
pool or veNFT; it counts in `totalSupply()` and is recoverable.

**Protocol deployer** (`0x11111972FE1b7e52D36609bCaF8702c65b025B46`): NOT excluded by default.
ARCHITECTURE.md lists it as a candidate, but RESEARCH.md §1c does not confirm it holds
non-circulating SLVR beyond the genesis mint (which was already split to team/growth). If the
deployer currently holds SLVR, the balance would be visible via `eth_call balanceOf(deployer)`.
The metrics job fetches this balance at snapshot time; if > 0, it is logged to `metadata` as
`deployer_balance` for audit. It is NOT subtracted from circulating supply in the headline figure
(document assumption on methodology page and revisit if the community requests otherwise).

**Implementation:** The metrics job calls `eth_call balanceOf(addr)` for each excluded address
at snapshot time (no reliance on indexed Transfer events for the balance — too fragile to compute
accurate running balances from events alone for non-indexed paths). This is 3 RPC calls per
snapshot, which is trivial.

**Cross-validation shortcut:** The SLVR token contract exposes a `getCirculatingSupply()` getter
(RESEARCH.md §1e, last paragraph: "= totalSupply − teamVesting balance − growthFund balance").
Call this as a fast cross-check after computing our figure. Our value may differ if the on-chain
method uses different exclusion logic — document any divergence in `metadata.on_chain_cs`.

---

## V1→V2 minerIndex Continuity for APR

Per RESEARCH.md §4c ("Open Questions" item 2) and METHODOLOGY.md §8:

- V2 started its `minerIndex` accumulator at 0 when deployed (block 16,764,101).
- **Live headline APR:** use V2 (`dividend_index_update WHERE contract_address = V2_ADDRESS`).
  Always. The 7-day window must span ≥7 days of V2 data; if V2 has fewer than 7 days of data,
  set `value = NULL` and `metadata.data_status = "insufficient_v2_data"`. Do not fall back to V1
  for the headline — the indexes are independent and cannot be stitched.
- **Historical backfill snapshots (for APR chart):** use V2 data from block 16,764,101 onward.
  For dates before V2 deployment, use V1's index with a discontinuity annotation stored in
  `metadata.contract_version = "v1"`. The chart layer (Phase 5) will render the discontinuity.
- Do NOT add V1 and V2 index values — they are independent.

---

## Mining Runway Formula

```
remaining_cap = 500_000e18 − total_emitted
rate_30d      = SUM(token_transfer.value WHERE is_mint=true AND block_time >= NOW()-30d) / 1e18
runway_months = (remaining_cap / 1e18) / (rate_30d / 1e18 * 12)
              = remaining_cap_human / (rate_30d_human * 12)
```

Where `total_emitted` = `SUM(token_transfer.value WHERE is_mint=true)` (canonical emission
source per PLAN.md Phase 1 gotcha #2: token `Transfer(from=0x0)`, not Hub `RewardMinted`).

If `rate_30d == 0` (no emissions in last 30 days), set `value = NULL` and
`metadata.data_status = "no_emissions_in_30d"`.

The Hub's `hub_emission_rate` table (from `EmissionRateChanged` events) can provide a
cross-check on the rate. The 30-day token-transfer method is more accurate for actual throughput;
`hub_emission_rate` reflects the configured rate (which may differ from actual due to cap hits,
`EmissionSkipped`, etc.). Log the most recent `hub_emission_rate.ratePerSec` in `metadata` as
`hub_configured_rate_per_sec` for audit.

---

## Current Lottery Round State

The metrics job cannot use indexed lottery tables for "current round state" directly, because the
current round's bets may not yet be resolved — they exist as `lottery_bet` rows without a
matching `lottery_round` resolution. The correct source is a live `eth_call` to V2.

```
roundId   = eth_call roundId() on 0xB0Cc994Ce4E8fb106da9Eb36e26fDd8C5f1e0c71
            (or derive from latest lottery_round.round_id + 1 if eth_call fails)
```

The V2 contract has a `roundId` public getter returning the current round number. Active bet
count and jackpot can be derived from indexed `lottery_bet` rows for that round:

```sql
SELECT COUNT(*) as active_bet_count
FROM lottery_bet
WHERE contract_address = LOWER('0xB0Cc994Ce4E8fb106da9Eb36e26fDd8C5f1e0c71')
  AND round_id = $currentRoundId;
```

Jackpot size: the jackpot is an ETH balance held in the V2 lottery contract. The cleanest source
is `eth_call` to the V2 contract's public `jackpotBalance()` or equivalent getter (verify from
ABI). If no getter exists, use the Goldsky subgraph or compute from events as a fallback. Store
`metadata.jackpot_source = "eth_call"` or `"subgraph_fallback"`.

**Tolerance requirement (ROADMAP SC4):** must match on-chain round-state within ONE round.
Achieving this: we call `eth_call roundId()` at snapshot time — this IS the on-chain round,
not an estimate. The only divergence is if a round resolves between the eth_call and the bet-count
SQL query (race window). This is acceptable per the "within one round" tolerance.

---

## Historical Backfill Strategy

The backfill produces one snapshot per hour per metric, walking the indexed block history.
This populates charts before the cron job has accumulated live data.

**Approach:** For each target timestamp `t` in `[earliest_indexed_block_time, NOW()]` stepped
by 1 hour:
1. Find the latest indexed block at or before `t` (query `token_transfer.block_number WHERE
   block_time <= t ORDER BY block_number DESC LIMIT 1` — or any table with dense coverage).
2. Run each metric formula with a time-bounded query: replace `NOW()` with `t` in all WHERE
   clauses and `block_time <= t` filters.
3. Write a `metric_snapshots` row with `snapshot_at = t` and `block_number = block_at_t`.
4. Skip if a row for `(metric_name, snapshot_at)` already exists (`ON CONFLICT DO NOTHING`).

**APR historical note:** For `dividends_apr` snapshots before block 16,764,101 (V2 deploy),
use V1's `dividend_index_update` (same formula, different contract address). Mark
`metadata.contract_version = "v1"` on those rows.

**Runtime estimate:** With chain history from block 5,574,774 (~Jul 9 2026) to ~Jul 24 2026
= ~15 days = 360 hourly slots. 6 metric keys × 360 slots = ~2,160 writes. Runs in under
60 seconds.

**Production cron:** The live snapshot job runs every 60 seconds for vitals metrics and every
10 minutes for `emission_rate_30d` and `emission_cumulative` (less time-sensitive). The backfill
script runs once at Phase 3 completion and again after any re-index.

---

## Plan Dependency Graph

```
Plan 01 (DB migration + package scaffold)
    └── Plan 02 (formula implementations: APR, supply, runway, staking)
            └── Plan 03 (lottery round state + snapshot runner + live cron)
                    └── Plan 04 (historical backfill)
                            └── Plan 05 (validation: Goldsky cross-check, eth_call cross-check)
```

Plans 01–03 are sequential (each depends on prior). Plan 04 depends on Plan 03 (needs a working
`run.ts` to model the backfill after). Plan 05 depends on Plan 04 (needs populated snapshots).

---

## Plan 01 — DB Migration + Package Scaffold

**What:** Create `app/metrics/` package (package.json, tsconfig.json, src/db.ts,
src/constants.ts), run the `metric_snapshots` SQL migration, and create stub entry points.

**Wave:** 1 (no upstream dependency in phase)
**Files created:**
- `app/metrics/package.json`
- `app/metrics/tsconfig.json`
- `app/metrics/src/db.ts`
- `app/metrics/src/constants.ts`
- `db/migrations/003_metric_snapshots.sql`

**Acceptance check:**
```bash
cd app/metrics && npm install
npx ts-node src/db.ts   # connect test — should print "DB connected: slvrline"

psql -p 5433 slvrline -c "\d metric_snapshots"
# Expected: table exists with id, metric_name, value, value2, value3, metadata, snapshot_at, block_number columns

psql -p 5433 slvrline -c "SELECT indexname FROM pg_indexes WHERE tablename='metric_snapshots';"
# Expected: idx_metric_snapshots_name_time, idx_metric_snapshots_block
```

### package.json specification

```json
{
  "name": "@slvrline/metrics",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "run-once": "ts-node src/run.ts",
    "backfill": "ts-node src/backfill.ts",
    "dev": "ts-node --watch src/run.ts"
  },
  "dependencies": {
    "postgres": "^3.4.4",
    "viem": "^2.26.7"
  },
  "devDependencies": {
    "ts-node": "^10.9.2",
    "typescript": "^5.4.5",
    "@types/node": "^20.11.0"
  }
}
```

Use `postgres` (postgres.js) for all SQL — same driver the API will use. Use `viem` for
`eth_call` reads (round state, balance checks, totalSupply). Do NOT import Ponder.

### src/db.ts specification

```typescript
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
    console.log("DB connected:", row.current_database);
    process.exit(0);
  }).catch((e) => { console.error(e); process.exit(1); });
}
```

### src/constants.ts specification

```typescript
// Chain
export const CHAIN_ID = 4663 as const;
export const RPC_URL = process.env.PONDER_RPC_URL_4663 ?? "https://rpc.mainnet.chain.robinhood.com";
export const WAD = 1_000_000_000_000_000_000n;  // 1e18

// SLVR Token
export const SLVR_TOKEN  = "0x791229E3EbD6CFdC3D8157f48722684173C29aD9" as const;
export const SLVR_CAP    = 500_000n * WAD;  // 500,000 SLVR in raw units

// Grid Lottery
export const LOTTERY_V1  = "0x284Eb4016305Fa7FbC162Fb68F27227271001c7f" as const;
export const LOTTERY_V2  = "0xB0Cc994Ce4E8fb106da9Eb36e26fDd8C5f1e0c71" as const;
export const LOTTERY_V2_DEPLOY_BLOCK = 16_764_101n;

// Migration
export const MIGRATION_ROUND = 12_500n;

// Circulating supply exclusions — non-circulating SLVR wallets
export const EXCLUDED_ADDRESSES = [
  { address: "0xFAfcBd4D09C096Eb06Aa2256C7A65CEAB2db39F5", label: "Team Vesting" },
  { address: "0x1A1633FDB2f19082099A6AD6C3d4F1Ec6BCE9729", label: "Growth Fund" },
  { address: "0x4444479B89b684e79392924B3A70BE03733190dE", label: "Growth Recipient" },
] as const;

// Audit-only (not subtracted from circulating supply; logged to metadata)
export const AUDIT_ADDRESSES = [
  { address: "0x11111972FE1b7e52D36609bCaF8702c65b025B46", label: "Protocol Deployer" },
] as const;

// APR window
export const APR_WINDOW_SECONDS = 604_800;  // 7 days
export const SECONDS_PER_YEAR   = 31_536_000;

// Snapshot cron intervals (ms)
export const VITALS_INTERVAL_MS = 60_000;        // 60 seconds
export const HISTORY_INTERVAL_MS = 600_000;      // 10 minutes
```

### db/migrations/003_metric_snapshots.sql specification

```sql
-- Phase 3: metric_snapshots table
-- Owned by the metrics job; raw event tables are owned by Ponder.
-- Run once: psql -p 5433 slvrline -f db/migrations/003_metric_snapshots.sql

CREATE TABLE IF NOT EXISTS metric_snapshots (
  id              BIGSERIAL PRIMARY KEY,
  metric_name     TEXT        NOT NULL,
  value           NUMERIC     NOT NULL,
  value2          NUMERIC,
  value3          NUMERIC,
  metadata        JSONB,
  snapshot_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  block_number    BIGINT      NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_metric_snapshots_name_time
  ON metric_snapshots (metric_name, snapshot_at DESC);

CREATE INDEX IF NOT EXISTS idx_metric_snapshots_block
  ON metric_snapshots (block_number DESC);

COMMENT ON TABLE metric_snapshots IS
  'Append-only time-series of computed protocol metrics. Written by app/metrics/ cron job. '
  'Read by API layer. Raw bigint values stored as NUMERIC; SLVR amounts stored as human units '
  '(divided by 1e18) in value/value2/value3. Full inputs stored in metadata JSONB.';
```

---

## Plan 02 — Formula Implementations (APR, Supply, Runway, Staking)

**What:** Implement the four formula modules under `app/metrics/src/formulas/`. Each exports
a single async function that queries the database and returns a structured result object. No
snapshot writes here — just pure computation.

**Depends on:** Plan 01 (db.ts and constants.ts must exist; metric_snapshots table must exist)
**Wave:** 2

**Files created:**
- `app/metrics/src/formulas/apr.ts`
- `app/metrics/src/formulas/supply.ts`
- `app/metrics/src/formulas/runway.ts`
- `app/metrics/src/formulas/staking.ts`

### apr.ts — computeDividendsApr(asOfTime?: Date)

```typescript
// Returns:
// {
//   apr: number | null,          // decimal, e.g. 12.29 = 1229%. null if insufficient data.
//   deltaIndex: bigint,          // raw Δ minerIndex
//   indexNow: bigint,
//   index7dAgo: bigint,
//   blockNow: bigint,
//   block7dAgo: bigint,
//   windowSeconds: number,
//   contractVersion: "v1" | "v2",
//   dataStatus: "ok" | "insufficient_v2_data" | "no_events",
// }
```

Logic:
1. `asOfTime = asOfTime ?? new Date()` (enables historical backfill)
2. Determine contract: if `asOfTime` is after V2 deploy block time, use V2. Otherwise use V1.
   For V2: query `dividend_index_update WHERE contract_address = LOWER(LOTTERY_V2) AND
   block_time <= EXTRACT(EPOCH FROM $asOfTime) ORDER BY block_number DESC LIMIT 1` → `indexNow`.
3. Compute `windowStart = asOfTime - 7 days` in epoch seconds.
4. Query earliest event at or after windowStart: `WHERE block_time >= $windowStart AND block_time
   <= EXTRACT(EPOCH FROM $asOfTime) ORDER BY block_number ASC LIMIT 1` → `index7dAgo`.
5. If either query returns no rows, return `{ apr: null, dataStatus: "insufficient_v2_data" }`.
6. `deltaIndex = indexNow - index7dAgo`. If deltaIndex <= 0, return `apr = 0`.
7. APR = `Number(deltaIndex) / Number(WAD) * (SECONDS_PER_YEAR / APR_WINDOW_SECONDS)`.
   (Converting to Number here is safe because we're computing a ratio — precision loss is in the
   10th decimal place of a percentage, not in a SLVR amount.)
8. Return full result object.

**IMPORTANT — division order for V1/V2 split:**
When `asOfTime` is before V2's first `MinerIndexUpdated` event (not just before V2 deploy), use
V1 for the query. V2 may have been deployed but had no index updates yet. Check V2 first; fall
back to V1 only if V2 has no rows in the window.

### supply.ts — computeSupply(asOfTime?: Date, viemClient: PublicClient)

```typescript
// Returns:
// {
//   totalSupplyRaw: bigint,
//   burnedRaw: bigint,
//   excludedRaw: bigint,
//   circulatingRaw: bigint,
//   circulatingHuman: number,        // / 1e18
//   totalHuman: number,
//   burnedHuman: number,
//   excludedBalances: Record<string, bigint>,  // per excluded address
//   onChainCirculatingRaw: bigint | null,  // from getCirculatingSupply() — cross-check
//   permanentLockedNote: string,   // explanation that permanent locks are burned (in totalSupply already)
//   deployerBalance: bigint,        // audit only, not subtracted
// }
```

Logic:
1. `totalSupplyRaw = await viemClient.readContract({ address: SLVR_TOKEN, abi: slvrAbi, functionName: "totalSupply" })` — live eth_call at snapshot time. This is the ground truth; do not compute from events.
2. `burnedRaw = await sql("SELECT SUM(amount) FROM token_burn WHERE block_time <= $1", [epochOf(asOfTime)])` — canonical burn source (TokensBurned events, as established in Phase 1).
3. For each address in `EXCLUDED_ADDRESSES`: `eth_call balanceOf(addr)` → sum = `excludedRaw`.
4. `circulatingRaw = totalSupplyRaw - excludedRaw`.
   (Burns are already reflected in `totalSupplyRaw` — do not subtract `burnedRaw` again. The
   `burnedRaw` field is stored for display purposes only, not subtracted from circulating supply.)
5. Also call `getCirculatingSupply()` on the SLVR token contract (RESEARCH.md §1e) for
   cross-check. Store in `onChainCirculatingRaw`. Log divergence to metadata if > 0.1%.
6. Fetch deployer balance for audit: `eth_call balanceOf(deployerAddr)`.

**Critical note on permanent locks:** Permanently locked SLVR is BURNED (RESEARCH.md §5).
It is therefore already absent from `totalSupply()`. Do NOT subtract permanent lock amounts
again — that would double-subtract.

**Note on `burnedRaw` in the output:** The formula above means:
- `totalSupplyRaw` = what is currently in existence (burns already removed by the ERC20 mechanism)
- `burnedRaw` = historical record of how much was ever destroyed (displayed on the supply chart)
- `circulatingRaw` = in-existence minus team/growth wallets

### runway.ts — computeRunway(asOfTime?: Date)

```typescript
// Returns:
// {
//   remainingCapRaw: bigint,
//   totalEmittedRaw: bigint,
//   rate30dRaw: bigint,            // SLVR emitted in last 30 days (raw)
//   runwayMonths: number | null,   // null if rate30d == 0
//   hubConfiguredRatePerSec: bigint | null,  // from hub_emission_rate (latest)
//   dataStatus: "ok" | "no_emissions_in_30d",
// }
```

Logic:
1. `totalEmittedRaw = await sql("SELECT SUM(value) FROM token_transfer WHERE is_mint=true AND block_time <= $1", [epochOf(asOfTime)])`.
2. `remainingCapRaw = SLVR_CAP - totalEmittedRaw`.
3. `thirtyDaysAgo = epochOf(asOfTime) - 30 * 24 * 3600`.
   `rate30dRaw = await sql("SELECT SUM(value) FROM token_transfer WHERE is_mint=true AND block_time >= $1 AND block_time <= $2", [thirtyDaysAgo, epochOf(asOfTime)])`.
4. If `rate30dRaw == 0n`, return `{ runwayMonths: null, dataStatus: "no_emissions_in_30d" }`.
5. `runwayMonths = Number(remainingCapRaw) / Number(rate30dRaw) * (30 / 365 * 12)`.
   Simplified: `runwayMonths = (remainingCapHuman / rate30dHuman) * (30 / 30.44)` — months
   remaining at the 30-day rate. The annualized months = `(remainingCap / rate30d) * 1` since
   `rate30d` is already per-30-days and we want months. Correct formula:
   `runwayMonths = Number(remainingCapRaw * 1n) / Number(rate30dRaw)`.
   (No 12 factor: remainingCap / (SLVR per 30 days) = months remaining. Exact.)
6. Fetch most recent `hub_emission_rate.ratePerSec` for audit log.

### staking.ts — computeStaking(asOfTime?: Date)

```typescript
// Returns:
// {
//   totalLockedRaw: bigint,     // ve_lock total (permanent + timelocked) — in raw SLVR
//   timelockedRaw: bigint,      // active time locks only
//   permanentRaw: bigint,       // permanent locks only (burned from supply)
//   activeLockCount: number,
//   lpTotalNote: string,        // "LP staking holds LP tokens (not raw SLVR) — excluded from total"
// }
```

Logic:
```sql
SELECT
  SUM(current_amount) FILTER (WHERE is_active = true)             AS total_locked,
  SUM(current_amount) FILTER (WHERE is_active = true AND is_permanent = false) AS timelocked,
  SUM(current_amount) FILTER (WHERE is_active = true AND is_permanent = true)  AS permanent,
  COUNT(*)            FILTER (WHERE is_active = true)             AS active_lock_count
FROM ve_lock;
-- time filter for backfill: AND created_block <= (SELECT MAX(block_number) FROM token_transfer WHERE block_time <= $asOfTime)
```

**Do NOT sum LP staking into this total.** LP staking positions are LP tokens, not raw SLVR.
The Phase 5 frontend will display LP staked separately. Store the note in the output and in
`metric_snapshots.metadata.lp_note`.

**Time-bounded backfill note:** For historical snapshots, `is_active` must be evaluated as of
`asOfTime`. The `ve_lock` table is a current-state table (mutable) — it reflects TODAY's state.
For historical backfill, use the `ve_lock_event` append-only log to reconstruct state at time T:
```sql
SELECT
  token_id,
  SUM(amount_delta) AS net_amount
FROM ve_lock_event
WHERE block_time <= $asOfTimestamp
GROUP BY token_id
HAVING SUM(amount_delta) > 0;
```
For the live (non-backfill) snapshot, `ve_lock` current-state query is correct and much faster.

---

## Plan 03 — Lottery Round State + Snapshot Runner + Live Cron

**What:** Implement `src/formulas/lottery.ts` (eth_call-based current round state),
`src/snapshot.ts` (DB write helper), and `src/run.ts` (runs all metrics once and writes
snapshots). Add a `src/cron.ts` entry point that loops `run.ts` on the configured interval.

**Depends on:** Plan 02 (all formula modules must exist)
**Wave:** 3

**Files created:**
- `app/metrics/src/formulas/lottery.ts`
- `app/metrics/src/snapshot.ts`
- `app/metrics/src/run.ts`
- `app/metrics/src/cron.ts`

### lottery.ts — computeLotteryRoundState(viemClient: PublicClient)

```typescript
// Returns:
// {
//   roundId: number,
//   activeBetCount: number,
//   jackpotEth: number,
//   jackpotWei: bigint,
//   source: "eth_call" | "indexed_fallback",
// }
```

Logic:
1. `roundId = await viemClient.readContract({ address: LOTTERY_V2, abi: lotteryAbi, functionName: "roundId" })` — public getter confirmed in RESEARCH.md §2a.
2. Active bet count from indexed data:
   ```sql
   SELECT COUNT(*) FROM lottery_bet
   WHERE contract_address = LOWER(LOTTERY_V2)
     AND round_id = $roundId
   ```
   Note: `lottery_bet` stores bets placed; a round is "active" before `lottery_round` has a
   matching `is_canonical=true` row for this roundId. The count may be 0 if no bets yet in the
   round — that is valid.
3. Jackpot: attempt `eth_call` to a jackpot getter on V2 (verify getter name from ABI at
   implementation time — likely `jackpotBalance()` or `currentJackpot()`). If no getter, log
   `source = "indexed_fallback"` and compute from `v2_sync` reserve changes as fallback
   (document fallback logic in code comments). Store `jackpotWei` as bigint, `jackpotEth` as
   `Number(jackpotWei) / 1e18`.
4. Verify round count: confirm `roundId` is within one round of the latest `lottery_round.round_id
   WHERE is_canonical=true` in the DB. If divergence > 1, log a warning — indexer may be lagging.

### snapshot.ts — writeSnapshot(...)

```typescript
export async function writeSnapshot(params: {
  metricName: string;
  value: number | null;
  value2?: number | null;
  value3?: number | null;
  metadata?: Record<string, unknown>;
  snapshotAt?: Date;
  blockNumber: bigint;
}): Promise<void>
```

Implementation:
```sql
INSERT INTO metric_snapshots (metric_name, value, value2, value3, metadata, snapshot_at, block_number)
VALUES ($metricName, $value, $value2, $value3, $metadata::jsonb, $snapshotAt, $blockNumber)
-- Do NOT use ON CONFLICT DO NOTHING here — we WANT every run to append a new row.
-- For backfill idempotency, use ON CONFLICT DO NOTHING only in backfill.ts.
```

For backfill mode: accept a `backfill: boolean` param. When true:
```sql
INSERT INTO metric_snapshots (...)
VALUES (...)
ON CONFLICT DO NOTHING   -- idempotent backfill; a unique constraint on (metric_name, snapshot_at) not created,
                         -- but we can add one for backfill safety: see backfill.ts
```

### run.ts — computeAndWrite()

Main orchestrator function. Runs all 6 metric keys in sequence and writes one snapshot row each.
Wraps everything in try/catch per metric — a failure in one metric must not prevent others from writing.

```typescript
export async function computeAndWrite(): Promise<void> {
  const viem = createViemClient(); // from viem, using RPC_URL
  const now = new Date();
  // Get latest indexed block (any indexed table — token_transfer is densest)
  const [{ block_number }] = await sql`
    SELECT MAX(block_number) as block_number FROM token_transfer
  `;
  const latestBlock = BigInt(block_number ?? 0);

  // 1. dividends_apr
  try {
    const apr = await computeDividendsApr(now);
    await writeSnapshot({
      metricName: "dividends_apr",
      value: apr.apr !== null ? apr.apr * 100 : null,  // store as percentage (e.g. 1229.4)
      value2: apr.deltaIndex !== undefined ? Number(apr.deltaIndex) : null,
      metadata: {
        index_now: apr.indexNow?.toString(),
        index_7d_ago: apr.index7dAgo?.toString(),
        window_seconds: APR_WINDOW_SECONDS,
        contract_version: apr.contractVersion,
        block_now: apr.blockNow?.toString(),
        block_7d_ago: apr.block7dAgo?.toString(),
        data_status: apr.dataStatus,
      },
      blockNumber: latestBlock,
    });
  } catch (e) { console.error("[APR]", e); }

  // 2. circulating_supply
  try {
    const supply = await computeSupply(now, viem);
    await writeSnapshot({
      metricName: "circulating_supply",
      value: supply.circulatingHuman,
      value2: supply.totalHuman,
      value3: supply.burnedHuman,
      metadata: {
        total_supply_raw: supply.totalSupplyRaw.toString(),
        burned_raw: supply.burnedRaw.toString(),
        excluded_balances: Object.fromEntries(
          Object.entries(supply.excludedBalances).map(([k, v]) => [k, v.toString()])
        ),
        on_chain_cs_raw: supply.onChainCirculatingRaw?.toString() ?? null,
        deployer_balance: supply.deployerBalance.toString(),
        permanent_locked_note: supply.permanentLockedNote,
      },
      blockNumber: latestBlock,
    });
  } catch (e) { console.error("[SUPPLY]", e); }

  // 3. emission_cumulative
  try {
    const supply = await computeSupply(now, viem); // reuse (or cache above)
    await writeSnapshot({
      metricName: "emission_cumulative",
      value: supply.totalHuman - supply.circulatingHuman, // total emitted approx
      value2: supply.burnedHuman,
      metadata: { .../* from supply computation */ },
      blockNumber: latestBlock,
    });
  } catch (e) { console.error("[EMISSION_CUMULATIVE]", e); }

  // NOTE: To avoid re-fetching supply, restructure run.ts to compute supply once and
  // write both circulating_supply and emission_cumulative from the same result.
  // Implemented as a single computeSupply() call with two writeSnapshot() calls.

  // 4. runway_months
  try {
    const runway = await computeRunway(now);
    await writeSnapshot({
      metricName: "runway_months",
      value: runway.runwayMonths,
      value2: runway.remainingCapRaw !== undefined ? Number(runway.remainingCapRaw) / 1e18 : null,
      value3: runway.rate30dRaw !== undefined ? Number(runway.rate30dRaw) / 1e18 : null,
      metadata: {
        remaining_cap_raw: runway.remainingCapRaw?.toString(),
        total_emitted_raw: runway.totalEmittedRaw?.toString(),
        rate_30d_raw: runway.rate30dRaw?.toString(),
        hub_configured_rate_per_sec: runway.hubConfiguredRatePerSec?.toString() ?? null,
        data_status: runway.dataStatus,
      },
      blockNumber: latestBlock,
    });
  } catch (e) { console.error("[RUNWAY]", e); }

  // 5. total_staked_slvr
  try {
    const staking = await computeStaking(now);
    await writeSnapshot({
      metricName: "total_staked_slvr",
      value: Number(staking.totalLockedRaw) / 1e18,
      value2: Number(staking.timelockedRaw) / 1e18,
      value3: Number(staking.permanentRaw) / 1e18,
      metadata: {
        total_locked_raw: staking.totalLockedRaw.toString(),
        timelocked_raw: staking.timelockedRaw.toString(),
        permanent_raw: staking.permanentRaw.toString(),
        active_lock_count: staking.activeLockCount,
        lp_note: staking.lpTotalNote,
      },
      blockNumber: latestBlock,
    });
  } catch (e) { console.error("[STAKING]", e); }

  // 6. lottery_round_state
  try {
    const lottery = await computeLotteryRoundState(viem);
    await writeSnapshot({
      metricName: "lottery_round_state",
      value: lottery.roundId,
      value2: lottery.activeBetCount,
      value3: lottery.jackpotEth,
      metadata: {
        round_id: lottery.roundId,
        bet_count: lottery.activeBetCount,
        jackpot_wei: lottery.jackpotWei.toString(),
        jackpot_eth: lottery.jackpotEth,
        source: lottery.source,
        called_at: now.toISOString(),
      },
      blockNumber: latestBlock,
    });
  } catch (e) { console.error("[LOTTERY]", e); }
}
```

### cron.ts

```typescript
import { computeAndWrite } from "./run";
import { VITALS_INTERVAL_MS } from "./constants";

async function main() {
  console.log(`[metrics-cron] Starting. Interval: ${VITALS_INTERVAL_MS}ms`);
  while (true) {
    const t0 = Date.now();
    try {
      await computeAndWrite();
      console.log(`[metrics-cron] Snapshot written in ${Date.now() - t0}ms`);
    } catch (e) {
      console.error("[metrics-cron] Uncaught error:", e);
    }
    const elapsed = Date.now() - t0;
    const sleep = Math.max(0, VITALS_INTERVAL_MS - elapsed);
    await new Promise((r) => setTimeout(r, sleep));
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
```

**Acceptance check:**
```bash
cd app/metrics
npm run run-once
# Expected output (within 30s):
#   [metrics-cron] Snapshot written in NNNms
#   OR individual metric errors with all others succeeding

psql -p 5433 slvrline -c "
  SELECT metric_name, value, value2, value3, snapshot_at
  FROM metric_snapshots
  ORDER BY snapshot_at DESC
  LIMIT 10;
"
# Expected: rows for dividends_apr, circulating_supply, runway_months,
#           total_staked_slvr, lottery_round_state

# Verify lottery_round_state is within 1 round of on-chain:
psql -p 5433 slvrline -c "
  SELECT value as round_id_from_snapshot,
         (SELECT MAX(round_id) FROM lottery_round WHERE is_canonical=true) as max_indexed_round
  FROM metric_snapshots
  WHERE metric_name = 'lottery_round_state'
  ORDER BY snapshot_at DESC LIMIT 1;
"
# Expected: round_id_from_snapshot >= max_indexed_round (eth_call is current; indexed may lag)
# Difference should be <= 1
```

---

## Plan 04 — Historical Backfill

**What:** Implement `src/backfill.ts` that walks indexed block history hourly from the earliest
indexed block to now, calling `computeAndWrite()` with `asOfTime` set to each hourly slot.

**Depends on:** Plan 03 (run.ts must exist)
**Wave:** 4

**Files created:**
- `app/metrics/src/backfill.ts`

### backfill.ts specification

```typescript
// Usage: ts-node src/backfill.ts [--from=ISO_DATE] [--to=ISO_DATE]
// Default: --from = earliest token_transfer block_time; --to = NOW()
// Step: 1 hour

async function backfill(fromDate: Date, toDate: Date): Promise<void> {
  // Step through hourly slots
  const slotMs = 60 * 60 * 1000; // 1 hour
  let t = new Date(Math.floor(fromDate.getTime() / slotMs) * slotMs);

  while (t <= toDate) {
    // Find latest block_number at or before t
    const [row] = await sql`
      SELECT block_number
      FROM token_transfer
      WHERE block_time <= ${Math.floor(t.getTime() / 1000)}
      ORDER BY block_number DESC
      LIMIT 1
    `;
    if (!row) { t = new Date(t.getTime() + slotMs); continue; }
    const blockAtT = BigInt(row.block_number);

    // Check if snapshots already exist for this slot (idempotency)
    const [existing] = await sql`
      SELECT id FROM metric_snapshots
      WHERE metric_name = 'dividends_apr'
        AND snapshot_at = ${t}
    `;
    if (existing) {
      // Already backfilled this slot — skip all metrics
      t = new Date(t.getTime() + slotMs);
      continue;
    }

    // Compute and write each metric with asOfTime = t
    // Pass asOfTime to each formula function so queries are time-bounded
    await writeBackfillSnapshot(t, blockAtT);

    console.log(`[backfill] Slot ${t.toISOString()} block=${blockAtT} done`);
    t = new Date(t.getTime() + slotMs);
  }
}
```

`writeBackfillSnapshot(t, blockAtT)`: calls each formula function with `asOfTime = t` and
calls `writeSnapshot(..., snapshotAt: t, blockNumber: blockAtT, backfill: true)`.

For `lottery_round_state` during backfill: the current round cannot be eth_call'd for historical
times. Use the canonical `lottery_round` table to find the latest round resolved at or before `t`:
```sql
SELECT MAX(round_id) as round_id
FROM lottery_round
WHERE is_canonical = true AND block_time <= $epochOfT
```
Store this as the historical round state. `activeBetCount` and jackpot are set to NULL for
historical slots (mark in metadata: `source = "historical_indexed"`).

**Acceptance check:**
```bash
cd app/metrics
npm run backfill
# Expected: prints one line per hour slot; completes within 90 seconds for 15 days of history

psql -p 5433 slvrline -c "
  SELECT
    metric_name,
    COUNT(*) as snapshot_count,
    MIN(snapshot_at) as earliest,
    MAX(snapshot_at) as latest
  FROM metric_snapshots
  GROUP BY metric_name
  ORDER BY metric_name;
"
# Expected: 6 metric_names, each with ~360 rows (15 days × 24 hours),
#           earliest ~2026-07-09 (SLVR deploy), latest ~now
```

---

## Plan 05 — Validation (Cross-Check and Definition-of-Done)

**What:** Run all Phase 3 success-criteria validations. This is primarily an operational
verification plan — curl commands, psql queries, and eth_calls to confirm the computed metrics
meet the ROADMAP requirements.

**Depends on:** Plan 04 (backfill must be complete; live snapshots must be accumulating)
**Wave:** 5 (but may begin immediately after Plan 03 for non-backfill checks)

**Files created:**
- `.planning/phases/phase-3/VALIDATION.md` — record of validation results

### Validation A — Dividends APR within 5% of subgraph (SC1 / SUP cross-reference)

The Goldsky subgraph has NO pre-computed APR field (confirmed in RESEARCH.md §4c and
METHODOLOGY.md §6). Cross-validation uses the INPUT values (minerIndex), not a comparable output:

**Step 1 — Confirm our minerIndex(now) matches eth_call:**
```bash
# eth_call minerIndex() on V2 (selector 0x9806b4d2)
curl -s -X POST https://rpc.mainnet.chain.robinhood.com \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_call","params":[{"to":"0xB0Cc994Ce4E8fb106da9Eb36e26fDd8C5f1e0c71","data":"0x9806b4d2"},"latest"],"id":1}' \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print('minerIndex (hex):', d['result']); print('minerIndex (dec):', int(d['result'],16))"
```

Compare output to the `index_now` field in `metric_snapshots.metadata` for the latest
`dividends_apr` row. They must match within a few blocks of drift.

**Step 2 — Confirm our minerIndex(7d ago) matches subgraph:**
```bash
GOLDSKY="https://api.goldsky.com/api/public/project_clzez5zv7ofvr01vh4e0i2vde/subgraphs/slvr-robinhood/1.7.0/gn"
SEVEN_DAYS_AGO=$(python3 -c "import time; print(int(time.time()) - 604800)")
curl -s -X POST "$GOLDSKY" \
  -H "Content-Type: application/json" \
  -d "{\"query\":\"{ minerIndexUpdateds(first:1 orderBy:blockTimestamp orderDirection:asc where:{blockTimestamp_gte:\\\"$SEVEN_DAYS_AGO\\\"}) { newIndex blockNumber blockTimestamp } }\"}" \
  | python3 -m json.tool
```

Compare `newIndex` from subgraph against `index_7d_ago` from `metric_snapshots.metadata`.
These must match exactly (same event from the same block).

**Step 3 — Compute APR from raw inputs and compare to snapshot:**
If Step 1 and Step 2 pass (inputs match), the APR formula output is deterministic — it WILL be
within 5% of any independently-computed figure using the same inputs. Formally verify:
```python
# Python cross-check (run locally)
index_now = 1789282914952366881   # from eth_call or step 1
index_7d_ago = ???                # from step 2
delta = index_now - index_7d_ago
apr = (delta / 1e18) * (31536000 / 604800)
print(f"APR: {apr * 100:.2f}%")
# Compare to metric_snapshots.value for latest dividends_apr row
```

**Pass condition (SC1):** `|our_value - independently_computed_value| / independently_computed_value < 0.05`.
Since we ARE computing from the same inputs, this should be 0% divergence. If divergence > 0%,
there is a formula bug in `apr.ts`.

### Validation B — Circulating supply verifiable in 5 minutes (SC2)

```bash
# Step 1 — Get totalSupply via eth_call
curl -s -X POST https://rpc.mainnet.chain.robinhood.com \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x791229E3EbD6CFdC3D8157f48722684173C29aD9","data":"0x18160ddd"},"latest"],"id":1}' \
  | python3 -c "import sys,json; d=json.load(sys.stdin); v=int(d['result'],16); print(f'totalSupply: {v} raw = {v/1e18:.4f} SLVR')"

# Step 2 — Get each excluded balance
# Team vesting (0xFAfcBd4D09C096Eb06Aa2256C7A65CEAB2db39F5):
# Use balanceOf(addr) selector 0x70a08231 padded to 32 bytes
PADDED_ADDR="000000000000000000000000FAfcBd4D09C096Eb06Aa2256C7A65CEAB2db39F5"
curl -s -X POST https://rpc.mainnet.chain.robinhood.com \
  -H "Content-Type: application/json" \
  -d "{\"jsonrpc\":\"2.0\",\"method\":\"eth_call\",\"params\":[{\"to\":\"0x791229E3EbD6CFdC3D8157f48722684173C29aD9\",\"data\":\"0x70a08231$PADDED_ADDR\"},\"latest\"],\"id\":1}" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); v=int(d['result'],16); print(f'Team Vesting balance: {v/1e18:.4f} SLVR')"
# Repeat for growth fund and growth recipient

# Step 3 — Manual circulating supply
# circulatingSupply = totalSupply - teamVesting - growthFund - growthRecipient
# Compare to metric_snapshots.value for latest 'circulating_supply' row
# Tolerance: must match exactly (same eth_calls at close timestamps — minor drift expected)

psql -p 5433 slvrline -c "
  SELECT value as circulating_human, value2 as total_human, value3 as burned_human,
         metadata->>'total_supply_raw' as total_raw,
         snapshot_at
  FROM metric_snapshots
  WHERE metric_name = 'circulating_supply'
  ORDER BY snapshot_at DESC LIMIT 1;
"
```

**Pass condition (SC2):** A developer with a Blockscout terminal can reproduce the circulating
supply value using only `eth_call` and the formula documented in METHODOLOGY.md (Phase 1) in
under 5 minutes.

### Validation C — Runway as "~X months" with intermediates (SC3)

```bash
psql -p 5433 slvrline -c "
  SELECT
    value       AS runway_months,
    value2      AS remaining_cap_human,
    value3      AS rate_30d_human,
    metadata->>'remaining_cap_raw' AS remaining_cap_raw,
    metadata->>'rate_30d_raw'      AS rate_30d_raw,
    metadata->>'total_emitted_raw' AS total_emitted_raw,
    snapshot_at
  FROM metric_snapshots
  WHERE metric_name = 'runway_months'
  ORDER BY snapshot_at DESC LIMIT 1;
"
# Pass conditions:
# 1. value (runway_months) is a finite non-null number
# 2. value2 (remaining cap) is < 500,000 and > 0
# 3. value3 (rate_30d) > 0
# 4. metadata contains all intermediate raw values as strings
# 5. runwayMonths = remainingCap / rate30d (verify arithmetic manually)
```

### Validation D — Lottery round state within one round (SC4)

```bash
# eth_call roundId() on V2
curl -s -X POST https://rpc.mainnet.chain.robinhood.com \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_call","params":[{"to":"0xB0Cc994Ce4E8fb106da9Eb36e26fDd8C5f1e0c71","data":"0x9f8a13d7"},"latest"],"id":1}' \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print('roundId (dec):', int(d['result'],16))"
# NOTE: 0x9f8a13d7 = keccak256("roundId()")[0:4] — verify selector from V2 ABI at implementation time

psql -p 5433 slvrline -c "
  SELECT value::int as snapshot_round_id, snapshot_at
  FROM metric_snapshots
  WHERE metric_name = 'lottery_round_state'
  ORDER BY snapshot_at DESC LIMIT 1;
"
# Pass condition: |eth_call_roundId - snapshot_round_id| <= 1
```

### Validation E — Historical snapshot coverage for charts

```sql
-- Confirm all 6 metrics have >=24 hours of hourly history
SELECT
  metric_name,
  COUNT(*) as total_rows,
  COUNT(*) FILTER (WHERE snapshot_at >= NOW() - INTERVAL '24 hours') as last_24h,
  MIN(snapshot_at) as earliest,
  MAX(snapshot_at) as latest
FROM metric_snapshots
GROUP BY metric_name
ORDER BY metric_name;
-- Pass: all metric_names present; last_24h >= 24 (one per hour);
--       earliest <= 2026-07-10 (within 1 day of protocol deploy)
```

---

## Definition of Done (Phase 3 Success Criteria)

| SC | Roadmap Criterion | Validation | Pass Condition |
|----|-------------------|------------|----------------|
| SC1 | SUP-01/DIV-01: APR within 5% of subgraph-derivable value | Validation A | Our APR inputs (minerIndex values) match eth_call and subgraph exactly; formula output is deterministic → 0% divergence; OR if any legitimate divergence, < 5% |
| SC2 | SUP-01: Circulating supply verifiable in 5 minutes | Validation B | Developer can reproduce the value via 3 eth_calls + subtraction using formula documented in METHODOLOGY.md |
| SC3 | SUP-03: Runway shows "~X months" with intermediates | Validation C | `runway_months`, `remaining_cap`, `rate_30d` all present as non-null values with raw intermediates in metadata |
| SC4 | LOT-01: Round state within one round | Validation D | `|eth_call_roundId - snapshot_value| <= 1` |
| SC5 | SUP-02 (chart prerequisite): historical snapshots exist | Validation E | All 6 metric keys have ≥360 historical rows spanning from protocol deploy (~Jul 9) to now |

All five must be checked in `.planning/phases/phase-3/VALIDATION.md` before Phase 3 is marked complete.

---

## prod/cron Note

For local dev: `npm run dev` runs `cron.ts` with 60s interval.
For one-shot: `npm run run-once`.
For prod: the executor should note in `.planning/phases/phase-3/SUMMARY.md` what the production
cron mechanism is (systemd timer, fly.io cron, Railway cron, etc.) — that decision is deferred
to Phase 4/5 deployment planning and does NOT block Phase 3 completion.

---

## Files This Phase Creates

```
app/metrics/package.json
app/metrics/tsconfig.json
app/metrics/src/db.ts
app/metrics/src/constants.ts
app/metrics/src/formulas/apr.ts
app/metrics/src/formulas/supply.ts
app/metrics/src/formulas/runway.ts
app/metrics/src/formulas/staking.ts
app/metrics/src/formulas/lottery.ts
app/metrics/src/snapshot.ts
app/metrics/src/run.ts
app/metrics/src/cron.ts
app/metrics/src/backfill.ts
db/migrations/003_metric_snapshots.sql
.planning/phases/phase-3/VALIDATION.md   (created during Plan 05)
```

Files NOT touched:
- `app/indexer/` — entirely untouched (concurrent executor may be editing it)
- `app/api/` — untouched (Phase 4 scope)
- Any existing planning docs, ROADMAP.md, METHODOLOGY.md

---

## Out of Scope (Phase 3)

- API endpoints serving `metric_snapshots` (Phase 4)
- Frontend chart rendering (Phase 5)
- SLVR price from Dexscreener (Phase 4 — lives in the API proxy, not the metrics job)
- Per-user wallet analytics (v2 requirements)
- LP staking SLVR value in USD (requires price — Phase 4)

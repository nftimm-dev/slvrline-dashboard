# Phase 1: Indexer Foundation — PLAN

**Requirements satisfied:** DATA-01, DATA-02, DIV-01
**Phase goal:** SLVRline independently indexes SLVR protocol history on Robinhood Chain with
correctness guarantees that cannot be retrofitted.

---

## Overview

This plan evolves the working Ponder 0.17 scaffold at `app/indexer/` — it does NOT start fresh.
The scaffold has `ponder.config.ts` (single SLVR token contract, placeholder startBlock),
`ponder.schema.ts` (single `transfer_event` table), and `src/index.ts` (one handler). Phase 1
replaces all three with the full production configuration while keeping the process flow, Postgres
connection, and Hono API stub intact.

Execution is sequential. Tasks in Plans 02 and 03 depend on Plan 01's schema. Plan 04
(validation) depends on Plan 03's full backfill completing. Plan 05 (methodology doc) is
independent and may run alongside Plan 04.

```
Plan 01 (schema + config)
    └── Plan 02 (SLVR token + lottery handlers)
            └── Plan 03 (backfill)
                    └── Plan 04 (validation)
Plan 05 (METHODOLOGY.md) — parallel with 04
```

---

## Critical Facts from RESEARCH.md (executor must read these before writing any code)

| Item | Value |
|------|-------|
| SLVR token address | `0x791229E3EbD6CFdC3D8157f48722684173C29aD9` |
| SLVR deploy block | **5,574,774** |
| GridLotteryV1 address | `0x284Eb4016305Fa7FbC162Fb68F27227271001c7f` |
| GridLotteryV1 startBlock | **5,649,104** |
| GridLotteryV1 endBlock (optimization) | **17,440,150** (its last-ever RoundResolved) |
| GridLotteryV2 address | `0xB0Cc994Ce4E8fb106da9Eb36e26fDd8C5f1e0c71` |
| GridLotteryV2 startBlock | **16,764,101** |
| MIGRATION_ROUND | **12,500** — V1 canonical for round < 12,500, V2 canonical for round ≥ 12,500 |
| Parallel-round overlap | Rounds 12,370–13,122 resolved on BOTH contracts (~740 rounds) — **not a bug** |
| WAD | `1e18` (BigInt `1_000_000_000_000_000_000n`) |
| Chain id | 4663 |
| Postgres | `postgresql://timwilliams@localhost:5433/slvrline` |

---

## Risks and Gotchas (executor must keep these in mind throughout)

1. **Parallel-round trap**: Both contracts emit `RoundResolved` for rounds 12,370–13,122. Do NOT
   deduplicate by round_id alone. Store all rows keyed by `(contract_address, round_id)`. Mark
   `is_canonical` by the round-number rule. The raw overlap (740 rounds) is expected audit data.

2. **Emissions double-count trap**: A mint emits `Transfer(from=0x0, to, value)` AND the Hub may
   emit `RewardMinted`. Index emissions as `Transfer where from == address(0)` on the token only.
   Never also count Hub `RewardMinted` for the same amount — that double-counts.

3. **Burns double-count trap**: A burn emits both `Transfer(from, to=0x0, value)` AND
   `TokensBurned(account, amount, newTotalSupply)`. The schema has a dedicated `token_burn` table
   for `TokensBurned`. Do NOT also flag `is_burn=true` on the `token_transfer` row for the same
   event — that would double the burn total. Use `token_burn` as the canonical burn source;
   `token_transfer.is_burn` is an informational flag only, not to be summed independently.

4. **BigInt everywhere**: All `uint256` ABI values arrive as JS `bigint`. Store as Ponder
   `bigint()` columns (maps to Postgres `NUMERIC`). Never call `Number()` on a token amount.
   The `squares` field in `BetPlaced` is `uint8[]` — store as `t.json()` (an array of numbers
   fits in JSON; Postgres `JSONB` is fine).

5. **Single-RPC rate limits**: The backfill spans ~18.4M blocks across three contracts. Ponder
   batches `eth_getLogs` automatically. If you observe 429 errors, add the slvr.fun fallback RPC
   to `.env.local`: `PONDER_RPC_URL_4663=https://rpc.mainnet.chain.robinhood.com,https://slvr.fun/api/rpc`
   (Ponder 0.17 accepts a comma-separated list for fallback transport).

6. **Idempotency**: Every Ponder handler must use `.onConflictDoNothing()`. Ponder re-plays
   events on crash/restart; duplicate inserts must silently no-op.

7. **ABI files**: Copy from `.planning/phases/phase-1/abis/` into `app/indexer/abis/` and create
   TypeScript re-export files alongside each (same pattern as the existing `SlvrToken.ts`).
   Both `GridLotteryV1.json` and `GridLotteryV2.json` have identical event surfaces; a single
   shared `GridLotteryAbi` constant is correct — do NOT create separate V1 and V2 ABIs.

8. **MinerIndexUpdated has no indexed parameter**: All three fields (`newIndex`, `totalUnclaimed`,
   `totalRefined`) are in `event.args`, not topics. This is correct per the ABI — just access
   them normally.

9. **RoundResolved `singleMinerWinner`**: This field is `address indexed`. When no single winner
   exists it is `address(0)`. Store as nullable hex or store `0x0000…` and handle in queries.

---

## Plan 01 — Schema + Config Overhaul

**What:** Replace the placeholder `ponder.config.ts` and `ponder.schema.ts` with the full
production schema and three-contract configuration. Copy ABI files.

**Wave:** 1 (no upstream dependency)

### Files modified
- `app/indexer/ponder.config.ts` — full rewrite
- `app/indexer/ponder.schema.ts` — full rewrite
- `app/indexer/abis/GridLotteryV1.json` — copy from `.planning/phases/phase-1/abis/`
- `app/indexer/abis/GridLotteryV2.json` — copy from `.planning/phases/phase-1/abis/`
- `app/indexer/abis/GridLottery.ts` — new TypeScript ABI re-export (shared for V1+V2)
- `app/indexer/abis/SlvrToken.ts` — update to also export `SlvrTokenAbi` (already exists, verify)

### ponder.config.ts specification

```typescript
// ponder.config.ts — full production configuration
import { createConfig } from "ponder";
import { SlvrTokenAbi } from "./abis/SlvrToken";
import { GridLotteryAbi } from "./abis/GridLottery";

export default createConfig({
  database: {
    kind: "postgres",
    connectionString: process.env.DATABASE_URL,
  },
  chains: {
    robinhoodChain: {
      id: 4663,
      rpc: process.env.PONDER_RPC_URL_4663 ?? "https://rpc.mainnet.chain.robinhood.com",
    },
  },
  contracts: {
    SlvrToken: {
      abi: SlvrTokenAbi,
      chain: "robinhoodChain",
      address: "0x791229E3EbD6CFdC3D8157f48722684173C29aD9",
      startBlock: 5_574_774,
      // No endBlock — index to head for live supply tracking
    },
    GridLotteryV1: {
      abi: GridLotteryAbi,
      chain: "robinhoodChain",
      address: "0x284Eb4016305Fa7FbC162Fb68F27227271001c7f",
      startBlock: 5_649_104,
      endBlock: 17_440_150,  // last-ever RoundResolved on V1 (optimization only, NOT the canonical boundary)
    },
    GridLotteryV2: {
      abi: GridLotteryAbi,
      chain: "robinhoodChain",
      address: "0xB0Cc994Ce4E8fb106da9Eb36e26fDd8C5f1e0c71",
      startBlock: 16_764_101,
      // No endBlock — active contract
    },
  },
});
```

NOTE: V1 and V2 block ranges overlap (16,764,101–17,440,150). This is intentional and correct —
both contracts were live in parallel during that window. Attribution is handled by round number in
the handler, not by block range.

### ponder.schema.ts specification

Define 8 tables. All amounts are `bigint()`. All composite PKs use `primaryKey()`. Table names
are snake_case strings matching the proposed table names in RESEARCH.md.

```typescript
import { onchainTable, primaryKey } from "ponder";

// ── SLVR Token ──────────────────────────────────────────────────────────────

export const tokenTransfer = onchainTable(
  "token_transfer",
  (t) => ({
    chainId:         t.integer().notNull(),           // 4663
    contractAddress: t.hex().notNull(),
    txHash:          t.hex().notNull(),
    logIndex:        t.integer().notNull(),
    blockNumber:     t.bigint().notNull(),
    blockTime:       t.integer().notNull(),            // unix seconds
    fromAddr:        t.hex().notNull(),
    toAddr:          t.hex().notNull(),
    value:           t.bigint().notNull(),             // raw 18-decimal units
    isMint:          t.boolean().notNull(),            // fromAddr == address(0)
    isBurn:          t.boolean().notNull(),            // toAddr == address(0) — informational only, NOT summed for burn total
  }),
  (t) => ({ pk: primaryKey({ columns: [t.chainId, t.contractAddress, t.txHash, t.logIndex] }) })
);

export const tokenBurn = onchainTable(
  "token_burn",
  (t) => ({
    chainId:         t.integer().notNull(),
    contractAddress: t.hex().notNull(),
    txHash:          t.hex().notNull(),
    logIndex:        t.integer().notNull(),
    blockNumber:     t.bigint().notNull(),
    blockTime:       t.integer().notNull(),
    account:         t.hex().notNull(),
    amount:          t.bigint().notNull(),
    newTotalSupply:  t.bigint().notNull(),
  }),
  (t) => ({ pk: primaryKey({ columns: [t.chainId, t.contractAddress, t.txHash, t.logIndex] }) })
);

export const tokenTax = onchainTable(
  "token_tax",
  (t) => ({
    chainId:         t.integer().notNull(),
    contractAddress: t.hex().notNull(),
    txHash:          t.hex().notNull(),
    logIndex:        t.integer().notNull(),
    blockNumber:     t.bigint().notNull(),
    blockTime:       t.integer().notNull(),
    fromAddr:        t.hex().notNull(),
    amount:          t.bigint().notNull(),
    taxRateBps:      t.integer().notNull(),
    isBuy:           t.boolean().notNull(),
  }),
  (t) => ({ pk: primaryKey({ columns: [t.chainId, t.contractAddress, t.txHash, t.logIndex] }) })
);

// ── Grid Lottery ─────────────────────────────────────────────────────────────

export const lotteryBet = onchainTable(
  "lottery_bet",
  (t) => ({
    chainId:         t.integer().notNull(),
    contractAddress: t.hex().notNull(),
    txHash:          t.hex().notNull(),
    logIndex:        t.integer().notNull(),
    blockNumber:     t.bigint().notNull(),
    blockTime:       t.integer().notNull(),
    roundId:         t.bigint().notNull(),
    beneficiary:     t.hex().notNull(),
    total:           t.bigint().notNull(),             // ETH wagered (raw wei)
    squares:         t.json().notNull(),               // uint8[] — JSON array of square indices
  }),
  (t) => ({ pk: primaryKey({ columns: [t.chainId, t.contractAddress, t.txHash, t.logIndex] }) })
);

// NOTE: PK is (chainId, contractAddress, roundId) — NOT just roundId.
// This intentionally stores both V1 and V2 rows for overlap rounds (12,370–13,122).
// is_canonical flags which is authoritative: V1 for round < 12,500, V2 for round >= 12,500.
export const lotteryRound = onchainTable(
  "lottery_round",
  (t) => ({
    chainId:            t.integer().notNull(),
    contractAddress:    t.hex().notNull(),
    roundId:            t.bigint().notNull(),
    resolvedTxHash:     t.hex().notNull(),
    resolvedLogIndex:   t.integer().notNull(),
    blockNumber:        t.bigint().notNull(),
    blockTime:          t.integer().notNull(),
    winningSquare:      t.integer().notNull(),
    jackpotHit:         t.boolean().notNull(),
    singleMinerRound:   t.boolean().notNull(),
    singleMinerWinner:  t.hex(),                      // nullable — address(0) when none
    winnerTotal:        t.bigint().notNull(),          // ETH
    potForWinners:      t.bigint().notNull(),          // ETH
    slvrForWinners:     t.bigint().notNull(),          // SLVR raw
    totalUnclaimedSlvr: t.bigint().notNull(),          // SLVR raw
    isCanonical:        t.boolean().notNull(),         // true when attribution rule matches
  }),
  (t) => ({ pk: primaryKey({ columns: [t.chainId, t.contractAddress, t.roundId] }) })
);

export const lotteryClaim = onchainTable(
  "lottery_claim",
  (t) => ({
    chainId:         t.integer().notNull(),
    contractAddress: t.hex().notNull(),
    txHash:          t.hex().notNull(),
    logIndex:        t.integer().notNull(),
    blockNumber:     t.bigint().notNull(),
    blockTime:       t.integer().notNull(),
    roundId:         t.bigint().notNull(),             // 0 = withdrawUnrefinedSlvr (no specific round)
    user:            t.hex().notNull(),
    nativeOut:       t.bigint().notNull(),             // ETH
    slvrOut:         t.bigint().notNull(),
    refinedOut:      t.bigint().notNull(),
    refiningFee:     t.bigint().notNull(),
  }),
  (t) => ({ pk: primaryKey({ columns: [t.chainId, t.contractAddress, t.txHash, t.logIndex] }) })
);

export const dividendIndexUpdate = onchainTable(
  "dividend_index_update",
  (t) => ({
    chainId:         t.integer().notNull(),
    contractAddress: t.hex().notNull(),
    txHash:          t.hex().notNull(),
    logIndex:        t.integer().notNull(),
    blockNumber:     t.bigint().notNull(),
    blockTime:       t.integer().notNull(),
    newIndex:        t.bigint().notNull(),             // WAD-scaled (1e18 = 1.0)
    totalUnclaimed:  t.bigint().notNull(),
    totalRefined:    t.bigint().notNull(),
  }),
  (t) => ({ pk: primaryKey({ columns: [t.chainId, t.contractAddress, t.txHash, t.logIndex] }) })
);

export const dividendFeeApplied = onchainTable(
  "dividend_fee_applied",
  (t) => ({
    chainId:         t.integer().notNull(),
    contractAddress: t.hex().notNull(),
    txHash:          t.hex().notNull(),
    logIndex:        t.integer().notNull(),
    blockNumber:     t.bigint().notNull(),
    blockTime:       t.integer().notNull(),
    account:         t.hex().notNull(),
    rewardsSlvr:     t.bigint().notNull(),
    fee:             t.bigint().notNull(),
    newIndex:        t.bigint().notNull(),
    totalUnclaimed:  t.bigint().notNull(),
  }),
  (t) => ({ pk: primaryKey({ columns: [t.chainId, t.contractAddress, t.txHash, t.logIndex] }) })
);
```

Also delete the old `transferEvent` table from `ponder.schema.ts` — it is superseded by
`tokenTransfer`. The old `transfer_event` Postgres table will be dropped automatically when
Ponder restarts with the new schema.

### abis/GridLottery.ts specification

```typescript
// Shared ABI for GridLotteryV1 and GridLotteryV2 (identical event surface)
import GridLotteryAbiJson from "./GridLotteryV1.json";
export const GridLotteryAbi = GridLotteryAbiJson as const;
```

### Acceptance check

```bash
cd app/indexer
npx tsc --noEmit
# Expected: zero TypeScript errors

pnpm ponder codegen
# Expected: regenerates ponder-env.d.ts with all 8 table types + 3 contract event types
# No errors
```

---

## Plan 02 — Event Handlers

**What:** Replace `src/index.ts` with a full implementation of all event handlers for SLVR
token (Transfer, TokensBurned, TaxCollected) and both Grid Lottery contracts (BetPlaced,
RoundResolved, Claimed, MinerIndexUpdated, RefiningFeeApplied).

**Depends on:** Plan 01 (schema and config must be in place for Ponder codegen to succeed)
**Wave:** 2

### Files modified
- `app/indexer/src/index.ts` — full rewrite (all handlers in one file; split into
  `src/handlers/` sub-files if the file exceeds ~300 lines for readability)
- `app/indexer/src/lib/constants.ts` — new file for shared constants

### constants.ts specification

```typescript
export const CHAIN_ID = 4663 as const;
export const MIGRATION_ROUND = 12_500n;                          // bigint for comparison with event.args.roundId
export const V1_ADDRESS = "0x284Eb4016305Fa7FbC162Fb68F27227271001c7f" as const;
export const V2_ADDRESS = "0xB0Cc994Ce4E8fb106da9Eb36e26fDd8C5f1e0c71" as const;
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
```

### Handler logic (precise)

**SlvrToken:Transfer**
```
→ insert into tokenTransfer
   chainId = CHAIN_ID
   contractAddress = event.log.address  (lowercased hex)
   txHash = event.transaction.hash
   logIndex = event.log.logIndex
   blockNumber = event.block.number
   blockTime = Number(event.block.timestamp)
   fromAddr = event.args.from
   toAddr = event.args.to
   value = event.args.value             (bigint, direct from decoded args)
   isMint = (event.args.from === ZERO_ADDRESS)
   isBurn = (event.args.to === ZERO_ADDRESS)
  .onConflictDoNothing()
```

**SlvrToken:TokensBurned**
```
→ insert into tokenBurn
   chainId, contractAddress, txHash, logIndex, blockNumber, blockTime (as above)
   account = event.args.account
   amount = event.args.amount
   newTotalSupply = event.args.newTotalSupply
  .onConflictDoNothing()
```

**SlvrToken:TaxCollected**
```
→ insert into tokenTax
   chainId, contractAddress, txHash, logIndex, blockNumber, blockTime
   fromAddr = event.args.from
   amount = event.args.amount
   taxRateBps = Number(event.args.taxRateBps)   // uint16, safe as number
   isBuy = event.args.isBuy
  .onConflictDoNothing()
```

**GridLotteryV1:BetPlaced AND GridLotteryV2:BetPlaced** (separate `ponder.on` registrations,
identical handler body)
```
→ insert into lotteryBet
   chainId = CHAIN_ID
   contractAddress = event.log.address
   txHash = event.transaction.hash
   logIndex = event.log.logIndex
   blockNumber = event.block.number
   blockTime = Number(event.block.timestamp)
   roundId = event.args.roundId            // bigint
   beneficiary = event.args.beneficiary
   total = event.args.total               // bigint ETH wei
   squares = Array.from(event.args.squares)  // uint8[] → plain number array for JSON
  .onConflictDoNothing()
```

**GridLotteryV1:RoundResolved AND GridLotteryV2:RoundResolved**

isCanonical rule:
- V1 address: `roundId < MIGRATION_ROUND`
- V2 address: `roundId >= MIGRATION_ROUND`

```
const isV1 = event.log.address.toLowerCase() === V1_ADDRESS.toLowerCase();
const isCanonical = isV1
  ? event.args.roundId < MIGRATION_ROUND
  : event.args.roundId >= MIGRATION_ROUND;

// singleMinerWinner: store null when address is 0x0
const winner = event.args.singleMinerWinner === ZERO_ADDRESS
  ? null
  : event.args.singleMinerWinner;

→ insert into lotteryRound
   chainId = CHAIN_ID
   contractAddress = event.log.address
   roundId = event.args.roundId
   resolvedTxHash = event.transaction.hash
   resolvedLogIndex = event.log.logIndex
   blockNumber = event.block.number
   blockTime = Number(event.block.timestamp)
   winningSquare = Number(event.args.winningSquare)
   jackpotHit = event.args.jackpotHit
   singleMinerRound = event.args.singleMinerRound
   singleMinerWinner = winner
   winnerTotal = event.args.winnerTotal
   potForWinners = event.args.potForWinners
   slvrForWinners = event.args.slvrForWinners
   totalUnclaimedSlvr = event.args.totalUnclaimedSlvr
   isCanonical = isCanonical
  .onConflictDoNothing()
```

**GridLotteryV1:Claimed AND GridLotteryV2:Claimed**
```
→ insert into lotteryClaim
   chainId, contractAddress, txHash, logIndex, blockNumber, blockTime
   roundId = event.args.roundId    // 0 = withdrawUnrefinedSlvr
   user = event.args.user
   nativeOut = event.args.nativeOut
   slvrOut = event.args.slvrOut
   refinedOut = event.args.refinedOut
   refiningFee = event.args.refiningFee
  .onConflictDoNothing()
```

**GridLotteryV1:MinerIndexUpdated AND GridLotteryV2:MinerIndexUpdated**
```
→ insert into dividendIndexUpdate
   chainId, contractAddress, txHash, logIndex, blockNumber, blockTime
   newIndex = event.args.newIndex
   totalUnclaimed = event.args.totalUnclaimed
   totalRefined = event.args.totalRefined
  .onConflictDoNothing()
```

**GridLotteryV1:RefiningFeeApplied AND GridLotteryV2:RefiningFeeApplied**
```
→ insert into dividendFeeApplied
   chainId, contractAddress, txHash, logIndex, blockNumber, blockTime
   account = event.args.account
   rewardsSlvr = event.args.rewardsSlvr
   fee = event.args.fee
   newIndex = event.args.newIndex
   totalUnclaimed = event.args.totalUnclaimed
  .onConflictDoNothing()
```

### Acceptance check

```bash
cd app/indexer
npx tsc --noEmit
# Expected: zero TypeScript errors

# Start Postgres if not running:
/opt/homebrew/opt/postgresql@18/bin/pg_ctl -D $(git rev-parse --show-toplevel)/.pgdata -o "-p 5433" -l $(git rev-parse --show-toplevel)/.pgdata/logfile start

pnpm ponder dev
# Expected log lines within 60s:
#   "Created database tables count=8 tables=[token_transfer, token_burn, ...]"
#   "Started backfill indexing chain=robinhoodChain"
# Let it run for ~2 minutes, then Ctrl+C

psql -p 5433 slvrline -c "SELECT COUNT(*) FROM token_transfer;"
# Expected: > 0 rows (any transfers in recent blocks confirm handler fires)
```

---

## Plan 03 — Full Backfill

**What:** Run the full production backfill from all three contract deploy blocks to chain head.
This is an operational step — no code changes. The executor starts the indexer and monitors it
until backfill is complete.

**Depends on:** Plan 02 (handlers must be in place)
**Wave:** 3

### Execution steps

1. Ensure Postgres is running:
   ```bash
   /opt/homebrew/opt/postgresql@18/bin/pg_ctl \
     -D $(git rev-parse --show-toplevel)/.pgdata \
     -o "-p 5433" \
     -l $(git rev-parse --show-toplevel)/.pgdata/logfile \
     start 2>/dev/null || true
   psql -p 5433 -c "SELECT 1;" slvrline   # confirm connection
   ```

2. Start the indexer in dev mode (restarts on crash, shows progress):
   ```bash
   cd app/indexer
   pnpm ponder dev
   ```

3. Monitor progress logs. Ponder emits `Updated backfill indexing progress progress=XX%` every 5s.
   Full backfill spans:
   - SlvrToken: blocks 5,574,774 → ~18.4M (~12.8M blocks)
   - GridLotteryV1: blocks 5,649,104 → 17,440,150 (~11.8M blocks)
   - GridLotteryV2: blocks 16,764,101 → ~18.4M (~1.6M blocks)

   At ~500 blocks/batch and conservative RPC rate: expect 2–6 hours. Ponder resumes
   automatically from checkpoint if interrupted — just restart with `pnpm ponder dev`.

4. **If 429 rate-limit errors appear** in the Ponder log, add the fallback RPC:
   ```bash
   # Add to app/indexer/.env.local:
   PONDER_RPC_URL_4663=https://rpc.mainnet.chain.robinhood.com,https://slvr.fun/api/rpc
   # Restart ponder dev
   ```

5. Backfill is complete when the log shows `Realtime sync: chain=robinhoodChain` and
   progress stops changing (indexer is at chain head).

### Acceptance check (run after backfill reaches head)

```sql
-- Connect: psql -p 5433 slvrline

-- (a) Canonical round count — must match expected range
SELECT COUNT(*) as canonical_rounds
FROM lottery_round
WHERE is_canonical = true;
-- Expected: approximately (V1 rounds 0..12499) + (V2 rounds 12500..latest)
-- With V2 at round ~14,224 at research time: expect ~14,225 canonical rounds
-- (round numbering starts at 0; adjust if rounds start at 1)

-- (b) Zero canonical rounds from the wrong contract
SELECT round_id, contract_address, is_canonical
FROM lottery_round
WHERE is_canonical = true
  AND (
    (contract_address = LOWER('0x284Eb4016305Fa7FbC162Fb68F27227271001c7f') AND round_id >= 12500)
    OR
    (contract_address = LOWER('0xB0Cc994Ce4E8fb106da9Eb36e26fDd8C5f1e0c71') AND round_id < 12500)
  )
LIMIT 10;
-- Expected: 0 rows (if any rows appear, the is_canonical logic is wrong)

-- (c) Overlap is understood: exactly ~740 round_ids appear on BOTH contracts
SELECT COUNT(*) as overlap_round_count
FROM (
  SELECT round_id
  FROM lottery_round
  GROUP BY round_id
  HAVING COUNT(DISTINCT contract_address) = 2
) sub;
-- Expected: approximately 740 (rounds 12,370–13,122)

-- (d) Monotonic canonical sequence — no gaps in round numbers 0 → max
SELECT COUNT(DISTINCT round_id) as distinct_canonical_rounds,
       MIN(round_id) as first_round,
       MAX(round_id) as last_round
FROM lottery_round
WHERE is_canonical = true;
-- Expected: distinct_canonical_rounds == last_round - first_round + 1 (no gaps)
-- i.e., every integer from first_round to last_round must appear exactly once canonical

-- (e) Token transfer totals by type
SELECT
  SUM(CASE WHEN is_mint THEN value ELSE 0 END) as total_emitted_raw,
  SUM(CASE WHEN is_burn THEN value ELSE 0 END) as total_burned_via_transfer,
  COUNT(*) as total_transfers
FROM token_transfer;

SELECT SUM(amount) as total_burned_canonical
FROM token_burn;
-- total_burned_via_transfer and total_burned_canonical should be equal or very close
-- (TokensBurned fires alongside the Transfer-to-zero; both represent the same burn)

-- (f) Dividend index rows exist on V2 (the live contract)
SELECT COUNT(*) as miner_index_updates_v2
FROM dividend_index_update
WHERE contract_address = LOWER('0xB0Cc994Ce4E8fb106da9Eb36e26fDd8C5f1e0c71');
-- Expected: > 0
```

---

## Plan 04 — Validation and Cross-Check

**What:** Run the required success-criteria validations: canonical round completeness, idempotency
test, numeric precision cross-check against the Goldsky subgraph.

**Depends on:** Plan 03 (backfill must be complete)
**Wave:** 4

### Validation A: Canonical round completeness (SC1)

Already shown in Plan 03 acceptance checks above. Run all five queries. All must pass.

Additional gap-detection query:
```sql
-- Find any gap in the canonical round sequence
WITH rounds AS (
  SELECT round_id::bigint AS r
  FROM lottery_round
  WHERE is_canonical = true
  ORDER BY round_id
),
gaps AS (
  SELECT r, LAG(r) OVER (ORDER BY r) AS prev_r
  FROM rounds
)
SELECT prev_r + 1 AS gap_start, r - 1 AS gap_end, r - prev_r - 1 AS missing_count
FROM gaps
WHERE r - prev_r > 1;
-- Expected: 0 rows (no gaps in canonical sequence)
```

### Validation B: Idempotency (SC2)

Ponder's `onConflictDoNothing` guarantees this, but verify with a manual double-backfill test:

```bash
# Record current row counts
psql -p 5433 slvrline -c "
  SELECT
    (SELECT COUNT(*) FROM token_transfer) as transfers,
    (SELECT COUNT(*) FROM token_burn) as burns,
    (SELECT COUNT(*) FROM lottery_round) as rounds,
    (SELECT COUNT(*) FROM lottery_bet) as bets,
    (SELECT COUNT(*) FROM lottery_claim) as claims;
" > /tmp/counts_before.txt

# Stop ponder, then restart it (it will re-replay recent blocks from checkpoint)
# Wait ~60 seconds for re-processing, then check counts again
psql -p 5433 slvrline -c "
  SELECT
    (SELECT COUNT(*) FROM token_transfer) as transfers,
    (SELECT COUNT(*) FROM token_burn) as burns,
    (SELECT COUNT(*) FROM lottery_round) as rounds,
    (SELECT COUNT(*) FROM lottery_bet) as bets,
    (SELECT COUNT(*) FROM lottery_claim) as claims;
" > /tmp/counts_after.txt

diff /tmp/counts_before.txt /tmp/counts_after.txt
# Expected: no difference (identical row counts)
```

### Validation C: Numeric precision cross-check (SC3)

Cross-check total token transfers against the Goldsky subgraph. The subgraph tracks
`totalSlvrMinted` and `totalBurnedSlvr` on a `ProtocolStat` entity.

```bash
# Goldsky subgraph endpoint
GOLDSKY_URL="https://api.goldsky.com/api/public/project_clzez5zv7ofvr01vh4e0i2vde/subgraphs/slvr-robinhood/1.7.0/gn"

# Query subgraph for aggregate stats
curl -s -X POST "$GOLDSKY_URL" \
  -H "Content-Type: application/json" \
  -d '{"query":"{ protocolStats(first:1) { totalSlvrMinted totalBurnedSlvr totalRounds } }"}' \
  | python3 -m json.tool
```

Compare against:
```sql
-- Our total minted (Transfer from 0x0)
SELECT SUM(value)::text as total_minted_raw
FROM token_transfer
WHERE is_mint = true;

-- Our total burned (TokensBurned canonical source)
SELECT SUM(amount)::text as total_burned_raw
FROM token_burn;
```

Convert subgraph values (they are 18-decimal strings) and compare. Tolerance: within 1%
(minor difference expected due to indexing lag at query time). If divergence > 1%, investigate
specific blocks where counts differ.

```bash
# Also cross-check canonical round count vs subgraph totalRounds
# Subgraph totalRounds at research time: 14,229
# Our canonical round count should match (both count deduped logical rounds)
psql -p 5433 slvrline -c "SELECT COUNT(*) FROM lottery_round WHERE is_canonical = true;"
```

### Validation D: Dividend index sanity check

Verify the dividend index time series exists and is plausible:

```sql
-- Most recent MinerIndexUpdated on V2 (should match eth_call minerIndex())
SELECT new_index::text, total_unclaimed::text, block_number, block_time
FROM dividend_index_update
WHERE contract_address = LOWER('0xB0Cc994Ce4E8fb106da9Eb36e26fDd8C5f1e0c71')
ORDER BY block_number DESC
LIMIT 1;
-- Expected: new_index ≈ 1789282914952366881 (from RESEARCH.md, will be higher by now)

-- Index is monotonically non-decreasing (it only goes up)
SELECT COUNT(*) as non_monotonic_count
FROM (
  SELECT new_index,
         LAG(new_index) OVER (PARTITION BY contract_address ORDER BY block_number, log_index) AS prev_index
  FROM dividend_index_update
) sub
WHERE new_index < prev_index;
-- Expected: 0 (the accumulator never decreases)
```

### Acceptance check summary

All of the following must be true before Phase 1 is declared done:

- [ ] `SELECT COUNT(*) FROM lottery_round WHERE is_canonical = true` returns a continuous
  sequence with no gaps (gap query returns 0 rows)
- [ ] Zero rows from the "wrong contract" canonical check
- [ ] Overlap count ≈ 740 rows
- [ ] Idempotency: row counts identical before and after Ponder restart
- [ ] Total minted within 1% of Goldsky `totalSlvrMinted`
- [ ] Total burned within 1% of Goldsky `totalBurnedSlvr`
- [ ] Canonical round count within 5% of Goldsky `totalRounds`
- [ ] Dividend index is monotonically non-decreasing on V2

---

## Plan 05 — METHODOLOGY.md (DIV-01)

**What:** Create `app/indexer/METHODOLOGY.md` documenting the Dividends APR formula derived
in RESEARCH.md. This is the deliverable for requirement DIV-01. This plan is independent of
Plans 03/04 and may run in parallel with the backfill.

**Depends on:** Nothing (documentation task, no code dependency)
**Wave:** 4 (can run while Plan 03 backfill is in progress)

### File to create

`app/indexer/METHODOLOGY.md`

### Required content

The document must include all of the following sections:

**1. Dividends APR Formula (Primary — index-delta method)**

```
APR = ( minerIndex(t) − minerIndex(t − W) ) / 1e18 × ( 31,536,000 / W )
```

where:
- `minerIndex(t)` = most recent `MinerIndexUpdated.newIndex` from `dividend_index_update` table
  (contract V2: `0xB0Cc994Ce4E8fb106da9Eb36e26fDd8C5f1e0c71`; or live `eth_call` selector `0x9806b4d2`)
- `minerIndex(t − W)` = earliest `MinerIndexUpdated.newIndex` with `block_time >= t − W`
- `W = 604,800` (7 days in seconds)
- `WAD = 1e18` (BigInt: `1_000_000_000_000_000_000n`)
- Window label: **"Dividends APR (7-day)"**

**2. What minerIndex represents**

The `minerIndex` is the global cumulative refining fee per 1 unclaimed SLVR (WAD-scaled),
implemented as a MasterChef/ORE-style scaled accumulator in the Grid Lottery contract's
`_processClaimWithRefining` function. `Δindex/WAD` is the exact fractional return earned by a
continuously-unclaimed miner over the window — no separate denominator snapshot is needed.

**3. What funds dividends**

When any miner claims their SLVR reward:
- A 10% refining fee is skimmed (`REFINING_FEE_BPS = 1000`)
- The fee is redistributed to all OTHER miners who still hold unclaimed SLVR
- The redistribution increments `minerIndex` by `refiningFee × WAD / totalUnclaimed`
- Events: `MinerIndexUpdated` (index change) and `RefiningFeeApplied` (per-claimer fee)
- Source: Grid Lottery V2 contract `0xB0Cc994Ce4E8fb106da9Eb36e26fDd8C5f1e0c71`
  (same mechanics in V1 `0x284Eb4016305Fa7FbC162Fb68F27227271001c7f`)

**4. Numerator and denominator**

- Numerator: `minerIndex(now) − minerIndex(now − 7d)` — the per-unit accumulation over the window
- Denominator: implicitly 1 unclaimed SLVR (the index is already normalized per unit via WAD)
- Annualization: multiply by `31,536,000 / 604,800 ≈ 52.18` (52.18 weeks per year)

**5. Worked numeric example (2026-07-24)**

- `minerIndex(now)` = `1,789,282,914,952,366,881` (WAD: ~1.789)
- `minerIndex(7d ago)` = `1,553,721,446,508,952,???` (from earliest indexed event in 7-day window)
- Δindex ≈ `235,561,468,443,414,???` → period return ≈ 23.56% over 7 days
- **APR ≈ 23.56% × 52.18 ≈ 1,229%** (7-day annualized)

**6. Cross-check method (flow method)**

Sanity check (upper bound, not the headline):
```
APR_flow ≈ ( SUM(dividend_fee_applied.fee) over W ) / avg(totalUnclaimed) × ( 31,536,000 / W )
```
The index-delta method is authoritative. The flow method produces a higher number because it
ignores pool churn — report it as a cross-check only.

**7. Caveat: early/high magnitude**

The protocol was deployed ~15 days before this methodology was written. The 7-day window at
the time of first computation spans mostly V1 history. **The APR formula is mechanically exact,
but the current level (>1,000%) reflects early/volatile protocol conditions.** Re-validate
magnitude in Phase 3 once ≥7 full days of V2 `MinerIndexUpdated` data have accumulated.
Display with an annotation such as: "Early data — magnitude to be re-validated (Phase 3)."

**8. V1 vs V2 index continuity**

V2 started its `minerIndex` accumulator fresh (from 0) at deployment block 16,764,101. For the
live headline APR, use V2's index exclusively (from `dividend_index_update WHERE contract_address = V2_ADDRESS`). For a historical chart spanning the migration, treat V1 and V2 as separate
accumulators and display a discontinuity annotation at round 12,500 / block ~16,881,792.

**9. What this formula does NOT include**

- Protocol emissions (new SLVR minted per round) — these go to winners, not dividend recipients
- veSLVR staker ETH rewards — these come from the Hub's ETH routing, not the lottery accumulator
- Buy/sell tax — this routes to the ETH jackpot, not dividends

### Acceptance check

```bash
ls -la app/indexer/METHODOLOGY.md
# Expected: file exists, > 1KB
grep "minerIndex" app/indexer/METHODOLOGY.md | wc -l
# Expected: > 5 mentions (formula is present)
grep "1,229" app/indexer/METHODOLOGY.md
# Expected: at least one line (worked example is present)
grep "caveat\|early\|re-validate\|Phase 3" app/indexer/METHODOLOGY.md -i | wc -l
# Expected: > 0 (magnitude caveat is present)
```

---

## Definition of Done (Phase 1 Success Criteria)

| SC | Criterion | Verification |
|----|-----------|-------------|
| SC1 | Canonical round view: exactly one resolved record per round 0→latest, no gaps, no dupes | Gap query returns 0 rows; canonical-from-wrong-contract query returns 0 rows; distinct canonical rounds == max_round - min_round + 1 |
| SC2 | Double-backfill returns identical row counts | diff /tmp/counts_before.txt /tmp/counts_after.txt shows no changes |
| SC3 | Total transfers (NUMERIC) within 1% of Goldsky subgraph totalSlvrMinted | curl Goldsky + psql SUM comparison |
| SC4 | Dividends APR formula documented with contracts, events, annualization window, and magnitude caveat | METHODOLOGY.md exists and passes grep checks |

All four criteria must be met before Phase 1 is marked complete.

---

## Files This Phase Creates or Modifies

```
app/indexer/ponder.config.ts          MODIFIED — full production config
app/indexer/ponder.schema.ts          MODIFIED — 8 tables replacing 1-table placeholder
app/indexer/src/index.ts              MODIFIED — 11 event handlers
app/indexer/src/lib/constants.ts      CREATED — CHAIN_ID, MIGRATION_ROUND, addresses
app/indexer/abis/GridLotteryV1.json   CREATED — copied from .planning/phases/phase-1/abis/
app/indexer/abis/GridLotteryV2.json   CREATED — copied from .planning/phases/phase-1/abis/
app/indexer/abis/GridLottery.ts       CREATED — TypeScript re-export of shared ABI
app/indexer/METHODOLOGY.md            CREATED — DIV-01 deliverable
```

Files NOT touched:
- `app/indexer/package.json` — no new dependencies needed
- `app/indexer/.env.local` — unchanged (may have fallback RPC appended during Plan 03 if rate-limited)
- `app/indexer/src/api/index.ts` — unchanged (Hono stub stays)
- `app/indexer/tsconfig.json` — unchanged

---

## Out of Scope (Phase 1)

- Displaying APR on any UI (DIV-02 — Phase 5)
- APR cron computation writing to metric_snapshots (Phase 3)
- veSLVR, LP staking, Hub, DEX pool indexing (Phase 2)
- Any Next.js/frontend work
- Hosting/deployment

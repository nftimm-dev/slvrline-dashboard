# Phase 2: Full Contract Coverage — PLAN

**Requirements satisfied:** STK-01, STK-02, LOT-02
**Phase goal:** Every production contract contributing to staking, DEX liquidity, and historical
lottery data is indexed in the same Ponder app at `app/indexer/`, ready for the Phase 3 metrics
layer to read without any further indexing work.

---

## Confirmed StartBlocks (looked up 2026-07-24 via Blockscout tx receipts)

| Contract | Address | startBlock | Source |
|----------|---------|-----------|--------|
| `SlvrVoteEscrow` (veSLVR NFT) | `0xd9b8FBD61033145c5496132153CE675756313B71` | **5,574,784** | RESEARCH.md + Blockscout tx `0x0111cc2a…` confirms block 5,574,784 |
| `SlvrVoteEscrowStaking` | `0xaF68598eBd245DC3cB92FF16E9Ba1814DD137200` | **5,574,808** | RESEARCH.md + Blockscout tx `0x13daa759…` confirms block 5,574,808 |
| `SlvrLiquidityStaking` (LP staking) | `0x7D888f4Ca88Fc3578aEfc45C82482Bd66415DfeA` | **5,574,869** | RESEARCH.md + Blockscout tx `0x0a9bae54…` confirms block 5,574,869 |
| `SlvrHub` | `0x55FC0daaB486E46fBF1d60787420c0311d9Dd57f` | **5,574,804** | RESEARCH.md §4 + Blockscout tx `0x8aace961…` |
| `UniswapV2Pair` (SLVR/WETH) | `0xe365b92239097Ed3322131411DbE15a5c4068eff` | **5,574,866** | RESEARCH.md §7 + Blockscout tx `0x228990af…` |
| `UniswapV4PoolManager` | `0x8366a39cc670b4001a1121b8f6a443a643e40951` | **9,070** | Blockscout tx `0x4fb28d49…` confirms block 9,070 |

New ABIs confirmed saved to `.planning/phases/phase-1/abis/`:
- `SlvrVoteEscrow.json` — 14 events; relevant: LockCreated, LockIncreased, LockExtended, LockWithdrawn, LockConvertedToPermanent
- `SlvrVoteEscrowStaking.json` — 9 events; relevant: Staked, Unstaked, Checkpoint, RewardDistributed, RewardClaimed
- `SlvrLiquidityStaking.json` — 11 events; relevant: Deposit, Withdraw, RewardDeposited, RewardRateUpdated
- `SlvrHub.json` — 14 events; relevant: RewardMinted, EmissionRateChanged, StakersPaid, StakersDeferred
- `UniswapV2Pair.json` — newly fetched; relevant: Sync, Swap
- `UniswapV4PoolManager.json` — newly fetched from Blockscout (verified); relevant: Initialize, Swap, ModifyLiquidity

---

## Critical Facts (executor must read before writing any code)

### Permanent lock mechanics (STK-01, STK-02)

From RESEARCH.md §5 — verified source:
- `permanent` flag lives on `LockCreated.permanent` (bool, not indexed). `lockEnd == 0` when permanent.
- **Permanent locks BURN the underlying SLVR** — they are removed from `totalSupply()`, NOT held
  in the veNFT contract. Time-locked SLVR IS held in the veNFT contract's balance.
- `LockConvertedToPermanent` emits `(tokenId indexed, permanentTokenId indexed, amount)` — a time
  lock converts to a new permanent tokenId; the old tokenId is burned.
- **There is NO `supply()` getter** on the veNFT contract. Total locked SLVR MUST be computed by
  summing indexed lock amounts from events.
- `LockIncreased` does NOT carry a `permanent` flag. The handler must look up its own
  `ve_lock` table to know if the tokenId is already permanent.

### veSLVR staking weight (STK-01)

From RESEARCH.md §6:
- `Staked.weight` is a voting-weight (amount × time-multiplier), NOT raw SLVR. Do not sum
  `weight` for "SLVR staked in veSLVR staking."
- "SLVR staked in veStaking" requires resolving staked tokenIds to their `ve_lock.amount`
  (one hop into the ve_lock table). This hop is done in the Phase 3 metrics job, not here.
- Index `Staked` / `Unstaked` by tokenId so Phase 3 can join.

### LP staking (SC4)

From RESEARCH.md §7:
- `SlvrLiquidityStaking.totalStaked` is a **clean on-chain getter** — use it as the reconciliation
  reference in the acceptance check (not just a sum of Deposit/Withdraw events).
- The event `Withdraw` carries a `fee` field (early-withdrawal penalty). The handler stores it.

### LOT-02 (historical lottery activity)

LOT-02 is **already satisfied by Phase 1 indexing** of both lottery contracts in full. The
Phase 2 acceptance check simply queries the existing `lottery_bet` and `lottery_round` tables
to confirm continuity across round 12,500.

### SLVR Hub (Phase 2 scope note)

Hub events `RewardMinted` and `EmissionRateChanged` are needed for Phase 3 mining-runway
computation. `StakersPaid` / `StakersDeferred` are needed for the ETH-revenue-to-stakers metric.
Hub indexing is included in Plan 01 of this phase.

### V4 bytes32 pool IDs

Pool IDs are bytes32, NOT addresses. The Ponder handler must filter inside the function body:
```
const SLVR_ETH_POOL  = "0xb7d8f0dc9cd5f756a792e3fb8e5422d40a0ac1ededd735479f3689e883d023b3"
const SLVR_USDG_POOL = "0xd3d9204b35522f142d7283eaffac9dddd2319fe27d5d808a6f201acfa7776f6a"
```
Events from other pools on the same PoolManager must be silently dropped.
The V4 PoolManager ABI has been confirmed: Swap and Initialize both carry `id bytes32 indexed`
as their first parameter. The IndexObject from `event.args.id` is directly comparable.

---

## Risks and Gotchas

1. **No supply() getter on veNFT.** Total staked SLVR = `SUM(ve_lock.current_amount)` across
   active locks. `current_amount` must be updated on each LockIncreased/LockWithdrawn. Do NOT
   call `balanceOf(veNFTcontract)` on the SLVR token — that counts only time-locked SLVR; it
   would miss permanent locks (which are burned and not held there).

2. **Permanent-lock burn accounting.** Permanently locked SLVR is burned from SLVR totalSupply.
   It is NOT "staked" in the traditional sense — the tokens no longer exist. The Phase 3 metrics
   layer distinguishes:
   - `total_timelocked_slvr` = sum of active non-permanent lock amounts
   - `total_permanent_slvr` = sum of permanent lock amounts (burned from supply)
   Both derive from the `ve_lock` table. The `is_permanent` flag on each row supports this split.

3. **LockConvertedToPermanent creates a new tokenId.** The handler must:
   a. Mark the old tokenId as permanently converted (by looking up the old `ve_lock` row, reading
      its amount, and updating `is_permanent = true` with a `permanent_token_id` reference).
   b. Insert a new `ve_lock` row for `permanentTokenId` with `is_permanent = true`.
   Actually, per the ABI: `LockConvertedToPermanent(tokenId indexed, permanentTokenId indexed,
   amount)` — both the old and new tokenId are passed. The old tokenId's NFT is burned (Transfer
   to 0x0). Insert the new permanent lock; mark old as withdrawn/converted.

4. **Double-counting staked SLVR across contracts.** Three sources of SLVR "staked" data:
   - ve_lock table: raw SLVR locked (time + permanent)
   - veStaking: veNFTs staked (tokenIds, resolves to ve_lock.amount)
   - LP staking: LP tokens staked (NOT raw SLVR)
   These are distinct and must NEVER be added together to get "total SLVR staked." Phase 3
   must sum only `ve_lock` amounts for the STK-01 "total SLVR locked" metric.

5. **LockIncreased permanent flag unavailable in event.** The handler must query the current
   state of the lock from the `ve_lock` table to know if the increase is to a permanent lock.
   Use `context.db.find(veLock, { tokenId: event.args.tokenId })` to get the existing row.
   Update `current_amount += addedAmount`. Do NOT blindly recompute `is_permanent` on increase —
   it was set at lock creation or conversion.

6. **V4 PoolManager startBlock is 9,070.** This is very early (before SLVR token at 5,574,774).
   Backfill of PoolManager from block 9,070 will scan ~5.5M blocks with essentially zero SLVR
   events (SLVR pools were created long after). This is wasteful. Use startBlock `5,574,774`
   for the PoolManager (SLVR token deploy block) since no SLVR pool can exist before the token.
   Actually, V4 Initialize for a SLVR pool cannot precede the SLVR token. Use startBlock
   `5,574,866` (V2 pair deploy, approximately when DEX activity began) as a safe lower bound.

7. **V4 Swap amounts are int128 (signed).** `amount0` and `amount1` are `int128` — negative
   means the pool paid out that token. Store as `bigint` in Ponder (it handles signed). The schema
   column type is `bigint()` and negative values are valid.

8. **Hub `RewardMinted` vs token `Transfer` double-count.** Hub's `RewardMinted` and token
   `Transfer(from=0x0)` represent the same mint event. Per Phase 1 conventions, canonical
   emissions are indexed from token `Transfer` (already done in Phase 1). Hub `RewardMinted` is
   stored in `hub_reward_minted` for per-game attribution but must NOT be summed alongside
   token transfers for total emission.

9. **V2 pair token order.** `reserve0` is for the lexicographically smaller address between SLVR
   and WETH. Confirm token order via `token0()` call on the pair contract, or from the first
   Sync event. Phase 3 metrics need to know which reserve is SLVR to compute price correctly.
   Store both reserves as indexed; label in comments for Phase 3.

---

## Plans

Plans are executed sequentially (each depends on the prior). No parallel execution in Phase 2
because all plans modify `ponder.config.ts` and `ponder.schema.ts` as a single atomic update.
The backfill (Plan 03) is operational, not a code task.

```
Plan 01 (schema + config additions)
    └── Plan 02 (staking + DEX + hub handlers)
            └── Plan 03 (backfill Phase 2 contracts)
                    └── Plan 04 (validation: staking totals + LOT-02 continuity + V4 pool)
```

---

## Plan 01 — Schema Additions + Config Expansion

**What:** Extend `ponder.config.ts` with 6 new contracts and extend `ponder.schema.ts` with 9
new tables. Copy the two new ABIs from `.planning/phases/phase-1/abis/` into `app/indexer/abis/`.
Do NOT edit any existing tables — only additive changes.

**Depends on:** Phase 1 Plan 01 (the existing schema/config must already be in place)
**Wave:** 1

### Files modified

- `app/indexer/ponder.config.ts` — add 6 new contracts (additive only)
- `app/indexer/ponder.schema.ts` — add 9 new tables (additive only)
- `app/indexer/abis/UniswapV2Pair.json` — copy from `.planning/phases/phase-1/abis/`
- `app/indexer/abis/UniswapV2Pair.ts` — TypeScript re-export
- `app/indexer/abis/UniswapV4PoolManager.json` — copy from `.planning/phases/phase-1/abis/`
- `app/indexer/abis/UniswapV4PoolManager.ts` — TypeScript re-export
- `app/indexer/abis/SlvrVoteEscrow.ts` — TypeScript re-export (JSON already exists from Phase 1)
- `app/indexer/abis/SlvrVoteEscrowStaking.ts` — TypeScript re-export
- `app/indexer/abis/SlvrLiquidityStaking.ts` — TypeScript re-export
- `app/indexer/abis/SlvrHub.ts` — TypeScript re-export
- `app/indexer/src/lib/constants.ts` — add new constants (additive)

### ponder.config.ts additions

Add these 6 contracts inside the existing `contracts: { ... }` block. Do NOT remove or change
any existing contract entry.

```typescript
// --- Phase 2 additions ---
import { SlvrVoteEscrowAbi } from "./abis/SlvrVoteEscrow";
import { SlvrVoteEscrowStakingAbi } from "./abis/SlvrVoteEscrowStaking";
import { SlvrLiquidityStakingAbi } from "./abis/SlvrLiquidityStaking";
import { SlvrHubAbi } from "./abis/SlvrHub";
import { UniswapV2PairAbi } from "./abis/UniswapV2Pair";
import { UniswapV4PoolManagerAbi } from "./abis/UniswapV4PoolManager";

// ...inside contracts: { ... }

SlvrVoteEscrow: {
  abi: SlvrVoteEscrowAbi,
  chain: "robinhoodChain",
  address: "0xd9b8FBD61033145c5496132153CE675756313B71",
  startBlock: 5_574_784,
},
SlvrVoteEscrowStaking: {
  abi: SlvrVoteEscrowStakingAbi,
  chain: "robinhoodChain",
  address: "0xaF68598eBd245DC3cB92FF16E9Ba1814DD137200",
  startBlock: 5_574_808,
},
SlvrLiquidityStaking: {
  abi: SlvrLiquidityStakingAbi,
  chain: "robinhoodChain",
  address: "0x7D888f4Ca88Fc3578aEfc45C82482Bd66415DfeA",
  startBlock: 5_574_869,
},
SlvrHub: {
  abi: SlvrHubAbi,
  chain: "robinhoodChain",
  address: "0x55FC0daaB486E46fBF1d60787420c0311d9Dd57f",
  startBlock: 5_574_804,
},
UniswapV2Pair: {
  abi: UniswapV2PairAbi,
  chain: "robinhoodChain",
  address: "0xe365b92239097Ed3322131411DbE15a5c4068eff",
  startBlock: 5_574_866,
},
UniswapV4PoolManager: {
  abi: UniswapV4PoolManagerAbi,
  chain: "robinhoodChain",
  address: "0x8366a39cc670b4001a1121b8f6a443a643e40951",
  startBlock: 5_574_866,  // Use V2 pair block (not PoolManager deploy 9,070)
                           // No SLVR pool can exist before the SLVR token (5,574,774);
                           // using 5,574,866 avoids scanning ~5.5M empty blocks.
},
```

### constants.ts additions

Append to `app/indexer/src/lib/constants.ts` (do not remove existing constants):

```typescript
// --- Phase 2 additions ---

// veSLVR Vote Escrow NFT
export const VESLVR_NFT_ADDRESS    = "0xd9b8FBD61033145c5496132153CE675756313B71" as const;
// veSLVR Staking
export const VESLVR_STAKING_ADDRESS = "0xaF68598eBd245DC3cB92FF16E9Ba1814DD137200" as const;
// LP Staking
export const LP_STAKING_ADDRESS    = "0x7D888f4Ca88Fc3578aEfc45C82482Bd66415DfeA" as const;
// SLVR Hub
export const HUB_ADDRESS           = "0x55FC0daaB486E46fBF1d60787420c0311d9Dd57f" as const;
// SLVR/WETH V2 Pair
export const V2_PAIR_ADDRESS       = "0xe365b92239097Ed3322131411DbE15a5c4068eff" as const;
// Uniswap V4 PoolManager
export const V4_POOL_MANAGER       = "0x8366a39cc670b4001a1121b8f6a443a643e40951" as const;

// V4 SLVR pool IDs (bytes32, NOT addresses)
export const V4_SLVR_ETH_POOL_ID  = "0xb7d8f0dc9cd5f756a792e3fb8e5422d40a0ac1ededd735479f3689e883d023b3" as const;
export const V4_SLVR_USDG_POOL_ID = "0xd3d9204b35522f142d7283eaffac9dddd2319fe27d5d808a6f201acfa7776f6a" as const;
```

### ponder.schema.ts additions

Add these 9 tables at the bottom of `ponder.schema.ts`. Do NOT modify existing tables.

```typescript
import { onchainTable, primaryKey } from "ponder";

// ── veSLVR Vote Escrow — per-tokenId lock state ──────────────────────────────
// This is a mutable "current state" table, not an append-only event log.
// One row per tokenId; updated in-place on LockIncreased, LockExtended, LockWithdrawn.
export const veLock = onchainTable(
  "ve_lock",
  (t) => ({
    chainId:          t.integer().notNull(),             // 4663
    contractAddress:  t.hex().notNull(),                 // veNFT contract
    tokenId:          t.bigint().notNull(),
    user:             t.hex().notNull(),                 // owner at creation
    currentAmount:    t.bigint().notNull(),              // raw SLVR (updated on increase/withdraw)
    lockEnd:          t.bigint().notNull(),              // 0 if permanent
    isPermanent:      t.boolean().notNull(),             // true = burn path, lockEnd == 0
    isActive:         t.boolean().notNull(),             // false after LockWithdrawn
    permanentTokenId: t.bigint(),                        // if converted: the new permanent tokenId
    createdBlock:     t.bigint().notNull(),
    createdTime:      t.integer().notNull(),
  }),
  (t) => ({ pk: primaryKey({ columns: [t.chainId, t.contractAddress, t.tokenId] }) })
);

// Append-only event log for veSLVR lock lifecycle events (for historical charts)
export const veLockEvent = onchainTable(
  "ve_lock_event",
  (t) => ({
    chainId:         t.integer().notNull(),
    contractAddress: t.hex().notNull(),
    txHash:          t.hex().notNull(),
    logIndex:        t.integer().notNull(),
    blockNumber:     t.bigint().notNull(),
    blockTime:       t.integer().notNull(),
    tokenId:         t.bigint().notNull(),
    eventType:       t.text().notNull(),                 // 'created'|'increased'|'extended'|'withdrawn'|'converted_to_permanent'
    amountDelta:     t.bigint(),                         // positive on create/increase; negative on withdraw; null on extend
    newLockEnd:      t.bigint(),                         // present on created, extended, increased
    isPermanent:     t.boolean(),                        // set on 'created' and 'converted_to_permanent'
    user:            t.hex(),                            // set on 'created' and 'withdrawn'
  }),
  (t) => ({ pk: primaryKey({ columns: [t.chainId, t.contractAddress, t.txHash, t.logIndex] }) })
);

// ── veSLVR Staking — staked veNFT positions ──────────────────────────────────
// One row per staked tokenId; upserted on Staked/Unstaked.
export const veStakePosition = onchainTable(
  "ve_stake_position",
  (t) => ({
    chainId:         t.integer().notNull(),
    contractAddress: t.hex().notNull(),
    tokenId:         t.bigint().notNull(),
    user:            t.hex().notNull(),
    weight:          t.bigint().notNull(),              // voting weight (NOT raw SLVR — see SLVR amount via ve_lock join)
    isStaked:        t.boolean().notNull(),             // false after Unstaked
    stakedBlock:     t.bigint().notNull(),
    stakedTime:      t.integer().notNull(),
    unstakedBlock:   t.bigint(),
  }),
  (t) => ({ pk: primaryKey({ columns: [t.chainId, t.contractAddress, t.tokenId] }) })
);

// ETH revenue distributed to veSLVR stakers (from Hub's StakersPaid events)
export const veStakerRevenue = onchainTable(
  "ve_staker_revenue",
  (t) => ({
    chainId:         t.integer().notNull(),
    contractAddress: t.hex().notNull(),                 // Hub address
    txHash:          t.hex().notNull(),
    logIndex:        t.integer().notNull(),
    blockNumber:     t.bigint().notNull(),
    blockTime:       t.integer().notNull(),
    gameId:          t.bigint().notNull(),
    seq:             t.bigint().notNull(),
    amount:          t.bigint().notNull(),              // ETH in wei
  }),
  (t) => ({ pk: primaryKey({ columns: [t.chainId, t.contractAddress, t.txHash, t.logIndex] }) })
);

// ── LP Staking ───────────────────────────────────────────────────────────────
// One row per user; upserted on Deposit/Withdraw.
export const lpStakePosition = onchainTable(
  "lp_stake_position",
  (t) => ({
    chainId:         t.integer().notNull(),
    contractAddress: t.hex().notNull(),
    user:            t.hex().notNull(),
    currentAmount:   t.bigint().notNull(),              // current LP tokens staked (updated in-place)
    lastEventBlock:  t.bigint().notNull(),
    lastEventTime:   t.integer().notNull(),
  }),
  (t) => ({ pk: primaryKey({ columns: [t.chainId, t.contractAddress, t.user] }) })
);

// Append-only LP staking events (for historical staking chart)
export const lpStakeEvent = onchainTable(
  "lp_stake_event",
  (t) => ({
    chainId:         t.integer().notNull(),
    contractAddress: t.hex().notNull(),
    txHash:          t.hex().notNull(),
    logIndex:        t.integer().notNull(),
    blockNumber:     t.bigint().notNull(),
    blockTime:       t.integer().notNull(),
    user:            t.hex().notNull(),
    eventType:       t.text().notNull(),                // 'deposit' | 'withdraw'
    amount:          t.bigint().notNull(),              // LP token amount (always positive)
    fee:             t.bigint(),                        // early-withdrawal fee (null for deposits)
  }),
  (t) => ({ pk: primaryKey({ columns: [t.chainId, t.contractAddress, t.txHash, t.logIndex] }) })
);

// ── SLVR Hub ─────────────────────────────────────────────────────────────────
// Per-game emission events (supports Phase 3 mining runway and per-round attribution)
export const hubRewardMinted = onchainTable(
  "hub_reward_minted",
  (t) => ({
    chainId:         t.integer().notNull(),
    contractAddress: t.hex().notNull(),
    txHash:          t.hex().notNull(),
    logIndex:        t.integer().notNull(),
    blockNumber:     t.bigint().notNull(),
    blockTime:       t.integer().notNull(),
    gameId:          t.bigint().notNull(),
    to:              t.hex().notNull(),                 // usually the lottery contract
    amount:          t.bigint().notNull(),              // SLVR raw — do NOT sum alongside token_transfer emissions
  }),
  (t) => ({ pk: primaryKey({ columns: [t.chainId, t.contractAddress, t.txHash, t.logIndex] }) })
);

// Hub emission rate changes (support mining runway chart)
export const hubEmissionRate = onchainTable(
  "hub_emission_rate",
  (t) => ({
    chainId:         t.integer().notNull(),
    contractAddress: t.hex().notNull(),
    txHash:          t.hex().notNull(),
    logIndex:        t.integer().notNull(),
    blockNumber:     t.bigint().notNull(),
    blockTime:       t.integer().notNull(),
    ratePerSec:      t.bigint().notNull(),              // SLVR per second (WAD-scaled)
  }),
  (t) => ({ pk: primaryKey({ columns: [t.chainId, t.contractAddress, t.txHash, t.logIndex] }) })
);

// ── DEX — Uniswap V2 SLVR/WETH pair ─────────────────────────────────────────
// Reserve snapshots from Sync events (price and liquidity time series)
export const v2Sync = onchainTable(
  "v2_sync",
  (t) => ({
    chainId:         t.integer().notNull(),
    contractAddress: t.hex().notNull(),                 // V2 pair address
    txHash:          t.hex().notNull(),
    logIndex:        t.integer().notNull(),
    blockNumber:     t.bigint().notNull(),
    blockTime:       t.integer().notNull(),
    reserve0:        t.bigint().notNull(),              // uint112 — token0 reserve (confirm token order via token0())
    reserve1:        t.bigint().notNull(),              // uint112 — token1 reserve
    // NOTE: Determine which is SLVR and which is WETH via token0() call in Phase 3.
    // At research time: pair created by 0x8bcEaA40B9… (not the deployer admin),
    // token order must be confirmed. Store both; Phase 3 reads token order from chain.
  }),
  (t) => ({ pk: primaryKey({ columns: [t.chainId, t.contractAddress, t.txHash, t.logIndex] }) })
);

// ── DEX — Uniswap V4 PoolManager ─────────────────────────────────────────────
// Swap events filtered to the two SLVR pools (bytes32 pool IDs)
export const v4Swap = onchainTable(
  "v4_swap",
  (t) => ({
    chainId:         t.integer().notNull(),
    contractAddress: t.hex().notNull(),                 // PoolManager address
    txHash:          t.hex().notNull(),
    logIndex:        t.integer().notNull(),
    blockNumber:     t.bigint().notNull(),
    blockTime:       t.integer().notNull(),
    poolId:          t.hex().notNull(),                 // bytes32 pool ID (V4_SLVR_ETH_POOL_ID or V4_SLVR_USDG_POOL_ID)
    sender:          t.hex().notNull(),
    amount0:         t.bigint().notNull(),              // int128 — signed; negative = pool paid out token0
    amount1:         t.bigint().notNull(),              // int128 — signed
    sqrtPriceX96:    t.bigint().notNull(),              // uint160 — post-swap price (Q64.96 format)
    liquidity:       t.bigint().notNull(),              // uint128
    tick:            t.integer().notNull(),             // int24
    fee:             t.integer().notNull(),             // uint24
  }),
  (t) => ({ pk: primaryKey({ columns: [t.chainId, t.contractAddress, t.txHash, t.logIndex] }) })
);
```

### ABI TypeScript re-export files

Each file follows the same pattern as the Phase 1 `GridLottery.ts`:

`app/indexer/abis/SlvrVoteEscrow.ts`:
```typescript
import SlvrVoteEscrowAbiJson from "./SlvrVoteEscrow.json";
export const SlvrVoteEscrowAbi = SlvrVoteEscrowAbiJson as const;
```

Repeat the same pattern for `SlvrVoteEscrowStaking.ts`, `SlvrLiquidityStaking.ts`,
`SlvrHub.ts`, `UniswapV2Pair.ts`, `UniswapV4PoolManager.ts`.

### Acceptance check

```bash
cd app/indexer
npx tsc --noEmit
# Expected: zero TypeScript errors

pnpm ponder codegen
# Expected: regenerates ponder-env.d.ts with all 17 table types (8 existing + 9 new)
#           and 9 contract event types (3 existing + 6 new)
# No errors
```

---

## Plan 02 — Staking, DEX, and Hub Handlers

**What:** Add event handlers for all 6 new contracts. Handlers are written in new files under
`app/indexer/src/handlers/` (one file per contract group). The main `src/index.ts` gains only
`ponder.on(...)` registrations that delegate to the handler functions.

**Depends on:** Plan 01 (schema + config must be in place, codegen must pass)
**Wave:** 2

### Files modified

- `app/indexer/src/index.ts` — append new `ponder.on(...)` registrations (do NOT remove existing)
- `app/indexer/src/handlers/veEscrow.ts` — NEW file: veSLVR NFT lock handlers
- `app/indexer/src/handlers/veStaking.ts` — NEW file: veSLVR staking handlers
- `app/indexer/src/handlers/lpStaking.ts` — NEW file: LP staking handlers
- `app/indexer/src/handlers/hub.ts` — NEW file: Hub handlers
- `app/indexer/src/handlers/dex.ts` — NEW file: V2 Sync + V4 Swap handlers

### Handler logic — veEscrow.ts

**SlvrVoteEscrow:LockCreated**
```
Insert into veLock (upsert — onConflictDoNothing; lock should be new):
  chainId = CHAIN_ID
  contractAddress = event.log.address
  tokenId = event.args.tokenId          // bigint
  user = event.args.user
  currentAmount = event.args.amount     // bigint SLVR raw
  lockEnd = event.args.permanent ? 0n : event.args.duration
  // NOTE: duration in the event is the lock DURATION (not the end timestamp).
  // Store it as-is; Phase 3 can compute lockEnd = createdTime + duration if needed.
  // Actually: inspect ABI — LockCreated has `duration` not `lockEnd`. Store duration.
  // Update: set lockEnd = 0n if permanent = true; otherwise store the duration value.
  isPermanent = event.args.permanent    // bool from event
  isActive = true
  permanentTokenId = null
  createdBlock = event.block.number
  createdTime = Number(event.block.timestamp)

Insert into veLockEvent:
  eventType = 'created'
  amountDelta = event.args.amount
  newLockEnd = event.args.permanent ? 0n : event.args.duration
  isPermanent = event.args.permanent
  user = event.args.user
  (+ standard chain/tx/log/block fields)
.onConflictDoNothing()
```

**SlvrVoteEscrow:LockIncreased**
```
// Must find existing lock to know isPermanent (event does not carry the flag)
const existing = await context.db.find(veLock, {
  chainId: CHAIN_ID,
  contractAddress: event.log.address,
  tokenId: event.args.tokenId,
});
// If not found: data integrity issue — log a warning and skip.

Update veLock row:
  currentAmount = existing.currentAmount + event.args.addedAmount
  lockEnd = event.args.newLockEnd   // event provides newLockEnd (bigint)
  (isPermanent unchanged from existing row)

Insert into veLockEvent:
  eventType = 'increased'
  amountDelta = event.args.addedAmount
  newLockEnd = event.args.newLockEnd
  isPermanent = existing.isPermanent
.onConflictDoNothing()
```

**SlvrVoteEscrow:LockExtended**
```
Update veLock:
  lockEnd = event.args.newLockEnd

Insert into veLockEvent:
  eventType = 'extended'
  newLockEnd = event.args.newLockEnd
  amountDelta = null
.onConflictDoNothing()
```

**SlvrVoteEscrow:LockWithdrawn**
```
Update veLock:
  currentAmount = 0n
  isActive = false

Insert into veLockEvent:
  eventType = 'withdrawn'
  amountDelta = -existing.currentAmount   // negative: amount leaving
  user = event.args.user
.onConflictDoNothing()
```

**SlvrVoteEscrow:LockConvertedToPermanent**
```
// event.args: { tokenId (old), permanentTokenId (new), amount }
// Old tokenId's NFT is burned (Transfer event fires separately — handled by the generic
// NFT Transfer handler below, not here). We handle the lock conversion here.

// Mark old lock as converted (not simply withdrawn — it became a permanent lock)
Update old veLock row (tokenId = event.args.tokenId):
  isActive = false
  isPermanent = true  // it was converted
  permanentTokenId = event.args.permanentTokenId

// Insert new permanent lock row
Insert into veLock:
  tokenId = event.args.permanentTokenId
  user = (from old lock row: existing.user)
  currentAmount = event.args.amount
  lockEnd = 0n
  isPermanent = true
  isActive = true
  permanentTokenId = null
  createdBlock = event.block.number
  createdTime = Number(event.block.timestamp)

Insert into veLockEvent (two rows, one for old, one for new):
  Row 1: eventType = 'converted_to_permanent', tokenId = old tokenId, amountDelta = null
  Row 2: eventType = 'created', tokenId = permanentTokenId, amountDelta = event.args.amount,
          isPermanent = true
.onConflictDoNothing()
```

### Handler logic — veStaking.ts

**SlvrVoteEscrowStaking:Staked**
```
Upsert into veStakePosition:
  tokenId = event.args.tokenId
  user = event.args.user
  weight = event.args.weight             // bigint — voting weight, NOT SLVR
  isStaked = true
  stakedBlock = event.block.number
  stakedTime = Number(event.block.timestamp)
  unstakedBlock = null
.onConflictDoUpdate({ isStaked: true, weight: event.args.weight, ... })
```

**SlvrVoteEscrowStaking:Unstaked**
```
Update veStakePosition:
  isStaked = false
  unstakedBlock = event.block.number
```

**SlvrVoteEscrowStaking:Checkpoint**
```
Update veStakePosition:
  weight = event.args.newWeight
```

**SlvrVoteEscrowStaking:RewardDistributed** — NOT indexed (veStaker ETH revenue comes from Hub's StakersPaid, not from this event — see hub.ts)

### Handler logic — hub.ts

**SlvrHub:RewardMinted**
```
Insert into hubRewardMinted:
  gameId = event.args.gameId
  to = event.args.to
  amount = event.args.amount             // SLVR — do NOT count toward token_transfer totals
.onConflictDoNothing()
```

**SlvrHub:EmissionRateChanged**
```
Insert into hubEmissionRate:
  ratePerSec = event.args.ratePerSec    // bigint
.onConflictDoNothing()
```

**SlvrHub:StakersPaid**
```
Insert into veStakerRevenue:
  contractAddress = event.log.address   // Hub address
  gameId = event.args.gameId
  seq = event.args.seq
  amount = event.args.amount            // ETH in wei
.onConflictDoNothing()
```

**SlvrHub:StakersDeferred** — NOT indexed (deferred payments are not ETH distribution events;
they indicate the distribution was postponed; Phase 3 can derive deferred amounts from the
difference between StakersPaid cumulative and expected payments).

### Handler logic — lpStaking.ts

**SlvrLiquidityStaking:Deposit**
```
// Upsert lp_stake_position (may be a new user or returning user)
const existing = await context.db.find(lpStakePosition, {
  chainId: CHAIN_ID,
  contractAddress: event.log.address,
  user: event.args.user,
});
const newAmount = (existing?.currentAmount ?? 0n) + event.args.amount;

Upsert into lpStakePosition:
  user = event.args.user
  currentAmount = newAmount
  lastEventBlock = event.block.number
  lastEventTime = Number(event.block.timestamp)

Insert into lpStakeEvent:
  eventType = 'deposit'
  amount = event.args.amount
  fee = null
.onConflictDoNothing()
```

**SlvrLiquidityStaking:Withdraw**
```
const existing = await context.db.find(lpStakePosition, { ... });
const newAmount = (existing?.currentAmount ?? 0n) - event.args.amount;
// newAmount should not go below 0; if it does, log a warning.

Update lpStakePosition:
  currentAmount = newAmount < 0n ? 0n : newAmount
  lastEventBlock = event.block.number
  lastEventTime = Number(event.block.timestamp)

Insert into lpStakeEvent:
  eventType = 'withdraw'
  amount = event.args.amount              // always positive
  fee = event.args.fee                    // early-withdrawal fee
.onConflictDoNothing()
```

### Handler logic — dex.ts

**UniswapV2Pair:Sync**
```
Insert into v2Sync:
  contractAddress = event.log.address
  reserve0 = event.args.reserve0          // uint112 → bigint
  reserve1 = event.args.reserve1
.onConflictDoNothing()
```

**UniswapV4PoolManager:Swap**
```
// Filter to SLVR pools only — all other V4 pools must be silently ignored
if (
  event.args.id !== V4_SLVR_ETH_POOL_ID &&
  event.args.id !== V4_SLVR_USDG_POOL_ID
) {
  return;  // not a SLVR pool — skip
}

Insert into v4Swap:
  poolId = event.args.id                  // bytes32 as hex string
  sender = event.args.sender
  amount0 = event.args.amount0            // int128 → bigint (can be negative)
  amount1 = event.args.amount1            // int128 → bigint (can be negative)
  sqrtPriceX96 = event.args.sqrtPriceX96 // uint160 → bigint
  liquidity = event.args.liquidity        // uint128 → bigint
  tick = Number(event.args.tick)          // int24 → number (safe; range −887,272 to 887,272)
  fee = Number(event.args.fee)            // uint24 → number
.onConflictDoNothing()
```

**UniswapV4PoolManager:Initialize** — Index only SLVR pools; store for pool-ID verification (SC3)
```
// NOTE: Do NOT create a new schema table for this — verify pool IDs exist at startup.
// For SC3, simply confirm that the V4_SLVR_ETH_POOL_ID and V4_SLVR_USDG_POOL_ID
// each have an Initialize event in the historical log. This is a validation check
// in Plan 04, not a handler that stores rows.
// OPTIONALLY: if a v4_pool_init table is desired for the methodology page, add it in
// a future plan. For Phase 2 scope, the handler can log a warning if an unexpected
// SLVR pool Initialize is seen, but does not store anything.
```

### Acceptance check

```bash
cd app/indexer
npx tsc --noEmit
# Expected: zero TypeScript errors

pnpm ponder dev
# Expected log lines within 60s:
#   "Created database tables count=17 tables=[token_transfer, ..., v4_swap, ...]"
#   "Started backfill indexing chain=robinhoodChain"
# Let run for ~5 minutes; check that new tables receive rows
# Ctrl+C

psql -p 5433 slvrline -c "
SELECT
  (SELECT COUNT(*) FROM ve_lock) as ve_locks,
  (SELECT COUNT(*) FROM lp_stake_event) as lp_events,
  (SELECT COUNT(*) FROM hub_reward_minted) as hub_mints,
  (SELECT COUNT(*) FROM v2_sync) as v2_syncs;
"
# Expected: all > 0 within the first 5 minutes of backfill (these contracts have
# been active since block 5,574,xxx — recent blocks should appear quickly)
```

---

## Plan 03 — Full Backfill of Phase 2 Contracts

**What:** Run the Ponder indexer to completion for all 6 new contracts. This is an operational
step — no code changes. The executor monitors progress until all new contracts are at chain head.

**Depends on:** Plan 02 (handlers must be in place and TypeScript-clean)
**Wave:** 3

### Execution steps

1. Confirm Postgres is running:
   ```bash
   psql -p 5433 -c "SELECT 1;" slvrline
   ```

2. Start the indexer:
   ```bash
   cd app/indexer
   pnpm ponder dev
   ```

3. Monitor for the 6 new contracts reaching 100% backfill. Ponder logs
   `Updated backfill indexing progress progress=XX%` per contract. With Phase 1 contracts
   already at head, Phase 2 adds 6 more starting at block ~5.5M. Estimated:
   - SlvrVoteEscrow, veStaking, Hub, V2 pair, LP staking: ~12.8M blocks each from ~5.5M
   - V4 PoolManager: ~12.8M blocks from 5,574,866 (same window)
   Expect 1–4 additional hours on top of Phase 1 completion.

4. Rate-limit mitigation (if 429s appear):
   ```bash
   # Verify fallback RPC is in .env.local already from Phase 1:
   grep PONDER_RPC_URL app/indexer/.env.local
   # If not: add "https://slvr.fun/api/rpc" as fallback (comma-separated)
   ```

5. Backfill complete when all contracts show `Realtime sync`.

### Acceptance check (spot check after 30 minutes)

```sql
-- Spot check: LP staking has events
SELECT COUNT(*) FROM lp_stake_event;  -- expect > 0

-- Spot check: V2 Sync events exist
SELECT COUNT(*) FROM v2_sync;         -- expect > 0

-- Spot check: veNFT locks exist
SELECT COUNT(*) FROM ve_lock;         -- expect > 0

-- Spot check: Hub mints exist
SELECT COUNT(*) FROM hub_reward_minted; -- expect > 0
```

---

## Plan 04 — Validation

**What:** Run all four Phase 2 success-criteria checks and the LOT-02 continuity check.

**Depends on:** Plan 03 (backfill must be complete — all contracts at chain head)
**Wave:** 4

### Validation A: Total SLVR staked vs on-chain reads (SC1 — STK-01)

**Step 1 — Sum indexed lock amounts:**
```sql
SELECT
  SUM(current_amount) FILTER (WHERE is_permanent = false AND is_active = true)
    AS total_timelocked_raw,
  SUM(current_amount) FILTER (WHERE is_permanent = true  AND is_active = true)
    AS total_permanent_raw,
  SUM(current_amount) FILTER (WHERE is_active = true)
    AS total_locked_raw,
  COUNT(*) FILTER (WHERE is_active = true) AS active_lock_count
FROM ve_lock;
```

**Step 2 — Sample 10 specific tokenIds and compare to on-chain:**
```bash
# For each sampled tokenId, call locks(tokenId) on the veNFT contract
# ABI selector for locks(uint256): auto-computable or use cast/viem

# Quick spot-check via Blockscout Read Contract:
# https://robinhoodchain.blockscout.com/address/0xd9b8FBD61033145c5496132153CE675756313B71/read-contract
# Call locks(tokenId) for 3-5 active tokenIds from the query above
# Compare returned .amount to current_amount in ve_lock table

# Tolerance: within 0.01% (SC1 requirement)
# A perfect match is expected unless indexer is significantly behind head
```

**Step 3 — Permanent lock accounting sanity check:**
```sql
-- Total permanently locked SLVR (burned from supply) should be traceable:
SELECT SUM(current_amount) as permanent_locked FROM ve_lock WHERE is_permanent = true AND is_active = true;

-- Cross-check: SLVR held by the veNFT contract (time-locked only, NOT permanent):
-- Query via eth_call: balanceOf(0xd9b8FBD61033145c5496132153CE675756313B71)
-- This should approximate total_timelocked_raw (not total_locked_raw, since permanent
-- locks are BURNED and not held in the contract)
-- Tolerance: within 1% (some lag expected)
```

### Validation B: Historical lottery continuity — bets-per-round (SC2 — LOT-02)

This validation uses the EXISTING Phase 1 tables (no new data needed).

```sql
-- Bets per round across both contracts (canonical attribution)
-- A chart of this series must show no gap at round 12,500
SELECT
  lr.round_id,
  COUNT(lb.tx_hash) as bet_count,
  lr.contract_address,
  lr.is_canonical
FROM lottery_round lr
LEFT JOIN lottery_bet lb ON (
  lb.contract_address = lr.contract_address
  AND lb.round_id = lr.round_id
)
WHERE lr.is_canonical = true
GROUP BY lr.round_id, lr.contract_address, lr.is_canonical
ORDER BY lr.round_id;

-- Check for any rounds with zero bets (possible gap or missing data)
SELECT round_id FROM (
  SELECT
    lr.round_id,
    COUNT(lb.tx_hash) as bet_count
  FROM lottery_round lr
  LEFT JOIN lottery_bet lb ON (
    lb.contract_address = lr.contract_address AND lb.round_id = lr.round_id
  )
  WHERE lr.is_canonical = true
  GROUP BY lr.round_id
) sub
WHERE bet_count = 0
ORDER BY round_id;
-- Expected: zero or very few (single-miner rounds may legitimately have no bets in the
-- lottery_bet table if the miner opened the round — check lottery contract for this edge case)

-- Boundary check: rounds 12,495–12,505 must all have canonical records
SELECT round_id, contract_address, is_canonical, block_number
FROM lottery_round
WHERE round_id BETWEEN 12495 AND 12505
ORDER BY round_id;
-- Expected: rounds 12,495–12,499 from V1 (is_canonical=true), rounds 12,500–12,505 from V2 (is_canonical=true)
-- No gap at the boundary
```

### Validation C: V4 pool IDs verified from Initialize events (SC3)

```sql
-- If you added a v4_pool_init table, query it.
-- Otherwise, verify via eth_getLogs on the PoolManager:

-- Confirm V4_SLVR_ETH_POOL_ID has an Initialize event in the indexed data
-- This requires querying the PoolManager event log via the RPC or Blockscout:

-- Via Blockscout API:
-- GET https://robinhoodchain.blockscout.com/api/v2/addresses/0x8366a39cc670b4001a1121b8f6a443a643e40951/logs?topic=<Initialize topic0>
-- topic0 for Initialize: 0x40e9cecf2e2f02c2a975baca79b7b9dd14db12bdf...
-- (compute from event signature "Initialize(bytes32,address,address,uint24,int24,address,uint160,int24)")

-- Alternative: spot-check v4_swap table for rows with the expected pool IDs
SELECT
  pool_id,
  COUNT(*) as swap_count,
  MIN(block_number) as first_swap_block,
  MAX(block_number) as last_swap_block
FROM v4_swap
WHERE pool_id IN (
  '0xb7d8f0dc9cd5f756a792e3fb8e5422d40a0ac1ededd735479f3689e883d023b3',
  '0xd3d9204b35522f142d7283eaffac9dddd2319fe27d5d808a6f201acfa7776f6a'
)
GROUP BY pool_id;
-- Expected: both pool IDs present with swap_count > 0
-- If only one appears, the other pool may have no swaps yet (not necessarily an error)
-- If neither appears, the startBlock or pool ID filter may be wrong — investigate

-- Also confirm no other pool IDs leaked into v4_swap (the filter should block them)
SELECT DISTINCT pool_id FROM v4_swap WHERE pool_id NOT IN (
  '0xb7d8f0dc9cd5f756a792e3fb8e5422d40a0ac1ededd735479f3689e883d023b3',
  '0xd3d9204b35522f142d7283eaffac9dddd2319fe27d5d808a6f201acfa7776f6a'
);
-- Expected: 0 rows (filter is working)
```

### Validation D: LP staking reconciles vs on-chain totalStaked (SC4)

```sql
-- Sum of all active LP staking positions from indexed events
SELECT SUM(current_amount) AS indexed_total_staked FROM lp_stake_position;

-- Cross-check via eth_call to totalStaked() on LP staking contract:
-- Contract: 0x7D888f4Ca88Fc3578aEfc45C82482Bd66415DfeA
-- Selector for totalStaked(): compute from ABI or call via viem

-- Fetch on-chain totalStaked via curl RPC call:
curl -s -X POST https://rpc.mainnet.chain.robinhood.com \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x7D888f4Ca88Fc3578aEfc45C82482Bd66415DfeA","data":"0x817b1cd2"},"latest"],"id":1}' \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print('totalStaked (hex):', d['result']); print('totalStaked (dec):', int(d['result'],16))"
# Function selector 0x817b1cd2 = keccak256("totalStaked()")[0:4]
# (Verify selector from ABI if this returns an error)

-- Compare: indexed_total_staked should equal on-chain totalStaked within 1%
-- (Minor diff expected if some recent events are not yet indexed)
```

### Full Phase 2 definition of done

| SC | Requirement | Check | Pass Condition |
|----|------------|-------|----------------|
| SC1 | STK-01: total locked SLVR from summed lock amounts | SUM(current_amount) WHERE is_active | Within 0.01% of on-chain sampled locks; permanent lock set is non-overlapping with time-locked set |
| SC1 | STK-02: permanent-vs-decaying breakdown | Count permanent=true vs permanent=false active locks | Permanent locks have lockEnd=0; time locks have lockEnd>0; no row has both |
| SC2 | LOT-02: continuous bets-per-round series | Boundary query rounds 12,495–12,505 | All 11 rounds have is_canonical=true records; V1 for <12,500, V2 for ≥12,500; no gaps |
| SC3 | V4 pool IDs verified | v4_swap pool_id filter | At least one SLVR pool ID present in v4_swap; zero non-SLVR pool IDs in v4_swap |
| SC4 | LP staking total reconciles | SUM(lp_stake_position.current_amount) vs on-chain totalStaked() | Within 1% |

---

## Files This Phase Creates or Modifies

```
app/indexer/ponder.config.ts                     MODIFIED — 6 contracts added
app/indexer/ponder.schema.ts                     MODIFIED — 9 tables added
app/indexer/src/index.ts                         MODIFIED — ponder.on registrations added
app/indexer/src/lib/constants.ts                 MODIFIED — new constants added
app/indexer/src/handlers/veEscrow.ts             CREATED
app/indexer/src/handlers/veStaking.ts            CREATED
app/indexer/src/handlers/lpStaking.ts            CREATED
app/indexer/src/handlers/hub.ts                  CREATED
app/indexer/src/handlers/dex.ts                  CREATED
app/indexer/abis/SlvrVoteEscrow.ts               CREATED (JSON already exists)
app/indexer/abis/SlvrVoteEscrowStaking.ts        CREATED (JSON already exists)
app/indexer/abis/SlvrLiquidityStaking.ts         CREATED (JSON already exists)
app/indexer/abis/SlvrHub.ts                      CREATED (JSON already exists)
app/indexer/abis/UniswapV2Pair.json              CREATED — copy from .planning/phases/phase-1/abis/
app/indexer/abis/UniswapV2Pair.ts                CREATED
app/indexer/abis/UniswapV4PoolManager.json       CREATED — copy from .planning/phases/phase-1/abis/
app/indexer/abis/UniswapV4PoolManager.ts         CREATED
```

Files NOT touched:
- Existing Phase 1 tables and handlers — untouched
- `app/indexer/METHODOLOGY.md` — untouched
- Any Next.js / API / frontend files

---

## Out of Scope (Phase 2)

- Derived metrics computation (Phase 3)
- `metric_snapshots` table (Phase 3)
- APR cron job (Phase 3)
- token order confirmation for V2 pair (Phase 3 — requires one eth_call to `token0()`)
- V4 price conversion from sqrtPriceX96 (Phase 3 — math lives in the metrics layer)
- Permanent lock SLVR circulating-supply subtraction (Phase 3 — circulating supply formula)
- Any API or frontend work
```

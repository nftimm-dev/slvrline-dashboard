import { onchainTable, primaryKey } from "ponder";

// ── SLVR Token ──────────────────────────────────────────────────────────────

export const tokenTransfer = onchainTable(
  "token_transfer",
  (t) => ({
    chainId:         t.integer().notNull(),          // 4663
    contractAddress: t.hex().notNull(),
    txHash:          t.hex().notNull(),
    logIndex:        t.integer().notNull(),
    blockNumber:     t.bigint().notNull(),
    blockTime:       t.integer().notNull(),           // unix seconds
    fromAddr:        t.hex().notNull(),
    toAddr:          t.hex().notNull(),
    value:           t.bigint().notNull(),            // raw 18-decimal units
    isMint:          t.boolean().notNull(),           // fromAddr == address(0)
    isBurn:          t.boolean().notNull(),           // toAddr == address(0) — informational only, NOT summed for burn total
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
    total:           t.bigint().notNull(),            // ETH wagered (raw wei)
    squares:         t.json().notNull(),              // uint8[] — JSON array of square indices
  }),
  (t) => ({ pk: primaryKey({ columns: [t.chainId, t.contractAddress, t.txHash, t.logIndex] }) })
);

// NOTE: PK is (chainId, contractAddress, roundId) — NOT just roundId.
// This intentionally stores both V1 and V2 rows for overlap rounds (12,370–13,122).
// isCanonical flags which is authoritative: V1 for round < 12,500, V2 for round >= 12,500.
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
    singleMinerWinner:  t.hex(),                     // nullable — address(0) when none
    winnerTotal:        t.bigint().notNull(),         // ETH
    potForWinners:      t.bigint().notNull(),         // ETH
    slvrForWinners:     t.bigint().notNull(),         // SLVR raw
    totalUnclaimedSlvr: t.bigint().notNull(),         // SLVR raw
    isCanonical:        t.boolean().notNull(),        // true when attribution rule matches
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
    roundId:         t.bigint().notNull(),            // 0 = withdrawUnrefinedSlvr (no specific round)
    user:            t.hex().notNull(),
    nativeOut:       t.bigint().notNull(),            // ETH
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
    newIndex:        t.bigint().notNull(),            // WAD-scaled (1e18 = 1.0)
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

// ── Phase 2: veSLVR Vote Escrow ───────────────────────────────────────────────

// Per-tokenId lock state (mutable current state, updated in-place)
// One row per tokenId; updated on LockIncreased, LockExtended, LockWithdrawn.
export const veLock = onchainTable(
  "ve_lock",
  (t) => ({
    chainId:          t.integer().notNull(),             // 4663
    contractAddress:  t.hex().notNull(),                 // veNFT contract
    tokenId:          t.bigint().notNull(),
    user:             t.hex().notNull(),                 // owner at creation
    currentAmount:    t.bigint().notNull(),              // raw SLVR (updated on increase/withdraw)
    lockEnd:          t.bigint().notNull(),              // 0 if permanent; duration if time-locked
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

// ── Phase 2: veSLVR Staking ───────────────────────────────────────────────────

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

// ── Phase 2: LP Staking ──────────────────────────────────────────────────────

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

// ── Phase 2: SLVR Hub ────────────────────────────────────────────────────────

// Per-game emission events (supports Phase 3 mining runway and per-round attribution)
// NOTE: Do NOT sum hub_reward_minted.amount alongside token_transfer emissions for total supply.
// Hub RewardMinted and token Transfer(from=0x0) represent the same mint. Use token_transfer for totals.
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

// ── Phase 2: DEX — Uniswap V2 SLVR/WETH pair ────────────────────────────────

// Reserve snapshots from Sync events (price and liquidity time series)
// NOTE: Determine which reserve is SLVR and which is WETH via token0() call in Phase 3.
// Store both reserves; Phase 3 reads token order from chain.
export const v2Sync = onchainTable(
  "v2_sync",
  (t) => ({
    chainId:         t.integer().notNull(),
    contractAddress: t.hex().notNull(),                 // V2 pair address
    txHash:          t.hex().notNull(),
    logIndex:        t.integer().notNull(),
    blockNumber:     t.bigint().notNull(),
    blockTime:       t.integer().notNull(),
    reserve0:        t.bigint().notNull(),              // uint112 — token0 reserve
    reserve1:        t.bigint().notNull(),              // uint112 — token1 reserve
  }),
  (t) => ({ pk: primaryKey({ columns: [t.chainId, t.contractAddress, t.txHash, t.logIndex] }) })
);

// ── Phase 2: DEX — Uniswap V4 PoolManager ───────────────────────────────────

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

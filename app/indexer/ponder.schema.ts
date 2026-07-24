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

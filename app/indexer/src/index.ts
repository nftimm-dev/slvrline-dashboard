import { ponder } from "ponder:registry";
import {
  tokenTransfer,
  tokenBurn,
  tokenTax,
  lotteryBet,
  lotteryRound,
  lotteryClaim,
  dividendIndexUpdate,
  dividendFeeApplied,
} from "ponder:schema";
import {
  CHAIN_ID,
  MIGRATION_ROUND,
  MINER_VAULT_MIGRATION_ROUND,
  V1_ADDRESS,
  V2_ADDRESS,
  V3_ADDRESS,
  ZERO_ADDRESS,
} from "./lib/constants";

function isCanonicalLotteryRound(address: string, roundId: bigint): boolean {
  const normalized = address.toLowerCase();
  if (normalized === V1_ADDRESS.toLowerCase()) return roundId < MIGRATION_ROUND;
  if (normalized === V2_ADDRESS.toLowerCase()) {
    return roundId >= MIGRATION_ROUND && roundId < MINER_VAULT_MIGRATION_ROUND;
  }
  if (normalized === V3_ADDRESS.toLowerCase()) return roundId >= MINER_VAULT_MIGRATION_ROUND;
  return false;
}

// --- Phase 2 handler registrations ---
import "./handlers/veEscrow";
import "./handlers/veStaking";
import "./handlers/lpStaking";
import "./handlers/hub";
import "./handlers/dex";

// ── SLVR Token handlers ───────────────────────────────────────────────────────

ponder.on("SlvrToken:Transfer", async ({ event, context }) => {
  await context.db
    .insert(tokenTransfer)
    .values({
      chainId:         CHAIN_ID,
      contractAddress: event.log.address,
      txHash:          event.transaction.hash,
      logIndex:        event.log.logIndex,
      blockNumber:     event.block.number,
      blockTime:       Number(event.block.timestamp),
      fromAddr:        event.args.from,
      toAddr:          event.args.to,
      value:           event.args.value,
      isMint:          event.args.from === ZERO_ADDRESS,
      isBurn:          event.args.to === ZERO_ADDRESS,
    })
    .onConflictDoNothing();
});

ponder.on("SlvrToken:TokensBurned", async ({ event, context }) => {
  await context.db
    .insert(tokenBurn)
    .values({
      chainId:         CHAIN_ID,
      contractAddress: event.log.address,
      txHash:          event.transaction.hash,
      logIndex:        event.log.logIndex,
      blockNumber:     event.block.number,
      blockTime:       Number(event.block.timestamp),
      account:         event.args.account,
      amount:          event.args.amount,
      newTotalSupply:  event.args.newTotalSupply,
    })
    .onConflictDoNothing();
});

ponder.on("SlvrToken:TaxCollected", async ({ event, context }) => {
  await context.db
    .insert(tokenTax)
    .values({
      chainId:         CHAIN_ID,
      contractAddress: event.log.address,
      txHash:          event.transaction.hash,
      logIndex:        event.log.logIndex,
      blockNumber:     event.block.number,
      blockTime:       Number(event.block.timestamp),
      fromAddr:        event.args.from,
      amount:          event.args.amount,
      taxRateBps:      Number(event.args.taxRateBps), // uint16, safe as number
      isBuy:           event.args.isBuy,
    })
    .onConflictDoNothing();
});

// ── Grid Lottery V1 handlers ──────────────────────────────────────────────────

ponder.on("GridLotteryV1:BetPlaced", async ({ event, context }) => {
  await context.db
    .insert(lotteryBet)
    .values({
      chainId:         CHAIN_ID,
      contractAddress: event.log.address,
      txHash:          event.transaction.hash,
      logIndex:        event.log.logIndex,
      blockNumber:     event.block.number,
      blockTime:       Number(event.block.timestamp),
      roundId:         event.args.roundId,
      beneficiary:     event.args.beneficiary,
      total:           event.args.total,
      squares:         Array.from(event.args.squares), // uint8[] → plain number array for JSON
    })
    .onConflictDoNothing();
});

ponder.on("GridLotteryV1:RoundResolved", async ({ event, context }) => {
  const isCanonical = isCanonicalLotteryRound(event.log.address, event.args.roundId);

  // Store null when singleMinerWinner is address(0)
  const winner =
    event.args.singleMinerWinner === ZERO_ADDRESS
      ? null
      : event.args.singleMinerWinner;

  await context.db
    .insert(lotteryRound)
    .values({
      chainId:            CHAIN_ID,
      contractAddress:    event.log.address,
      roundId:            event.args.roundId,
      resolvedTxHash:     event.transaction.hash,
      resolvedLogIndex:   event.log.logIndex,
      blockNumber:        event.block.number,
      blockTime:          Number(event.block.timestamp),
      winningSquare:      Number(event.args.winningSquare),
      jackpotHit:         event.args.jackpotHit,
      singleMinerRound:   event.args.singleMinerRound,
      singleMinerWinner:  winner,
      winnerTotal:        event.args.winnerTotal,
      potForWinners:      event.args.potForWinners,
      slvrForWinners:     event.args.slvrForWinners,
      totalUnclaimedSlvr: event.args.totalUnclaimedSlvr,
      isCanonical:        isCanonical,
    })
    .onConflictDoNothing();
});

ponder.on("GridLotteryV1:Claimed", async ({ event, context }) => {
  await context.db
    .insert(lotteryClaim)
    .values({
      chainId:         CHAIN_ID,
      contractAddress: event.log.address,
      txHash:          event.transaction.hash,
      logIndex:        event.log.logIndex,
      blockNumber:     event.block.number,
      blockTime:       Number(event.block.timestamp),
      roundId:         event.args.roundId, // 0 = withdrawUnrefinedSlvr
      user:            event.args.user,
      nativeOut:       event.args.nativeOut,
      slvrOut:         event.args.slvrOut,
      refinedOut:      event.args.refinedOut,
      refiningFee:     event.args.refiningFee,
    })
    .onConflictDoNothing();
});

ponder.on("GridLotteryV1:MinerIndexUpdated", async ({ event, context }) => {
  await context.db
    .insert(dividendIndexUpdate)
    .values({
      chainId:         CHAIN_ID,
      contractAddress: event.log.address,
      txHash:          event.transaction.hash,
      logIndex:        event.log.logIndex,
      blockNumber:     event.block.number,
      blockTime:       Number(event.block.timestamp),
      newIndex:        event.args.newIndex,
      totalUnclaimed:  event.args.totalUnclaimed,
      totalRefined:    event.args.totalRefined,
    })
    .onConflictDoNothing();
});

ponder.on("GridLotteryV1:RefiningFeeApplied", async ({ event, context }) => {
  await context.db
    .insert(dividendFeeApplied)
    .values({
      chainId:         CHAIN_ID,
      contractAddress: event.log.address,
      txHash:          event.transaction.hash,
      logIndex:        event.log.logIndex,
      blockNumber:     event.block.number,
      blockTime:       Number(event.block.timestamp),
      account:         event.args.account,
      rewardsSlvr:     event.args.rewardsSlvr,
      fee:             event.args.fee,
      newIndex:        event.args.newIndex,
      totalUnclaimed:  event.args.totalUnclaimed,
    })
    .onConflictDoNothing();
});

// ── Grid Lottery V2 handlers (identical body to V1) ──────────────────────────

ponder.on("GridLotteryV2:BetPlaced", async ({ event, context }) => {
  await context.db
    .insert(lotteryBet)
    .values({
      chainId:         CHAIN_ID,
      contractAddress: event.log.address,
      txHash:          event.transaction.hash,
      logIndex:        event.log.logIndex,
      blockNumber:     event.block.number,
      blockTime:       Number(event.block.timestamp),
      roundId:         event.args.roundId,
      beneficiary:     event.args.beneficiary,
      total:           event.args.total,
      squares:         Array.from(event.args.squares),
    })
    .onConflictDoNothing();
});

ponder.on("GridLotteryV2:RoundResolved", async ({ event, context }) => {
  const isCanonical = isCanonicalLotteryRound(event.log.address, event.args.roundId);

  const winner =
    event.args.singleMinerWinner === ZERO_ADDRESS
      ? null
      : event.args.singleMinerWinner;

  await context.db
    .insert(lotteryRound)
    .values({
      chainId:            CHAIN_ID,
      contractAddress:    event.log.address,
      roundId:            event.args.roundId,
      resolvedTxHash:     event.transaction.hash,
      resolvedLogIndex:   event.log.logIndex,
      blockNumber:        event.block.number,
      blockTime:          Number(event.block.timestamp),
      winningSquare:      Number(event.args.winningSquare),
      jackpotHit:         event.args.jackpotHit,
      singleMinerRound:   event.args.singleMinerRound,
      singleMinerWinner:  winner,
      winnerTotal:        event.args.winnerTotal,
      potForWinners:      event.args.potForWinners,
      slvrForWinners:     event.args.slvrForWinners,
      totalUnclaimedSlvr: event.args.totalUnclaimedSlvr,
      isCanonical:        isCanonical,
    })
    .onConflictDoNothing();
});

ponder.on("GridLotteryV2:Claimed", async ({ event, context }) => {
  await context.db
    .insert(lotteryClaim)
    .values({
      chainId:         CHAIN_ID,
      contractAddress: event.log.address,
      txHash:          event.transaction.hash,
      logIndex:        event.log.logIndex,
      blockNumber:     event.block.number,
      blockTime:       Number(event.block.timestamp),
      roundId:         event.args.roundId,
      user:            event.args.user,
      nativeOut:       event.args.nativeOut,
      slvrOut:         event.args.slvrOut,
      refinedOut:      event.args.refinedOut,
      refiningFee:     event.args.refiningFee,
    })
    .onConflictDoNothing();
});

ponder.on("GridLotteryV2:MinerIndexUpdated", async ({ event, context }) => {
  await context.db
    .insert(dividendIndexUpdate)
    .values({
      chainId:         CHAIN_ID,
      contractAddress: event.log.address,
      txHash:          event.transaction.hash,
      logIndex:        event.log.logIndex,
      blockNumber:     event.block.number,
      blockTime:       Number(event.block.timestamp),
      newIndex:        event.args.newIndex,
      totalUnclaimed:  event.args.totalUnclaimed,
      totalRefined:    event.args.totalRefined,
    })
    .onConflictDoNothing();
});

ponder.on("GridLotteryV2:RefiningFeeApplied", async ({ event, context }) => {
  await context.db
    .insert(dividendFeeApplied)
    .values({
      chainId:         CHAIN_ID,
      contractAddress: event.log.address,
      txHash:          event.transaction.hash,
      logIndex:        event.log.logIndex,
      blockNumber:     event.block.number,
      blockTime:       Number(event.block.timestamp),
      account:         event.args.account,
      rewardsSlvr:     event.args.rewardsSlvr,
      fee:             event.args.fee,
      newIndex:        event.args.newIndex,
      totalUnclaimed:  event.args.totalUnclaimed,
    })
    .onConflictDoNothing();
});

// ── Grid Lottery V3 handlers (round 33,500+; miner state is in the vault) ────

ponder.on("GridLotteryV3:BetPlaced", async ({ event, context }) => {
  await context.db
    .insert(lotteryBet)
    .values({
      chainId:         CHAIN_ID,
      contractAddress: event.log.address,
      txHash:          event.transaction.hash,
      logIndex:        event.log.logIndex,
      blockNumber:     event.block.number,
      blockTime:       Number(event.block.timestamp),
      roundId:         event.args.roundId,
      beneficiary:     event.args.beneficiary,
      total:           event.args.total,
      squares:         Array.from(event.args.squares),
    })
    .onConflictDoNothing();
});

ponder.on("GridLotteryV3:RoundResolved", async ({ event, context }) => {
  const winner =
    event.args.singleMinerWinner === ZERO_ADDRESS
      ? null
      : event.args.singleMinerWinner;

  await context.db
    .insert(lotteryRound)
    .values({
      chainId:            CHAIN_ID,
      contractAddress:    event.log.address,
      roundId:            event.args.roundId,
      resolvedTxHash:     event.transaction.hash,
      resolvedLogIndex:   event.log.logIndex,
      blockNumber:        event.block.number,
      blockTime:          Number(event.block.timestamp),
      winningSquare:      Number(event.args.winningSquare),
      jackpotHit:         event.args.jackpotHit,
      singleMinerRound:   event.args.singleMinerRound,
      singleMinerWinner:  winner,
      winnerTotal:        event.args.winnerTotal,
      potForWinners:      event.args.potForWinners,
      slvrForWinners:     event.args.slvrForWinners,
      totalUnclaimedSlvr: event.args.totalUnclaimedSlvr,
      isCanonical:        isCanonicalLotteryRound(event.log.address, event.args.roundId),
    })
    .onConflictDoNothing();
});

ponder.on("GridLotteryV3:Claimed", async ({ event, context }) => {
  await context.db
    .insert(lotteryClaim)
    .values({
      chainId:         CHAIN_ID,
      contractAddress: event.log.address,
      txHash:          event.transaction.hash,
      logIndex:        event.log.logIndex,
      blockNumber:     event.block.number,
      blockTime:       Number(event.block.timestamp),
      roundId:         event.args.roundId,
      user:            event.args.user,
      nativeOut:       event.args.nativeOut,
      slvrOut:         event.args.slvrOut,
      refinedOut:      event.args.refinedOut,
      refiningFee:     event.args.refiningFee,
    })
    .onConflictDoNothing();
});

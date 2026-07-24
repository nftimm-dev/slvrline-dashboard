import { ponder } from "ponder:registry";
import { hubRewardMinted, hubEmissionRate, veStakerRevenue } from "ponder:schema";
import { CHAIN_ID } from "../lib/constants";

// ── SlvrHub:RewardMinted ──────────────────────────────────────────────────────
// ABI: RewardMinted(gameId indexed, to indexed, amount)
// Per-game SLVR emission. Do NOT sum alongside token_transfer for total supply.
// Hub RewardMinted and token Transfer(from=0x0) represent the same mint event.
// Canonical emissions for total supply tracking: use token_transfer table.
ponder.on("SlvrHub:RewardMinted", async ({ event, context }) => {
  await context.db
    .insert(hubRewardMinted)
    .values({
      chainId:         CHAIN_ID,
      contractAddress: event.log.address,
      txHash:          event.transaction.hash,
      logIndex:        event.log.logIndex,
      blockNumber:     event.block.number,
      blockTime:       Number(event.block.timestamp),
      gameId:          event.args.gameId,
      to:              event.args.to,
      amount:          event.args.amount,
    })
    .onConflictDoNothing();
});

// ── SlvrHub:EmissionRateChanged ───────────────────────────────────────────────
// ABI: EmissionRateChanged(ratePerSec) — NOT indexed
// SLVR emission rate per second (WAD-scaled). Supports mining runway chart.
ponder.on("SlvrHub:EmissionRateChanged", async ({ event, context }) => {
  await context.db
    .insert(hubEmissionRate)
    .values({
      chainId:         CHAIN_ID,
      contractAddress: event.log.address,
      txHash:          event.transaction.hash,
      logIndex:        event.log.logIndex,
      blockNumber:     event.block.number,
      blockTime:       Number(event.block.timestamp),
      ratePerSec:      event.args.ratePerSec,
    })
    .onConflictDoNothing();
});

// ── SlvrHub:StakersPaid ───────────────────────────────────────────────────────
// ABI: StakersPaid(gameId indexed, seq, amount) — seq and amount are NOT indexed
// ETH distributed to veSLVR stakers. Stored in ve_staker_revenue for Phase 3 ETH-revenue metric.
ponder.on("SlvrHub:StakersPaid", async ({ event, context }) => {
  await context.db
    .insert(veStakerRevenue)
    .values({
      chainId:         CHAIN_ID,
      contractAddress: event.log.address,
      txHash:          event.transaction.hash,
      logIndex:        event.log.logIndex,
      blockNumber:     event.block.number,
      blockTime:       Number(event.block.timestamp),
      gameId:          event.args.gameId,
      seq:             event.args.seq,
      amount:          event.args.amount,
    })
    .onConflictDoNothing();
});

// StakersDeferred — NOT indexed (deferred payments indicate postponed distribution;
// Phase 3 can derive deferred amounts from difference between StakersPaid cumulative and expected)

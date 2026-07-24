import { ponder } from "ponder:registry";
import { veStakePosition } from "ponder:schema";
import { CHAIN_ID } from "../lib/constants";

// ── SlvrVoteEscrowStaking:Staked ──────────────────────────────────────────────
// ABI: Staked(tokenId indexed, user indexed, weight)
// weight = voting weight (amount × time-multiplier), NOT raw SLVR.
// To get SLVR staked in veStaking, join tokenId to ve_lock.current_amount (Phase 3).
ponder.on("SlvrVoteEscrowStaking:Staked", async ({ event, context }) => {
  await context.db
    .insert(veStakePosition)
    .values({
      chainId:         CHAIN_ID,
      contractAddress: event.log.address,
      tokenId:         event.args.tokenId,
      user:            event.args.user,
      weight:          event.args.weight,
      isStaked:        true,
      stakedBlock:     event.block.number,
      stakedTime:      Number(event.block.timestamp),
      unstakedBlock:   null,
    })
    .onConflictDoUpdate({
      isStaked:      true,
      weight:        event.args.weight,
      stakedBlock:   event.block.number,
      stakedTime:    Number(event.block.timestamp),
      unstakedBlock: null,
    });
});

// ── SlvrVoteEscrowStaking:Unstaked ────────────────────────────────────────────
// ABI: Unstaked(tokenId indexed, user indexed, weight)
ponder.on("SlvrVoteEscrowStaking:Unstaked", async ({ event, context }) => {
  await context.db
    .update(veStakePosition, {
      chainId:         CHAIN_ID,
      contractAddress: event.log.address,
      tokenId:         event.args.tokenId,
    })
    .set({
      isStaked:      false,
      unstakedBlock: event.block.number,
    });
});

// ── SlvrVoteEscrowStaking:Checkpoint ──────────────────────────────────────────
// ABI: Checkpoint(tokenId indexed, oldWeight, newWeight)
// Updates the weight (voting power checkpoint) for an already-staked position.
ponder.on("SlvrVoteEscrowStaking:Checkpoint", async ({ event, context }) => {
  await context.db
    .update(veStakePosition, {
      chainId:         CHAIN_ID,
      contractAddress: event.log.address,
      tokenId:         event.args.tokenId,
    })
    .set({ weight: event.args.newWeight });
});

// RewardDistributed — NOT indexed (veStaker ETH revenue comes from Hub StakersPaid, not here)
// RewardClaimed, PendingRewardsClaimed, RewardsSettledOnBurn — NOT indexed (Phase 2 scope)

import { ponder } from "ponder:registry";
import { veLock, veLockEvent } from "ponder:schema";
import { CHAIN_ID } from "../lib/constants";

// ── SlvrVoteEscrow:LockCreated ────────────────────────────────────────────────
// ABI: LockCreated(tokenId indexed, user indexed, amount, duration, permanent)
// Note: LockCreated carries `duration` (not lockEnd). Store duration as lockEnd field.
// For permanent locks: lockEnd = 0n (per the contract spec: lockEnd == 0 when permanent).
// For time-locked: store the duration value; Phase 3 computes lockEnd = createdTime + duration.
ponder.on("SlvrVoteEscrow:LockCreated", async ({ event, context }) => {
  const isPermanent = event.args.permanent;
  const lockEnd = isPermanent ? 0n : event.args.duration;

  await context.db
    .insert(veLock)
    .values({
      chainId:          CHAIN_ID,
      contractAddress:  event.log.address,
      tokenId:          event.args.tokenId,
      user:             event.args.user,
      currentAmount:    event.args.amount,
      lockEnd:          lockEnd,
      isPermanent:      isPermanent,
      isActive:         true,
      permanentTokenId: null,
      createdBlock:     event.block.number,
      createdTime:      Number(event.block.timestamp),
    })
    .onConflictDoNothing();

  await context.db
    .insert(veLockEvent)
    .values({
      chainId:         CHAIN_ID,
      contractAddress: event.log.address,
      txHash:          event.transaction.hash,
      logIndex:        event.log.logIndex,
      blockNumber:     event.block.number,
      blockTime:       Number(event.block.timestamp),
      tokenId:         event.args.tokenId,
      eventType:       "created",
      amountDelta:     event.args.amount,
      newLockEnd:      lockEnd,
      isPermanent:     isPermanent,
      user:            event.args.user,
    })
    .onConflictDoNothing();
});

// ── SlvrVoteEscrow:LockIncreased ──────────────────────────────────────────────
// ABI: LockIncreased(tokenId indexed, addedAmount, newLockEnd)
// Event does NOT carry isPermanent — must look up existing ve_lock row.
ponder.on("SlvrVoteEscrow:LockIncreased", async ({ event, context }) => {
  const existing = await context.db.find(veLock, {
    chainId:         CHAIN_ID,
    contractAddress: event.log.address,
    tokenId:         event.args.tokenId,
  });

  if (!existing) {
    console.warn(
      `[veEscrow] LockIncreased: no existing ve_lock for tokenId=${event.args.tokenId} ` +
      `at block ${event.block.number}. Skipping.`
    );
    return;
  }

  const newAmount = existing.currentAmount + event.args.addedAmount;

  await context.db
    .update(veLock, {
      chainId:         CHAIN_ID,
      contractAddress: event.log.address,
      tokenId:         event.args.tokenId,
    })
    .set({
      currentAmount: newAmount,
      lockEnd:       event.args.newLockEnd,
      // isPermanent is unchanged — do not overwrite
    });

  await context.db
    .insert(veLockEvent)
    .values({
      chainId:         CHAIN_ID,
      contractAddress: event.log.address,
      txHash:          event.transaction.hash,
      logIndex:        event.log.logIndex,
      blockNumber:     event.block.number,
      blockTime:       Number(event.block.timestamp),
      tokenId:         event.args.tokenId,
      eventType:       "increased",
      amountDelta:     event.args.addedAmount,
      newLockEnd:      event.args.newLockEnd,
      isPermanent:     existing.isPermanent,
      user:            null,
    })
    .onConflictDoNothing();
});

// ── SlvrVoteEscrow:LockExtended ───────────────────────────────────────────────
// ABI: LockExtended(tokenId indexed, newLockEnd)
ponder.on("SlvrVoteEscrow:LockExtended", async ({ event, context }) => {
  await context.db
    .update(veLock, {
      chainId:         CHAIN_ID,
      contractAddress: event.log.address,
      tokenId:         event.args.tokenId,
    })
    .set({ lockEnd: event.args.newLockEnd });

  await context.db
    .insert(veLockEvent)
    .values({
      chainId:         CHAIN_ID,
      contractAddress: event.log.address,
      txHash:          event.transaction.hash,
      logIndex:        event.log.logIndex,
      blockNumber:     event.block.number,
      blockTime:       Number(event.block.timestamp),
      tokenId:         event.args.tokenId,
      eventType:       "extended",
      amountDelta:     null,
      newLockEnd:      event.args.newLockEnd,
      isPermanent:     null,
      user:            null,
    })
    .onConflictDoNothing();
});

// ── SlvrVoteEscrow:LockWithdrawn ──────────────────────────────────────────────
// ABI: LockWithdrawn(tokenId indexed, user indexed, amount)
ponder.on("SlvrVoteEscrow:LockWithdrawn", async ({ event, context }) => {
  const existing = await context.db.find(veLock, {
    chainId:         CHAIN_ID,
    contractAddress: event.log.address,
    tokenId:         event.args.tokenId,
  });

  const prevAmount = existing?.currentAmount ?? 0n;

  await context.db
    .update(veLock, {
      chainId:         CHAIN_ID,
      contractAddress: event.log.address,
      tokenId:         event.args.tokenId,
    })
    .set({
      currentAmount: 0n,
      isActive:      false,
    });

  await context.db
    .insert(veLockEvent)
    .values({
      chainId:         CHAIN_ID,
      contractAddress: event.log.address,
      txHash:          event.transaction.hash,
      logIndex:        event.log.logIndex,
      blockNumber:     event.block.number,
      blockTime:       Number(event.block.timestamp),
      tokenId:         event.args.tokenId,
      eventType:       "withdrawn",
      amountDelta:     prevAmount > 0n ? -prevAmount : null,  // negative delta
      newLockEnd:      null,
      isPermanent:     null,
      user:            event.args.user,
    })
    .onConflictDoNothing();
});

// ── SlvrVoteEscrow:LockConvertedToPermanent ───────────────────────────────────
// ABI: LockConvertedToPermanent(tokenId indexed, permanentTokenId indexed, amount)
// Old tokenId's NFT is burned; a new permanent tokenId is created.
// Two ve_lock_event rows: one for the old token (converted) and one for the new permanent token (created).
ponder.on("SlvrVoteEscrow:LockConvertedToPermanent", async ({ event, context }) => {
  const oldTokenId = event.args.tokenId;
  const newTokenId = event.args.permanentTokenId;
  const amount     = event.args.amount;

  // Look up the old lock to get the user address
  const oldLock = await context.db.find(veLock, {
    chainId:         CHAIN_ID,
    contractAddress: event.log.address,
    tokenId:         oldTokenId,
  });

  const user = oldLock?.user ?? ("0x0000000000000000000000000000000000000000" as `0x${string}`);

  // Mark the old lock as converted (not withdrawn — it became a permanent lock)
  await context.db
    .update(veLock, {
      chainId:         CHAIN_ID,
      contractAddress: event.log.address,
      tokenId:         oldTokenId,
    })
    .set({
      isActive:         false,
      isPermanent:      true,
      permanentTokenId: newTokenId,
    });

  // Insert the new permanent lock row
  await context.db
    .insert(veLock)
    .values({
      chainId:          CHAIN_ID,
      contractAddress:  event.log.address,
      tokenId:          newTokenId,
      user:             user,
      currentAmount:    amount,
      lockEnd:          0n,
      isPermanent:      true,
      isActive:         true,
      permanentTokenId: null,
      createdBlock:     event.block.number,
      createdTime:      Number(event.block.timestamp),
    })
    .onConflictDoNothing();

  // Event row 1: mark old tokenId as converted
  // Use logIndex 0-based sub-index by appending to logIndex; we use logIndex*2 and logIndex*2+1.
  // Actually Ponder PK is (chainId, contractAddress, txHash, logIndex) — one event = one logIndex.
  // We insert two ve_lock_event rows using a workaround: the second row uses logIndex + 1 as a synthetic key.
  // This is safe because the same tx can't have two LockConvertedToPermanent at the same logIndex.
  await context.db
    .insert(veLockEvent)
    .values({
      chainId:         CHAIN_ID,
      contractAddress: event.log.address,
      txHash:          event.transaction.hash,
      logIndex:        event.log.logIndex,
      blockNumber:     event.block.number,
      blockTime:       Number(event.block.timestamp),
      tokenId:         oldTokenId,
      eventType:       "converted_to_permanent",
      amountDelta:     null,
      newLockEnd:      null,
      isPermanent:     true,
      user:            null,
    })
    .onConflictDoNothing();

  // Event row 2: the new permanent tokenId is effectively "created"
  // Synthetic logIndex to avoid PK collision (logIndex + 1 is safe: no two logs share same index in a tx)
  await context.db
    .insert(veLockEvent)
    .values({
      chainId:         CHAIN_ID,
      contractAddress: event.log.address,
      txHash:          event.transaction.hash,
      logIndex:        event.log.logIndex + 1,  // synthetic — no actual log at this index for this event
      blockNumber:     event.block.number,
      blockTime:       Number(event.block.timestamp),
      tokenId:         newTokenId,
      eventType:       "created",
      amountDelta:     amount,
      newLockEnd:      0n,
      isPermanent:     true,
      user:            user,
    })
    .onConflictDoNothing();
});

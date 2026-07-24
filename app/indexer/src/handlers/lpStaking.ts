import { ponder } from "ponder:registry";
import { lpStakePosition, lpStakeEvent } from "ponder:schema";
import { CHAIN_ID } from "../lib/constants";

// ── SlvrLiquidityStaking:Deposit ──────────────────────────────────────────────
// ABI: Deposit(user indexed, amount)
ponder.on("SlvrLiquidityStaking:Deposit", async ({ event, context }) => {
  const existing = await context.db.find(lpStakePosition, {
    chainId:         CHAIN_ID,
    contractAddress: event.log.address,
    user:            event.args.user,
  });

  const newAmount = (existing?.currentAmount ?? 0n) + event.args.amount;

  await context.db
    .insert(lpStakePosition)
    .values({
      chainId:         CHAIN_ID,
      contractAddress: event.log.address,
      user:            event.args.user,
      currentAmount:   newAmount,
      lastEventBlock:  event.block.number,
      lastEventTime:   Number(event.block.timestamp),
    })
    .onConflictDoUpdate({
      currentAmount:  newAmount,
      lastEventBlock: event.block.number,
      lastEventTime:  Number(event.block.timestamp),
    });

  await context.db
    .insert(lpStakeEvent)
    .values({
      chainId:         CHAIN_ID,
      contractAddress: event.log.address,
      txHash:          event.transaction.hash,
      logIndex:        event.log.logIndex,
      blockNumber:     event.block.number,
      blockTime:       Number(event.block.timestamp),
      user:            event.args.user,
      eventType:       "deposit",
      amount:          event.args.amount,
      fee:             null,
    })
    .onConflictDoNothing();
});

// ── SlvrLiquidityStaking:Withdraw ─────────────────────────────────────────────
// ABI: Withdraw(user indexed, amount, fee)
// fee = early-withdrawal penalty (0 if not early)
ponder.on("SlvrLiquidityStaking:Withdraw", async ({ event, context }) => {
  const existing = await context.db.find(lpStakePosition, {
    chainId:         CHAIN_ID,
    contractAddress: event.log.address,
    user:            event.args.user,
  });

  const prevAmount = existing?.currentAmount ?? 0n;
  const rawNew = prevAmount - event.args.amount;
  const newAmount = rawNew < 0n ? 0n : rawNew;

  if (rawNew < 0n) {
    console.warn(
      `[lpStaking] Withdraw: currentAmount underflow for user=${event.args.user} ` +
      `at block ${event.block.number}. Clamping to 0.`
    );
  }

  await context.db
    .insert(lpStakePosition)
    .values({
      chainId:         CHAIN_ID,
      contractAddress: event.log.address,
      user:            event.args.user,
      currentAmount:   newAmount,
      lastEventBlock:  event.block.number,
      lastEventTime:   Number(event.block.timestamp),
    })
    .onConflictDoUpdate({
      currentAmount:  newAmount,
      lastEventBlock: event.block.number,
      lastEventTime:  Number(event.block.timestamp),
    });

  await context.db
    .insert(lpStakeEvent)
    .values({
      chainId:         CHAIN_ID,
      contractAddress: event.log.address,
      txHash:          event.transaction.hash,
      logIndex:        event.log.logIndex,
      blockNumber:     event.block.number,
      blockTime:       Number(event.block.timestamp),
      user:            event.args.user,
      eventType:       "withdraw",
      amount:          event.args.amount,   // always positive
      fee:             event.args.fee,      // early-withdrawal fee (may be 0)
    })
    .onConflictDoNothing();
});

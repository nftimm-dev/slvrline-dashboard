import { ponder } from "ponder:registry";
import { transferEvent } from "ponder:schema";

/**
 * Proof-of-life: index ERC-20 Transfer events from the SLVR token.
 * This is the bootstrap handler — Phase 1 will expand to full contract coverage.
 */
ponder.on("SlvrToken:Transfer", async ({ event, context }) => {
  await context.db.insert(transferEvent).values({
    id: `${event.transaction.hash}-${event.log.logIndex}`,
    from: event.args.from,
    to: event.args.to,
    value: event.args.value,
    blockNumber: BigInt(event.block.number),
    blockTimestamp: Number(event.block.timestamp),
    txHash: event.transaction.hash,
  });
});

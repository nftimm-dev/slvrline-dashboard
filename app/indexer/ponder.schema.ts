import { onchainTable, primaryKey } from "ponder";

/**
 * transferEvent: proof-of-life ERC-20 Transfer index for the SLVR token.
 *
 * Primary key: txHash-logIndex  (unique per log entry on-chain)
 * Amounts are bigint (never float) — SLVR has 18 decimals.
 */
export const transferEvent = onchainTable(
  "transfer_event",
  (t) => ({
    id: t.text().notNull(),        // "${txHash}-${logIndex}"
    from: t.hex().notNull(),       // ERC-20 Transfer: from address
    to: t.hex().notNull(),         // ERC-20 Transfer: to address
    value: t.bigint().notNull(),   // raw token units (bigint, never float)
    blockNumber: t.bigint().notNull(),
    blockTimestamp: t.integer().notNull(),
    txHash: t.hex().notNull(),
  }),
  (table) => ({
    pk: primaryKey({ columns: [table.id] }),
  })
);

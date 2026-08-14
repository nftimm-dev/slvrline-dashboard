/**
 * Shared types for the buybacks page. Data is served by /api/buybacks, which reads
 * the latest `buyback_totals` snapshot from metrics.metric_snapshots (written by the
 * metrics cron from the executor's on-chain BuybackBurned events).
 */

export interface BuybackRecentEvent {
  block: number;
  eth: number;
  slvr: number;
  /** Approx UTC ms, derived from the event block vs the snapshot's block/time. */
  approxTs: number;
}

export interface BuybackData {
  /** Cumulative SLVR bought back & sent to the graveyard (== graveyard balance). */
  cumulativeSlvr: number;
  /** Cumulative ETH spent buying back. */
  cumulativeEth: number;
  cumulativeUsd: number | null;
  /** Current daily rate (trailing ≤24h, extrapolated). */
  dailySlvr: number;
  dailyEth: number;
  dailyUsd: number | null;
  buybackCount: number;
  buybacksPerDay: number | null;
  avgIntervalSec: number | null;
  ethUsd: number | null;
  graveyardBalanceSlvr: number | null;
  graveyardMatch: boolean | null;
  recent: BuybackRecentEvent[];
  /** ISO timestamp of the source snapshot row. */
  updatedAt: string;
}

/**
 * buybacks.ts — SLVR buyback-and-burn accounting from the executor's BuybackBurned event.
 *
 * Mechanism (reverse-engineered on-chain):
 *   A keeper EOA (BUYBACK_KEEPER) calls the executor (BUYBACK_EXECUTOR) every ~80-90s.
 *   The executor swaps accumulated mining-revenue ETH → SLVR on the Uniswap V4 pool and
 *   forwards every token to the SlvrGraveyard (an intentionally-empty, unrecoverable
 *   contract), emitting:
 *
 *     BuybackBurned(uint256 ethIn, uint256 tokensBurned)   // both non-indexed (data)
 *
 *   tokensBurned is permanently removed from circulation. NOTE: the graveyard is NOT the
 *   0x0/dead burn — the SLVR token redirects dead-address transfers into a real totalSupply
 *   burn, whereas the graveyard is an ordinary address it does not special-case, so graveyard
 *   SLVR stays in totalSupply() while being economically out of circulation.
 *
 *   Because the graveyard can never send out, balanceOf(graveyard) == Σ tokensBurned — used
 *   here as an independent cross-check on the event sum.
 */

import { archivalCall, decodeUint256, getLogsAdaptive } from "../rpc";
import {
  SLVR_TOKEN,
  SLVR_GRAVEYARD,
  BUYBACK_EXECUTOR,
  BUYBACK_BURNED_TOPIC0,
  DEPLOY_BLOCK_BUYBACK,
  APPROX_BLOCKS_PER_SEC,
} from "../constants";

const BALANCE_OF_SEL = "0x70a08231";
const DAY_SECONDS = 86_400;
const DUST_RAW = 10n ** 15n; // 0.001 SLVR cross-check tolerance

function encodeBalanceOf(address: string): string {
  return BALANCE_OF_SEL + address.toLowerCase().replace("0x", "").padStart(64, "0");
}

/** Decode BuybackBurned(ethIn, tokensBurned) from a log's non-indexed data blob. */
function decodeBuybackData(data: string): { ethIn: bigint; slvr: bigint } {
  const body = data && data !== "0x" ? data.replace(/^0x/, "") : "";
  const ethIn = body.length >= 64 ? BigInt("0x" + body.slice(0, 64)) : 0n;
  const slvr = body.length >= 128 ? BigInt("0x" + body.slice(64, 128)) : 0n;
  return { ethIn, slvr };
}

export type BuybackEvent = { ethInRaw: bigint; slvrRaw: bigint; block: bigint };

/** Fetch + decode all BuybackBurned events in [fromBlock, toBlock], sorted ascending. */
export async function fetchBuybackEvents(
  fromBlock: bigint,
  toBlock: bigint
): Promise<BuybackEvent[]> {
  const raw = await getLogsAdaptive({
    address: BUYBACK_EXECUTOR,
    topics: [BUYBACK_BURNED_TOPIC0],
    fromBlock,
    toBlock,
  });
  return raw
    .map((lg) => {
      const { ethIn, slvr } = decodeBuybackData(lg.data);
      return { ethInRaw: ethIn, slvrRaw: slvr, block: BigInt(lg.blockNumber) };
    })
    .sort((a, b) => (a.block < b.block ? -1 : a.block > b.block ? 1 : 0));
}

export type BuybackResult = {
  block: bigint;
  // Cumulative (all-time)
  cumulativeSlvrRaw: bigint; // Σ tokensBurned
  cumulativeEthRaw: bigint; // Σ ethIn
  cumulativeSlvrHuman: number;
  cumulativeEthHuman: number;
  buybackCount: number;
  graveyardBalanceRaw: bigint; // balanceOf(graveyard) — independent cross-check
  graveyardMatch: boolean; // |graveyard − Σtokens| within dust
  // Trailing window (≤24h) → current daily RATE (extrapolated across the window)
  windowSeconds: number;
  windowSlvrRaw: bigint;
  windowEthRaw: bigint;
  windowCount: number;
  dailySlvrHuman: number; // extrapolated SLVR/day at current cadence
  dailyEthHuman: number; // extrapolated ETH/day
  // Cadence
  firstBlock: bigint | null;
  lastBlock: bigint | null;
  avgIntervalSeconds: number | null;
  buybacksPerDay: number | null;
  recent: BuybackEvent[]; // last ≤20 events, newest first (for a table)
};

/**
 * Compute buyback-and-burn totals at `atBlock`.
 *
 * cumulative = every BuybackBurned since DEPLOY_BLOCK_BUYBACK; the ≤24h trailing window
 * gives the current daily rate (extrapolated so a <24h-old mechanism still reports a
 * per-day figure). Block↔time uses APPROX_BLOCKS_PER_SEC (Robinhood Chain ~10 blk/s).
 */
export async function computeBuybacks(atBlock: bigint): Promise<BuybackResult> {
  // 1. All BuybackBurned events from the executor (deploy → atBlock).
  const events = await fetchBuybackEvents(DEPLOY_BLOCK_BUYBACK, atBlock);

  let cumulativeSlvrRaw = 0n;
  let cumulativeEthRaw = 0n;
  for (const e of events) {
    cumulativeSlvrRaw += e.slvrRaw;
    cumulativeEthRaw += e.ethInRaw;
  }

  // 2. Cross-check cumulative SLVR against the graveyard balance (it never sends out).
  let graveyardBalanceRaw = 0n;
  try {
    const hex = await archivalCall(SLVR_TOKEN, encodeBalanceOf(SLVR_GRAVEYARD), atBlock);
    graveyardBalanceRaw = decodeUint256(hex);
  } catch {
    // cross-check only — non-fatal
  }
  const diff =
    graveyardBalanceRaw > cumulativeSlvrRaw
      ? graveyardBalanceRaw - cumulativeSlvrRaw
      : cumulativeSlvrRaw - graveyardBalanceRaw;
  const graveyardMatch = diff <= DUST_RAW;

  // 3. Trailing window (≤24h) → current daily rate.
  const windowBlocks = BigInt(DAY_SECONDS * APPROX_BLOCKS_PER_SEC); // 864,000
  const firstBlock = events.length ? events[0].block : null;
  const floorBlock = atBlock > windowBlocks ? atBlock - windowBlocks : 0n;
  const windowStart =
    firstBlock !== null && firstBlock > floorBlock ? firstBlock : floorBlock;
  let windowSlvrRaw = 0n;
  let windowEthRaw = 0n;
  let windowCount = 0;
  for (const e of events) {
    if (e.block >= windowStart) {
      windowSlvrRaw += e.slvrRaw;
      windowEthRaw += e.ethInRaw;
      windowCount++;
    }
  }
  const windowSeconds = Math.max(1, Number(atBlock - windowStart) / APPROX_BLOCKS_PER_SEC);
  const dailySlvrHuman = ((Number(windowSlvrRaw) / 1e18) / windowSeconds) * DAY_SECONDS;
  const dailyEthHuman = ((Number(windowEthRaw) / 1e18) / windowSeconds) * DAY_SECONDS;

  // 4. Cadence (block-approximated).
  const lastBlock = events.length ? events[events.length - 1].block : null;
  let avgIntervalSeconds: number | null = null;
  let buybacksPerDay: number | null = null;
  if (firstBlock !== null && lastBlock !== null && events.length > 1) {
    const spanSec = Number(lastBlock - firstBlock) / APPROX_BLOCKS_PER_SEC;
    avgIntervalSeconds = spanSec / (events.length - 1);
    buybacksPerDay = avgIntervalSeconds > 0 ? DAY_SECONDS / avgIntervalSeconds : null;
  }

  return {
    block: atBlock,
    cumulativeSlvrRaw,
    cumulativeEthRaw,
    cumulativeSlvrHuman: Number(cumulativeSlvrRaw) / 1e18,
    cumulativeEthHuman: Number(cumulativeEthRaw) / 1e18,
    buybackCount: events.length,
    graveyardBalanceRaw,
    graveyardMatch,
    windowSeconds,
    windowSlvrRaw,
    windowEthRaw,
    windowCount,
    dailySlvrHuman,
    dailyEthHuman,
    firstBlock,
    lastBlock,
    avgIntervalSeconds,
    buybacksPerDay,
    recent: events.slice(-20).reverse(),
  };
}

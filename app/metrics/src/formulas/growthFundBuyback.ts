/**
 * growthFundBuyback.ts — Growth Fund SLVR accumulation.
 *
 * A separate EOA (GROWTH_FUND_BUYER) buys SLVR on the Uniswap V4 pool roughly every
 * 5 minutes and HOLDS it — the Growth Fund accumulating SLVR as buy pressure. Unlike
 * the protocol buyback (which burns to the graveyard), this wallet never sells, so:
 *
 *   cumulative SLVR bought = Σ Transfer(SLVR → wallet) == balanceOf(wallet)
 *
 * We index the inbound SLVR transfers (standard ERC-20 Transfer, value in data, `to`
 * indexed in topic2) and cross-check against the live balance.
 */

import { archivalCall, decodeUint256, getLogsAdaptive, TRANSFER_TOPIC0 } from "../rpc";
import {
  SLVR_TOKEN,
  GROWTH_FUND_BUYER,
  DEPLOY_BLOCK_GROWTHFUND,
  APPROX_BLOCKS_PER_SEC,
} from "../constants";

const BALANCE_OF_SEL = "0x70a08231";
const DAY_SECONDS = 86_400;
const DUST_RAW = 10n ** 15n;

function encodeBalanceOf(address: string): string {
  return BALANCE_OF_SEL + address.toLowerCase().replace("0x", "").padStart(64, "0");
}
function addrTopic(address: string): string {
  return "0x" + address.toLowerCase().replace("0x", "").padStart(64, "0");
}

export type GrowthBuy = { slvrRaw: bigint; block: bigint };

export type GrowthFundResult = {
  block: bigint;
  cumulativeSlvrRaw: bigint; // Σ Transfer(SLVR → wallet)
  cumulativeSlvrHuman: number;
  heldRaw: bigint; // balanceOf(wallet) — cross-check (== cumulative, no sells)
  heldHuman: number;
  heldMatch: boolean;
  buyCount: number;
  dailySlvrHuman: number; // trailing ≤24h SLVR/day (extrapolated)
  firstBlock: bigint | null;
  lastBlock: bigint | null;
  avgIntervalSeconds: number | null;
  buysPerDay: number | null;
  recent: GrowthBuy[]; // last ≤20 buys, newest first
};

/** Fetch + decode all inbound SLVR transfers to the Growth Fund buyer, sorted ascending. */
export async function fetchGrowthBuys(
  fromBlock: bigint,
  toBlock: bigint
): Promise<GrowthBuy[]> {
  const raw = await getLogsAdaptive({
    address: SLVR_TOKEN,
    topics: [TRANSFER_TOPIC0, null, addrTopic(GROWTH_FUND_BUYER)],
    fromBlock,
    toBlock,
  });
  return raw
    .map((lg) => ({
      slvrRaw: BigInt(lg.data && lg.data !== "0x" ? lg.data : "0x0"),
      block: BigInt(lg.blockNumber),
    }))
    .sort((a, b) => (a.block < b.block ? -1 : a.block > b.block ? 1 : 0));
}

export async function computeGrowthFundBuyback(atBlock: bigint): Promise<GrowthFundResult> {
  const buys = await fetchGrowthBuys(DEPLOY_BLOCK_GROWTHFUND, atBlock);

  let cumulativeSlvrRaw = 0n;
  for (const b of buys) cumulativeSlvrRaw += b.slvrRaw;

  // Cross-check against the live balance (the wallet never sells).
  let heldRaw = 0n;
  try {
    heldRaw = decodeUint256(
      await archivalCall(SLVR_TOKEN, encodeBalanceOf(GROWTH_FUND_BUYER), atBlock)
    );
  } catch {
    /* cross-check only */
  }
  const diff =
    heldRaw > cumulativeSlvrRaw ? heldRaw - cumulativeSlvrRaw : cumulativeSlvrRaw - heldRaw;
  const heldMatch = diff <= DUST_RAW;

  // Trailing ≤24h daily rate.
  const windowBlocks = BigInt(DAY_SECONDS * APPROX_BLOCKS_PER_SEC);
  const firstBlock = buys.length ? buys[0].block : null;
  const floorBlock = atBlock > windowBlocks ? atBlock - windowBlocks : 0n;
  const windowStart =
    firstBlock !== null && firstBlock > floorBlock ? firstBlock : floorBlock;
  let windowSlvrRaw = 0n;
  for (const b of buys) if (b.block >= windowStart) windowSlvrRaw += b.slvrRaw;
  const windowSeconds = Math.max(1, Number(atBlock - windowStart) / APPROX_BLOCKS_PER_SEC);
  const dailySlvrHuman = ((Number(windowSlvrRaw) / 1e18) / windowSeconds) * DAY_SECONDS;

  // Cadence.
  const lastBlock = buys.length ? buys[buys.length - 1].block : null;
  let avgIntervalSeconds: number | null = null;
  let buysPerDay: number | null = null;
  if (firstBlock !== null && lastBlock !== null && buys.length > 1) {
    const spanSec = Number(lastBlock - firstBlock) / APPROX_BLOCKS_PER_SEC;
    avgIntervalSeconds = spanSec / (buys.length - 1);
    buysPerDay = avgIntervalSeconds > 0 ? DAY_SECONDS / avgIntervalSeconds : null;
  }

  return {
    block: atBlock,
    cumulativeSlvrRaw,
    cumulativeSlvrHuman: Number(cumulativeSlvrRaw) / 1e18,
    heldRaw,
    heldHuman: Number(heldRaw) / 1e18,
    heldMatch,
    buyCount: buys.length,
    dailySlvrHuman,
    firstBlock,
    lastBlock,
    avgIntervalSeconds,
    buysPerDay,
    recent: buys.slice(-20).reverse(),
  };
}

/**
 * Growth Fund flywheel data.
 *
 * The Growth Fund earns 0.04 SLVR per resolved round (4% of the 1.12 minted), stakes
 * that SLVR to earn ETH (the 8%-of-round-ETH staker cut), then spends the ETH buying
 * SLVR back on the open market via the buyer wallet (which KEEPS everything — 0 sells,
 * so balanceOf == cumulative bought).
 *
 * Data comes from Blockscout (the raw RPC eth_getLogs silently under-counts this
 * wallet's dense/wide transfer history), the on-chain round counter, and the market
 * price. The FULL history (totals + series) is slow to page (~30s), so it is
 * precomputed into metrics.cache by the cron; the recent-buys feed is fetched live
 * from the first page (fast).
 */
import { SLVR_TOKEN_ADDRESS } from "./labels";
import { ethCall, decodeUint256 } from "./rpc";
import {
  getAddressTokenTransfers,
  getAddressNativeSpent,
  type AddressTransfer,
} from "./blockscout";
import { getMarketData } from "./dexscreener";

export const GROWTH_FUND_BUYER = "0xec8c0A41F4F8ff291E111DB988D266BBF3F4eE3a";
const LOTTERY_V2 = "0xB0Cc994Ce4E8fb106da9Eb36e26fDd8C5f1e0c71";
const CURRENT_ROUND_SEL = "0x9cbe5efd"; // currentRoundId()
const SLVR_PER_ROUND_TO_GF = 0.04; // 4% of the 1.12 SLVR minted per round

export interface GrowthFundPoint {
  t: string;
  bought: number;
}

/** One on-market buy (SLVR received, ETH paid). */
export interface GrowthFundRecent {
  ts: string;
  slvr: number;
  eth: number;
}

export interface GrowthFundData {
  slvrBought: number;
  buyCount: number;
  ethDeployed: number;
  usdDeployed: number | null;
  slvrEarned: number;
  roundId: number | null;
  avgIntervalSec: number | null;
  buysPerDay: number | null;
  slvrUsd: number | null;
  ethUsd: number | null;
  holdingsUsd: number | null;
  series: GrowthFundPoint[];
  /** Most-recent buys (newest first). Fresh when served live; may be stale from cache. */
  recent: GrowthFundRecent[];
  updatedAt: string;
}

function downsample<T>(arr: T[], max: number): T[] {
  if (arr.length <= max) return arr;
  const step = Math.ceil(arr.length / max);
  const out = arr.filter((_, i) => i % step === 0);
  if (out[out.length - 1] !== arr[arr.length - 1]) out.push(arr[arr.length - 1]);
  return out;
}

function buildRecent(
  transfers: AddressTransfer[],
  valueByHash: Record<string, string>
): GrowthFundRecent[] {
  const buyerLc = GROWTH_FUND_BUYER.toLowerCase();
  return transfers
    .filter((t) => t.to === buyerLc && t.valueRaw > 0n)
    .sort((a, b) => b.block - a.block)
    .slice(0, 20)
    .map((t) => ({
      ts: t.timestamp ?? "",
      slvr: Number(t.valueRaw) / 1e18,
      eth: Number(BigInt(valueByHash[t.txHash] ?? "0")) / 1e18,
    }));
}

/** FULL compute — pages the entire history. Slow (~30s); precomputed by the cron. */
export async function getGrowthFundData(): Promise<GrowthFundData> {
  const [transfers, spent, roundHex, market] = await Promise.all([
    getAddressTokenTransfers(GROWTH_FUND_BUYER, SLVR_TOKEN_ADDRESS),
    getAddressNativeSpent(GROWTH_FUND_BUYER),
    ethCall(LOTTERY_V2, CURRENT_ROUND_SEL).catch(() => null),
    getMarketData().catch(() => null),
  ]);

  const buyerLc = GROWTH_FUND_BUYER.toLowerCase();
  const buys = transfers
    .filter((t) => t.to === buyerLc && t.valueRaw > 0n)
    .sort((a, b) => a.block - b.block);

  let cum = 0n;
  const rawPoints: GrowthFundPoint[] = [];
  for (const b of buys) {
    cum += b.valueRaw;
    if (b.timestamp) rawPoints.push({ t: b.timestamp, bought: Number(cum) / 1e18 });
  }
  const series = downsample(rawPoints, 180);
  const slvrBought = Number(cum) / 1e18;

  let avgIntervalSec: number | null = null;
  let buysPerDay: number | null = null;
  const firstTs = buys[0]?.timestamp;
  const lastTs = buys[buys.length - 1]?.timestamp;
  if (buys.length > 1 && firstTs && lastTs) {
    const spanSec = (Date.parse(lastTs) - Date.parse(firstTs)) / 1000;
    avgIntervalSec = spanSec / (buys.length - 1);
    buysPerDay = avgIntervalSec > 0 ? 86_400 / avgIntervalSec : null;
  }

  const ethDeployed = Number(spent.spentRaw) / 1e18;
  const roundId = roundHex ? Number(decodeUint256(roundHex)) : null;
  const slvrEarned = roundId != null ? SLVR_PER_ROUND_TO_GF * roundId : 0;
  const ethUsd = market?.eth_usd ?? null;
  const slvrUsd = market?.slvr_usd ?? null;

  return {
    slvrBought,
    buyCount: buys.length,
    ethDeployed,
    usdDeployed: ethUsd ? ethDeployed * ethUsd : null,
    slvrEarned,
    roundId,
    avgIntervalSec,
    buysPerDay,
    slvrUsd,
    ethUsd,
    holdingsUsd: slvrUsd ? slvrBought * slvrUsd : null,
    series,
    recent: buildRecent(transfers, spent.valueByHash),
    updatedAt: new Date().toISOString(),
  };
}

/** FAST recent-buys feed — first page only (~2 Blockscout calls). Served live. */
export async function getGrowthFundRecent(): Promise<GrowthFundRecent[]> {
  const [transfers, spent] = await Promise.all([
    getAddressTokenTransfers(GROWTH_FUND_BUYER, SLVR_TOKEN_ADDRESS, 1),
    getAddressNativeSpent(GROWTH_FUND_BUYER, 1),
  ]);
  return buildRecent(transfers, spent.valueByHash);
}

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
 * price for USD. All read-only, cached 5 min.
 */
import { withCache } from "./cache";
import { SLVR_TOKEN_ADDRESS } from "./labels";
import { ethCall, decodeUint256 } from "./rpc";
import { getAddressTokenTransfers, getAddressNativeSpent } from "./blockscout";
import { getMarketData } from "./dexscreener";

// The Growth Fund's on-market buyer wallet.
export const GROWTH_FUND_BUYER = "0xec8c0A41F4F8ff291E111DB988D266BBF3F4eE3a";
const LOTTERY_V2 = "0xB0Cc994Ce4E8fb106da9Eb36e26fDd8C5f1e0c71";
const CURRENT_ROUND_SEL = "0x9cbe5efd"; // currentRoundId()
const SLVR_PER_ROUND_TO_GF = 0.04; // 4% of the 1.12 SLVR minted per round
const CACHE_TTL = 300;

export interface GrowthFundPoint {
  t: string;
  bought: number;
}

export interface GrowthFundData {
  /** Cumulative SLVR bought back on-market and held (buyer never sells). */
  slvrBought: number;
  buyCount: number;
  /** Cumulative ETH spent buying back (funded by the fund's staking rewards). */
  ethDeployed: number;
  usdDeployed: number | null;
  /** SLVR earned from rounds = 0.04 × resolved rounds (the fund's minted income). */
  slvrEarned: number;
  roundId: number | null;
  avgIntervalSec: number | null;
  buysPerDay: number | null;
  /** Market SLVR/USD — USD value of the accumulated holdings. */
  slvrUsd: number | null;
  ethUsd: number | null;
  holdingsUsd: number | null;
  /** Cumulative-bought curve over time (downsampled). */
  series: GrowthFundPoint[];
  updatedAt: string;
}

function downsample<T>(arr: T[], max: number): T[] {
  if (arr.length <= max) return arr;
  const step = Math.ceil(arr.length / max);
  const out = arr.filter((_, i) => i % step === 0);
  if (out[out.length - 1] !== arr[arr.length - 1]) out.push(arr[arr.length - 1]);
  return out;
}

async function fetchGrowthFund(): Promise<GrowthFundData> {
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
  const buyCount = buys.length;

  // Cadence from the buy timestamps.
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
    buyCount,
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
    updatedAt: new Date().toISOString(),
  };
}

export async function getGrowthFundData(): Promise<GrowthFundData> {
  return withCache("growthfund:data", CACHE_TTL, fetchGrowthFund);
}

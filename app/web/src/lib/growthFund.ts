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
import { ethCall, ethGetBalance, decodeUint256 } from "./rpc";
import {
  getAddressTokenTransfers,
  getAddressNativeSpent,
  type AddressTransfer,
} from "./blockscout";
import { getMarketData } from "./dexscreener";

export const GROWTH_FUND_BUYER = "0xec8c0A41F4F8ff291E111DB988D266BBF3F4eE3a";
// The Growth Fund's ETH war chest — staking rewards accumulate here and are drawn
// down to fund on-market buybacks.
export const GROWTH_RECIPIENT = "0x4444479B89b684e79392924B3A70BE03733190dE";
const LOTTERY_V2 = "0xB0Cc994Ce4E8fb106da9Eb36e26fDd8C5f1e0c71";
const CURRENT_ROUND_SEL = "0x9cbe5efd"; // currentRoundId()
const SLVR_PER_ROUND_TO_GF = 0.04; // 4% of the 1.12 SLVR minted per round
// veSLVR staking rewards claimable on the Growth Fund's locked position (tokenId 2).
const STAKING = "0xaf68598ebd245dc3cb92ff16e9ba1814dd137200";
const GET_STAKER_REWARDS_SEL = "0x4e63ddf4"; // getStakerRewards(uint256)
const GF_STAKE_TOKEN_ID = 2n;

/** Undeployed ETH the Growth Fund can still spend on buybacks (war chest + claimable). */
export async function getEthWaiting(): Promise<{
  ethWaiting: number;
  recipientEth: number;
  buyerEth: number;
  claimableEth: number;
}> {
  const [grBal, buyerBal, rewardsHex] = await Promise.all([
    ethGetBalance(GROWTH_RECIPIENT).catch(() => 0n),
    ethGetBalance(GROWTH_FUND_BUYER).catch(() => 0n),
    ethCall(
      STAKING,
      GET_STAKER_REWARDS_SEL + GF_STAKE_TOKEN_ID.toString(16).padStart(64, "0")
    ).catch(() => null),
  ]);
  const recipientEth = Number(grBal) / 1e18;
  const buyerEth = Number(buyerBal) / 1e18;
  const claimableEth = rewardsHex ? Number(decodeUint256(rewardsHex)) / 1e18 : 0;
  return {
    ethWaiting: recipientEth + buyerEth + claimableEth,
    recipientEth,
    buyerEth,
    claimableEth,
  };
}

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
  /** ETH spent buying back over the trailing 24h. */
  deployed24hEth: number;
  deployed24hUsd: number | null;
  /** Undeployed ETH available to spend on buybacks (war chest + buyer + claimable). */
  ethWaiting: number;
  ethWaitingUsd: number | null;
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
  const [transfers, spent, roundHex, market, waiting] = await Promise.all([
    getAddressTokenTransfers(GROWTH_FUND_BUYER, SLVR_TOKEN_ADDRESS),
    getAddressNativeSpent(GROWTH_FUND_BUYER),
    ethCall(LOTTERY_V2, CURRENT_ROUND_SEL).catch(() => null),
    getMarketData().catch(() => null),
    getEthWaiting().catch(() => ({ ethWaiting: 0, recipientEth: 0, buyerEth: 0, claimableEth: 0 })),
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
  const deployed24hEth = Number(spent.spent24hRaw) / 1e18;
  const roundId = roundHex ? Number(decodeUint256(roundHex)) : null;
  const slvrEarned = roundId != null ? SLVR_PER_ROUND_TO_GF * roundId : 0;
  const ethUsd = market?.eth_usd ?? null;
  const slvrUsd = market?.slvr_usd ?? null;

  return {
    slvrBought,
    buyCount: buys.length,
    ethDeployed,
    usdDeployed: ethUsd ? ethDeployed * ethUsd : null,
    deployed24hEth,
    deployed24hUsd: ethUsd ? deployed24hEth * ethUsd : null,
    ethWaiting: waiting.ethWaiting,
    ethWaitingUsd: ethUsd ? waiting.ethWaiting * ethUsd : null,
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

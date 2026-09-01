/**
 * Current Grid Mining + permanent miner-vault snapshot via eth_call.
 *
 * currentRoundId()  0x9cbe5efd
 * jackpot()         0x6b31ee01 → jackpot contract address; ETH via eth_getBalance
 * minerIndex()      0x9806b4d2 → cumulative refining index (WAD, 1e18 = 1.0)
 * totalUnclaimed()  0xc96f14b8 → unclaimed mining rewards pool (SLVR)
 * totalRefined()    0x9ff953a0 → cumulative refined (SLVR)
 *
 * Grid Mining IS "mining": miners commit to grid cells; refining fees on
 * claims redistribute to remaining unclaimed holders. 30-second cache.
 */
import { withCache } from "./cache";
import {
  ethCall,
  ethGetBalance,
  decodeUint256,
  decodeAddress,
} from "./rpc";

const CURRENT_LOTTERY = "0xa1e5213505772B195FD7AE3b4a6b27B58Cf72A3D";
const MINER_VAULT = "0x2070b4B0c57EaF070CF86cD8321a6054f3D25260";

const CURRENT_ROUND_ID_SEL = "0x9cbe5efd";
const JACKPOT_SEL = "0x6b31ee01";
const MINER_INDEX_SEL = "0x9806b4d2";
const TOTAL_UNCLAIMED_SEL = "0xc96f14b8";
const TOTAL_REFINED_SEL = "0x9ff953a0";

const CACHE_TTL = 30;
const CACHE_KEY = "lottery:snapshot";

export interface LotteryData {
  roundId: number;
  jackpotAddress: string | null;
  minerStateAddress: string;
  jackpotEth: number;
  minerIndex: number; // human (WAD-scaled)
  minerIndexRaw: string;
  totalUnclaimedSlvr: number;
  totalRefinedSlvr: number;
  cachedAt: string;
  cacheTtlSeconds: number;
}

const WAD = 1e18;

async function fetchLottery(): Promise<LotteryData> {
  const [roundHex, jackpotHex, minerHex, unclaimedHex, refinedHex] =
    await Promise.all([
      ethCall(CURRENT_LOTTERY, CURRENT_ROUND_ID_SEL),
      ethCall(CURRENT_LOTTERY, JACKPOT_SEL).catch(() => "0x"),
      ethCall(MINER_VAULT, MINER_INDEX_SEL),
      ethCall(MINER_VAULT, TOTAL_UNCLAIMED_SEL),
      ethCall(MINER_VAULT, TOTAL_REFINED_SEL),
    ]);

  const roundId = Number(decodeUint256(roundHex));
  const minerIndexRaw = decodeUint256(minerHex);
  const totalUnclaimedSlvr = Number(decodeUint256(unclaimedHex)) / WAD;
  const totalRefinedSlvr = Number(decodeUint256(refinedHex)) / WAD;

  // Jackpot ETH = balance of the jackpot contract.
  let jackpotAddress: string | null = null;
  let jackpotWei = 0n;
  if (jackpotHex && jackpotHex !== "0x") {
    jackpotAddress = decodeAddress(jackpotHex);
    try {
      jackpotWei = await ethGetBalance(jackpotAddress);
    } catch {
      jackpotWei = 0n;
    }
  }

  return {
    roundId,
    jackpotAddress,
    minerStateAddress: MINER_VAULT,
    jackpotEth: Number(jackpotWei) / WAD,
    minerIndex: Number(minerIndexRaw) / WAD,
    minerIndexRaw: minerIndexRaw.toString(),
    totalUnclaimedSlvr,
    totalRefinedSlvr,
    cachedAt: new Date().toISOString(),
    cacheTtlSeconds: CACHE_TTL,
  };
}

export async function getLotteryData(): Promise<LotteryData> {
  return withCache(CACHE_KEY, CACHE_TTL, fetchLottery);
}

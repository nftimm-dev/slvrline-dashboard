/**
 * stakingApy.ts — veSLVR staking APY (ETH-reward yield on staked SLVR) at a block.
 *
 * Mirrors /api/staking-rewards EXACTLY, but sources the ETH↔SLVR price from the
 * on-chain SLVR/WETH V2 pool reserves (archival-readable) instead of Dexscreener,
 * so the whole series — live cron + historical backfill — is computed from purely
 * on-chain data and is internally consistent (no external price API with no history).
 *
 *   rpw = rewardPerWeightStored  (monotonic ETH-per-weight accumulator, ×1e18)
 *   Δrpw over window W = rpw(head) − rpw(head − W)
 *   APR(m) = (Δrpw/1e18) × (365/Wdays) × (SLVR per ETH) × m × 100
 *   SLVR per ETH = reserve_SLVR / reserve_WETH   (this IS ethUsd/slvrUsd)
 *   permanent m = 1 + (MMAX−1)·P                 (= 4.0)
 */
import { archivalCall, archivalGetBlock, decodeUint256 } from "../rpc";

const VE_ESCROW = "0xd9b8FBD61033145c5496132153CE675756313B71";
const VE_STAKING = "0xaF68598eBd245DC3cB92FF16E9Ba1814DD137200";
// SLVR/WETH V2 pair. Token order is by address: WETH 0x0bd7… < SLVR 0x7912…,
// so getReserves() returns reserve0 = WETH, reserve1 = SLVR.
const SLVR_WETH_PAIR = "0xe365b92239097eD3322131411dbe15A5c4068EFF";

const SEL = {
  TMAX: "0x545dcac3",
  MMAX: "0xc656e634",
  P: "0x8b8fbd92",
  rpw: "0x3228dd59", // rewardPerWeightStored()
  totalWeight: "0x96c82e57",
  getReserves: "0x0902f1ac", // getReserves() → (uint112 r0, uint112 r1, uint32 ts)
} as const;

const WAD = 1e18;
const BLOCKS_PER_DAY = 864_000n; // 100ms Robinhood Chain

const LOCK_CONFIGS: Array<{ key: string; days: number | null }> = [
  { key: "1day", days: 1 },
  { key: "1week", days: 7 },
  { key: "1month", days: 30 },
  { key: "4months", days: 120 },
  { key: "permanent", days: null },
];

export interface StakingApyResult {
  block: number;
  windowDays: number;
  deltaRpw: string;
  totalWeight: number;
  slvrPerEth: number;
  permanentMultiplier: number;
  /** APR% at the 1× (no-lock) multiplier. */
  baseAprPercent: number;
  /** Headline: APR% for a permanent lock. */
  permanentAprPercent: number;
  /** APR% keyed by lock length (1day/1week/1month/4months/permanent). */
  byLock: Record<string, number>;
}

/** SLVR-per-ETH from the SLVR/WETH pool reserves at `block`. */
async function slvrPerEthAt(block: bigint | "latest"): Promise<number> {
  const raw = await archivalCall(SLVR_WETH_PAIR, SEL.getReserves, block);
  if (!raw || raw.length < 2 + 64 * 2) return 0;
  const reserveWeth = BigInt("0x" + raw.slice(2, 66)); // reserve0
  const reserveSlvr = BigInt("0x" + raw.slice(66, 130)); // reserve1
  if (reserveWeth === 0n) return 0;
  return Number(reserveSlvr) / Number(reserveWeth);
}

/** Archival rpw read with ± block nudges (some archival blocks miss state). */
async function archivalRpw(block: bigint): Promise<bigint | null> {
  for (const delta of [0n, 5n, -5n, 15n, -15n, 50n, -50n]) {
    const b = block + delta;
    if (b <= 0n) continue;
    try {
      const val = decodeUint256(await archivalCall(VE_STAKING, SEL.rpw, b));
      if (val >= 0n) return val;
    } catch {
      // try next nudge
    }
  }
  return null;
}

/**
 * Compute the staking APY at `atBlock` (defaults to head). Returns null when the
 * rate can't be established — no distributions in the trailing window, or no pool
 * liquidity to price ETH (both expected for the earliest post-migration samples).
 */
export async function computeStakingApy(atBlock?: bigint): Promise<StakingApyResult | null> {
  const headBlock = atBlock ?? (await archivalGetBlock("latest"))?.number;
  if (!headBlock) return null;

  const [tmaxRaw, mmaxRaw, pRaw] = await Promise.all([
    archivalCall(VE_ESCROW, SEL.TMAX, headBlock).then(decodeUint256),
    archivalCall(VE_ESCROW, SEL.MMAX, headBlock).then(decodeUint256),
    archivalCall(VE_ESCROW, SEL.P, headBlock).then(decodeUint256),
  ]);
  const tmaxSeconds = Number(tmaxRaw);
  const mmax = Number(mmaxRaw) / WAD;
  const permanentFactor = Number(pRaw) / WAD;
  const permanentMultiplier = 1 + (mmax - 1) * permanentFactor;

  const [rpwHead, totalWeightRaw, slvrPerEth] = await Promise.all([
    archivalCall(VE_STAKING, SEL.rpw, headBlock).then(decodeUint256),
    archivalCall(VE_STAKING, SEL.totalWeight, headBlock).then(decodeUint256),
    slvrPerEthAt(headBlock),
  ]);
  const totalWeight = Number(totalWeightRaw) / WAD;
  if (slvrPerEth <= 0) return null;

  // Trailing window: 24h primary → 2d/3d/7d fallback if a quiet window had Δ=0.
  let windowDays = 0;
  let rpwOld = 0n;
  for (const days of [1, 2, 3, 7]) {
    const wBlocks = BigInt(days) * BLOCKS_PER_DAY;
    const candidate = headBlock > wBlocks ? headBlock - wBlocks : 1n;
    const r = await archivalRpw(candidate);
    if (r !== null && r < rpwHead) {
      windowDays = days;
      rpwOld = r;
      break;
    }
  }
  if (windowDays === 0) return null;

  const deltaRpw = rpwHead - rpwOld;
  const aprBaseScalar = (Number(deltaRpw) / 1e18) * (365 / windowDays) * slvrPerEth;

  const multForDays = (days: number): number =>
    1 + (mmax - 1) * (Math.min(days * 86400, tmaxSeconds) / tmaxSeconds);

  const byLock: Record<string, number> = {};
  for (const { key, days } of LOCK_CONFIGS) {
    const m = days === null ? permanentMultiplier : multForDays(days);
    byLock[key] = aprBaseScalar * m * 100;
  }

  return {
    block: Number(headBlock),
    windowDays,
    deltaRpw: deltaRpw.toString(),
    totalWeight,
    slvrPerEth,
    permanentMultiplier,
    baseAprPercent: aprBaseScalar * 100,
    permanentAprPercent: byLock.permanent,
    byLock,
  };
}

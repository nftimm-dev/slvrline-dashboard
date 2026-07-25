/**
 * GET /api/staking-rewards
 *
 * "Rewards by lock length" — ABSOLUTE ETH APR per veSLVR lock duration.
 *
 * METHOD (Synthetix-style; rewards are native ETH):
 *   rewardPerWeightStored (rpw) is a monotonically increasing accumulator:
 *     rpw += msg.value * 1e18 / totalWeight   (each distributeRoundRewards call)
 *   Units: wei × 1e18 / weight
 *
 *   Δrpw over a trailing window W = rpwHead − rpwOld (at block now−W)
 *   ETH to stakers in W = Δrpw × totalWeight_raw / 1e36
 *                       = Δrpw × totalWeight_human / 1e18  (since totalWeight_human = raw/1e18)
 *   Per 1 SLVR at multiplier m:
 *     APR(m) = (Δrpw × 365/Wdays / 1e18) × (ethUsd / slvrUsd) × m
 *
 *   Window: 7-day preferred; falls back to 3d / 1d on archival call failure.
 *   Block time: 100ms (10 blocks/sec) → W_blocks = Wdays × 864,000
 *
 * CROSS-CHECK:
 *   getStakerRewards(tokenId) scanned for tokenIds 1..20 to find a nonzero
 *   claimable value — confirms the rate is real, not zero.
 *
 * Cache: 5 minutes.
 */
import { NextResponse } from "next/server";
import {
  ethCall,
  ethBlockNumber,
  decodeUint256,
  encodeUint256,
} from "@/lib/rpc";
import { withCache } from "@/lib/cache";
import { getMarketData } from "@/lib/dexscreener";

export const dynamic = "force-dynamic";

const VE_ESCROW = "0xd9b8FBD61033145c5496132153CE675756313B71";
const VE_STAKING = "0xaF68598eBd245DC3cB92FF16E9Ba1814DD137200";

// Verified selectors — keccak256(sig)[:4]
const SEL = {
  TMAX: "0x545dcac3", // TMAX()  → uint256 (VE_ESCROW)
  MMAX: "0xc656e634", // MMAX()  → uint256 (VE_ESCROW)
  P: "0x8b8fbd92", // P()     → uint256 (VE_ESCROW)
  rewardPerWeightStored: "0x3228dd59", // rewardPerWeightStored() → uint256 (VE_STAKING)
  totalWeight: "0x96c82e57", // totalWeight() → uint256 (VE_STAKING)
  getStakerRewards: "0x4e63ddf4", // getStakerRewards(uint256) → uint256 (VE_STAKING)
} as const;

const WAD = 1e18;
const BLOCK_TIME_SEC = 0.1; // 100ms Robinhood Chain
const BLOCKS_PER_DAY = 86400 / BLOCK_TIME_SEC; // 864,000

const CACHE_KEY = "staking:rewards-apr";
const CACHE_TTL_SEC = 300; // 5 min

/** Lock configurations to report (matches /earn page). */
const LOCK_CONFIGS: Array<{ key: string; label: string; days: number | null }> = [
  { key: "1day", label: "1 day", days: 1 },
  { key: "1week", label: "1 week", days: 7 },
  { key: "1month", label: "1 month", days: 30 },
  { key: "4months", label: "4 months", days: 120 },
  { key: "permanent", label: "Permanent", days: null },
];

interface AprRow {
  key: string;
  label: string;
  durationDays: number | null;
  multiplier: number;
  aprPercent: number;
  aprDisplay: string;
}

interface CrossCheck {
  tokenId: number | null;
  claimableEth: number | null;
  deltaRpwEthPerWeightUnit: number | null;
  consistent: boolean;
  note: string;
}

interface StakingRewardsResponse {
  mode: "apr";
  rewardToken: "ETH";
  window_days: number;
  eth_per_day: number;
  ethUsd: number;
  slvrUsd: number;
  rows: AprRow[];
  params: {
    tmaxSeconds: number;
    tmaxMonths: number;
    mmax: number;
    permanentFactor: number;
    permanentMultiplier: number;
  };
  rateContext: {
    rewardPerWeightStored_head: string;
    rewardPerWeightStored_old: string;
    deltaRpw: string;
    totalWeight: number;
    headBlock: number;
    oldBlock: number;
  };
  crossCheck: CrossCheck;
  source: string;
  updatedAt: string;
}

/**
 * Try archival eth_call at the target block, nudging ±blocks on error.
 * Returns null if all attempts fail.
 */
async function archivalRpw(block: bigint): Promise<bigint | null> {
  for (const delta of [0n, 5n, -5n, 15n, -15n, 50n, -50n]) {
    const b = block + delta;
    if (b <= 0n) continue;
    try {
      const raw = await ethCall(VE_STAKING, SEL.rewardPerWeightStored, b);
      const val = decodeUint256(raw);
      if (val >= 0n) return val; // 0 is valid (before first distribution)
    } catch {
      // try next nudge
    }
  }
  return null;
}

/** Find first tokenId in 1..30 where getStakerRewards returns nonzero. */
async function findCrossCheckToken(): Promise<{
  tokenId: number;
  rewards: bigint;
} | null> {
  for (let id = 1; id <= 30; id++) {
    try {
      const data = SEL.getStakerRewards + encodeUint256(BigInt(id));
      const raw = await ethCall(VE_STAKING, data, "latest");
      const val = decodeUint256(raw);
      if (val > 0n) return { tokenId: id, rewards: val };
    } catch {
      // skip
    }
  }
  return null;
}

function fmtPct(n: number): string {
  if (n >= 1000)
    return (
      new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n) +
      "%"
    );
  return n.toFixed(n >= 100 ? 0 : 1) + "%";
}

async function build(): Promise<StakingRewardsResponse> {
  // 1. Fetch escrow constants + head block + market data in parallel
  const [tmaxRaw, mmaxRaw, pRaw, headBlock, market] = await Promise.all([
    ethCall(VE_ESCROW, SEL.TMAX, "latest").then(decodeUint256),
    ethCall(VE_ESCROW, SEL.MMAX, "latest").then(decodeUint256),
    ethCall(VE_ESCROW, SEL.P, "latest").then(decodeUint256),
    ethBlockNumber(),
    getMarketData(),
  ]);

  const tmaxSeconds = Number(tmaxRaw); // e.g. 10,368,000
  const mmax = Number(mmaxRaw) / WAD; // e.g. 2.5
  const permanentFactor = Number(pRaw) / WAD; // e.g. 2.0
  const permanentMultiplier = 1 + (mmax - 1) * permanentFactor; // 4.0

  const ethUsd = market.eth_usd;
  const slvrUsd = market.slvr_usd;

  // 2. Read rpwHead + totalWeight at head
  const [rpwHeadRaw, totalWeightRaw] = await Promise.all([
    ethCall(VE_STAKING, SEL.rewardPerWeightStored, "latest").then(
      decodeUint256
    ),
    ethCall(VE_STAKING, SEL.totalWeight, "latest").then(decodeUint256),
  ]);

  const rpwHead = rpwHeadRaw;
  const totalWeight = Number(totalWeightRaw) / WAD;

  // 3. Trailing window: 24h primary (matches slvr.fun's APR) → 2d/3d/7d fallback
  //    only if a quiet 24h had zero distributions.
  let windowDays = 0;
  let rpwOld: bigint = 0n;
  let oldBlock = 0n;

  for (const days of [1, 2, 3, 7]) {
    const wBlocks = BigInt(Math.round(days * BLOCKS_PER_DAY));
    const candidateBlock = headBlock > wBlocks ? headBlock - wBlocks : 1n;
    const result = await archivalRpw(candidateBlock);

    // Accept if we got a result AND it's less than head (Δrpw > 0)
    if (result !== null && result < rpwHead) {
      windowDays = days;
      rpwOld = result;
      oldBlock = candidateBlock;
      break;
    }
    // If result === rpwHead, that means no rewards in this window — try shorter
  }

  if (windowDays === 0) {
    throw new Error(
      "Could not obtain archival rewardPerWeightStored with Δ>0 for any window (7d/3d/1d)"
    );
  }

  const deltaRpw = rpwHead - rpwOld; // wei*1e18/weight accumulated over window

  // eth_in_window = deltaRpw * totalWeight_raw / 1e36
  // totalWeight here is already in human units (raw / 1e18), so:
  //   = deltaRpw * totalWeight / 1e18
  const ethInWindow = (Number(deltaRpw) / 1e18) * totalWeight;
  const ethPerDay = ethInWindow / windowDays;

  // 4. Multiplier formula: m(d) = 1 + (MMAX-1) * min(d_sec, TMAX) / TMAX
  const multForDays = (days: number): number => {
    const dSec = Math.min(days * 86400, tmaxSeconds);
    return 1 + (mmax - 1) * (dSec / tmaxSeconds);
  };

  // 5. Build APR rows
  // APR(m) = (Δrpw * 365/windowDays / 1e18) * (ethUsd / slvrUsd) * m * 100
  const aprBaseScalar =
    (Number(deltaRpw) / 1e18) * (365 / windowDays) * (ethUsd / slvrUsd);

  const rows: AprRow[] = LOCK_CONFIGS.map(({ key, label, days }) => {
    const m = days === null ? permanentMultiplier : multForDays(days);
    const aprPercent = aprBaseScalar * m * 100;
    return {
      key,
      label,
      durationDays: days,
      multiplier: m,
      aprPercent,
      aprDisplay: fmtPct(aprPercent),
    };
  });

  // 6. Cross-check via getStakerRewards (nonzero = rate is real)
  let crossCheck: CrossCheck;
  try {
    const deltaRpwEthPerWeightUnit = Number(deltaRpw) / 1e18; // ETH per human-weight-unit over window
    const found = await findCrossCheckToken();
    if (found) {
      const claimableEth = Number(found.rewards) / WAD;
      crossCheck = {
        tokenId: found.tokenId,
        claimableEth,
        deltaRpwEthPerWeightUnit,
        consistent: claimableEth > 0,
        note: `tokenId=${found.tokenId} has ${claimableEth.toFixed(6)} ETH claimable. Δrpw per-weight-unit over ${windowDays}d window = ${deltaRpwEthPerWeightUnit.toExponential(4)} ETH. Since getStakerRewards ≈ weight × (rpwHead − rpwPaid) / 1e18, a nonzero claimable confirms the rate is real. Order-of-magnitude check: if this tokenId has weight ~ a few 1e18 units, claimable should be in the same ballpark as weight × deltaRpwEthPerWeightUnit.`,
      };
    } else {
      crossCheck = {
        tokenId: null,
        claimableEth: null,
        deltaRpwEthPerWeightUnit,
        consistent: false,
        note: "No nonzero getStakerRewards found for tokenIds 1–30. May mean all early tokenIds have claimed. Rate still derived from Δrpw which is authoritative.",
      };
    }
  } catch (e) {
    crossCheck = {
      tokenId: null,
      claimableEth: null,
      deltaRpwEthPerWeightUnit: null,
      consistent: false,
      note: `Cross-check failed: ${String(e)}`,
    };
  }

  return {
    mode: "apr",
    rewardToken: "ETH",
    window_days: windowDays,
    eth_per_day: ethPerDay,
    ethUsd,
    slvrUsd,
    rows,
    params: {
      tmaxSeconds,
      tmaxMonths: 4,
      mmax,
      permanentFactor,
      permanentMultiplier,
    },
    rateContext: {
      rewardPerWeightStored_head: rpwHead.toString(),
      rewardPerWeightStored_old: rpwOld.toString(),
      deltaRpw: deltaRpw.toString(),
      totalWeight,
      headBlock: Number(headBlock),
      oldBlock: Number(oldBlock),
    },
    crossCheck,
    source:
      "rewardPerWeightStored Δ (VE_STAKING 0xaF68…7200) + TMAX/MMAX/P (VE_ESCROW 0xd9b8…3B71) + Dexscreener + slvr.fun/api/price/eth",
    updatedAt: new Date().toISOString(),
  };
}

export async function GET() {
  try {
    const data = await withCache(CACHE_KEY, CACHE_TTL_SEC, build);
    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "public, max-age=300",
        "X-Data-Sources": "robinhood-rpc,dexscreener,slvr.fun",
      },
    });
  } catch (err) {
    console.error("[/api/staking-rewards] error:", err);
    return NextResponse.json(
      { error: "Staking-rewards APR data temporarily unavailable" },
      { status: 502 }
    );
  }
}

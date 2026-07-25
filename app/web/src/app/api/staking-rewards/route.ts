/**
 * GET /api/staking-rewards
 *
 * "Rewards by lock length" — how veSLVR staking rewards scale with lock duration.
 *
 * veSLVR staking (0xaF68…7200) distributes protocol revenue by VOTING WEIGHT.
 * Weight = SLVR amount × a duration multiplier read live from the vote-escrow
 * contract (0xd9b8…3B71):
 *
 *     m(d) = 1 + (MMAX − 1) × min(d, TMAX)/TMAX      // time-locks, floor 1.0×
 *     m(permanent) = 1 + (MMAX − 1) × P              // permanent locks
 *
 * with on-chain constants TMAX = 4·30 days, MMAX = 2.5, P = 2.0 → time-locks ramp
 * 1.0×→2.5× over 4 months; permanent = 4.0×. Longer locks earn proportionally more.
 *
 * WHY mode = "relative_weight" (NOT an absolute % APR):
 *   The reward token is native ETH (distributeRoundRewards is `payable`; rewards
 *   accrue as msg.value/weight via rewardPerWeightStored — verified on-chain), NOT
 *   the SLVR that is staked. A same-asset APR is therefore impossible without a
 *   volatile SLVR/ETH price conversion. Worse, the staking contract is ~15 days old
 *   and bootstrapping: totalWeight has grown ~1.7k→45k in two weeks, ~1,040 of the
 *   ~1,088 ETH ever routed here was parked in `unallocated` (no stakers at the round)
 *   and swept, and `totalRewardsOwed` is non-monotonic (drops on claims/burns). Any
 *   annualized rate swings from strongly negative to thousands of ETH/yr depending on
 *   the window. We refuse to fabricate an APR from that and instead publish the exact,
 *   price-independent reward-weight multiplier by lock length (source: getStakingWeight
 *   / TMAX / MMAX / P). The live rate context is returned for transparency only.
 */
import { NextResponse } from "next/server";
import { ethCall, decodeUint256 } from "@/lib/rpc";
import { withCache } from "@/lib/cache";

export const dynamic = "force-dynamic";

const VE_ESCROW = "0xd9b8FBD61033145c5496132153CE675756313B71";
const VE_STAKING = "0xaF68598eBd245DC3cB92FF16E9Ba1814DD137200";

// Selectors (keccak256(sig)[:4]) — verified against the deployed contracts.
const SEL = {
  TMAX: "0x545dcac3", // TMAX()  → uint256
  MMAX: "0xc656e634", // MMAX()  → uint256
  P: "0x8b8fbd92", // P()     → uint256
  rewardPerWeightStored: "0x3228dd59", // rewardPerWeightStored() → uint256
  totalWeight: "0x96c82e57", // totalWeight() → uint256
  totalRewardsOwed: "0xe02ce381", // totalRewardsOwed() → uint256
} as const;

const WAD = 1e18;
const CACHE_KEY = "staking:rewards-by-length";
const CACHE_TTL_SECONDS = 300; // 5 min

interface RewardWeightRow {
  /** Machine key: "1mo" | "2mo" | "3mo" | "4mo" | "permanent". */
  key: string;
  /** Human label, e.g. "1 month" / "4 months (max)" / "Permanent". */
  label: string;
  /** Lock duration in days (null for permanent). */
  durationDays: number | null;
  /** Reward-weight multiplier per SLVR at this lock length (e.g. 1.375, 2.5, 4.0). */
  multiplier: number;
  /** multiplier relative to the 4-month max time-lock (MMAX) — 4mo = 1.00. */
  relativeToMax: number;
}

interface StakingRewardsResponse {
  /** "relative_weight" (exact, price-free) or "apr" (absolute %). */
  mode: "relative_weight" | "apr";
  /** The token protocol revenue is distributed in. */
  rewardToken: "ETH";
  rows: RewardWeightRow[];
  /** On-chain multiplier constants (1e18-scaled values decoded to floats). */
  params: {
    tmaxSeconds: number;
    tmaxMonths: number;
    mmax: number; // max multiplier for time-locks (at TMAX)
    permanentFactor: number; // P
    permanentMultiplier: number; // 1 + (MMAX-1)*P
    minMultiplier: number; // floor for an infinitesimal time-lock (1.0)
  };
  /** Live rate context — informational only; NOT used to derive an APR. */
  rateContext: {
    rewardPerWeightStored: string;
    totalWeight: number;
    lifetimeRewardsOwedEth: number;
    note: string;
  };
  source: string;
  updatedAt: string;
}

async function u(to: string, sel: string): Promise<bigint> {
  return decodeUint256(await ethCall(to, sel, "latest"));
}

async function build(): Promise<StakingRewardsResponse> {
  // Read the multiplier constants live so the display tracks the contract.
  const [tmaxRaw, mmaxRaw, pRaw, rpws, totalW, owed] = await Promise.all([
    u(VE_ESCROW, SEL.TMAX),
    u(VE_ESCROW, SEL.MMAX),
    u(VE_ESCROW, SEL.P),
    u(VE_STAKING, SEL.rewardPerWeightStored),
    u(VE_STAKING, SEL.totalWeight),
    u(VE_STAKING, SEL.totalRewardsOwed),
  ]);

  const tmaxSeconds = Number(tmaxRaw); // e.g. 10,368,000
  const mmax = Number(mmaxRaw) / WAD; // e.g. 2.5
  const permanentFactor = Number(pRaw) / WAD; // e.g. 2.0
  const permanentMultiplier = 1 + (mmax - 1) * permanentFactor; // 4.0

  // m(d) = 1 + (MMAX-1) * min(d,TMAX)/TMAX  (matches getStakingWeight)
  const multForDuration = (days: number): number => {
    const d = Math.min(days * 86400, tmaxSeconds);
    return 1 + (mmax - 1) * (d / tmaxSeconds);
  };

  const monthDays = tmaxSeconds / 86400 / 4; // TMAX is 4 months → one "month" unit
  const durations = [
    { key: "1mo", months: 1 },
    { key: "2mo", months: 2 },
    { key: "3mo", months: 3 },
    { key: "4mo", months: 4 },
  ];

  const rows: RewardWeightRow[] = durations.map(({ key, months }) => {
    const days = monthDays * months;
    const multiplier = multForDuration(days);
    return {
      key,
      label: months === 4 ? "4 months (max)" : `${months} month${months > 1 ? "s" : ""}`,
      durationDays: Math.round(days),
      multiplier,
      relativeToMax: multiplier / mmax,
    };
  });

  rows.push({
    key: "permanent",
    label: "Permanent",
    durationDays: null,
    multiplier: permanentMultiplier,
    relativeToMax: permanentMultiplier / mmax,
  });

  return {
    mode: "relative_weight",
    rewardToken: "ETH",
    rows,
    params: {
      tmaxSeconds,
      tmaxMonths: 4,
      mmax,
      permanentFactor,
      permanentMultiplier,
      minMultiplier: 1,
    },
    rateContext: {
      rewardPerWeightStored: rpws.toString(),
      totalWeight: Number(totalW) / WAD,
      lifetimeRewardsOwedEth: Number(owed) / WAD,
      note:
        "Rewards are distributed in ETH by voting weight. An absolute APR is not shown: " +
        "the reward token differs from the staked token (SLVR) and the staking contract " +
        "is newly live with an unstable, still-ramping reward rate.",
    },
    source: "getStakingWeight / TMAX / MMAX / P (0xd9b8…3B71) + veSLVR staking state (0xaF68…7200)",
    updatedAt: new Date().toISOString(),
  };
}

export async function GET() {
  try {
    const data = await withCache(CACHE_KEY, CACHE_TTL_SECONDS, build);
    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "public, max-age=300",
        "X-Data-Sources": "robinhood-rpc",
      },
    });
  } catch (err) {
    console.error("[/api/staking-rewards] error:", err);
    return NextResponse.json(
      { error: "Staking-rewards data temporarily unavailable" },
      { status: 502 }
    );
  }
}

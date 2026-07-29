/**
 * GET /api/earn
 *
 * "How can I earn the most?" — a ranked comparison of every way to earn on SLVR.
 *
 * TWO EARNING TRACKS, now both showing absolute % APR:
 *
 *  1. Mining Dividends (earn SLVR). Headline = the LIVE trailing-24h dividends_apr
 *     metric from metrics.metric_snapshots. Real SLVR APR — early and volatile.
 *
 *  2. veSLVR Staking (earn ETH). Absolute ETH/SLVR APR computed from a trailing
 *     window of rewardPerWeightStored delta (same method as /api/staking-rewards).
 *     Window: 7d → 3d → 1d fallback. Labelled with the window used.
 *
 * RANKING: now that both tracks show absolute %, we can rank all options together
 * by APR descending when both are available. When staking APR is unavailable, we
 * fall back to: dividends first, then staking by multiplier desc.
 *
 * Cache: 60s (bounded by DB snapshot cadence).
 */
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { withCache } from "@/lib/cache";
import { ethCall, ethBlockNumber, decodeUint256 } from "@/lib/rpc";
import { getMarketData } from "@/lib/dexscreener";

export const dynamic = "force-dynamic";

const VE_ESCROW = "0xd9b8FBD61033145c5496132153CE675756313B71";
const VE_STAKING = "0xaF68598eBd245DC3cB92FF16E9Ba1814DD137200";

const SEL = {
  TMAX: "0x545dcac3", // TMAX()  → uint256 (VE_ESCROW)
  MMAX: "0xc656e634", // MMAX()  → uint256 (VE_ESCROW)
  P: "0x8b8fbd92", // P()     → uint256 (VE_ESCROW)
  rewardPerWeightStored: "0x3228dd59", // rewardPerWeightStored() → uint256 (VE_STAKING)
  totalWeight: "0x96c82e57", // totalWeight() → uint256 (VE_STAKING)
} as const;

const WAD = 1e18;
const BLOCK_TIME_SEC = 0.1; // 100ms Robinhood Chain
const BLOCKS_PER_DAY = 86400 / BLOCK_TIME_SEC; // 864,000
const DEFAULT_TMAX_RAW = 120n * 86_400n;
const DEFAULT_MMAX_RAW = 2_500_000_000_000_000_000n;
const DEFAULT_P_RAW = 2_000_000_000_000_000_000n;

const CACHE_KEY = "earn:comparison";
const CACHE_TTL = 60;

type Asset = "SLVR" | "ETH";
type Reliability = "live_volatile" | "relative_weight";
type Track = "dividends" | "staking";

interface EarnOption {
  key: string;
  rank: number;
  track: Track;
  name: string;
  headline: {
    value: number | null;
    unit: "percent" | "multiplier";
    display: string;
  };
  asset: Asset;
  headlineNote: string;
  reliability: Reliability;
  reliabilityLabel: string;
  howTo: string;
  multiplier?: number;
  aprPercent?: number;
  durationDays?: number | null;
}

interface DividendsMeta {
  dataStatus?: string;
  windowDays?: number;
  [k: string]: unknown;
}

interface EarnResponse {
  options: EarnOption[];
  dividends: {
    aprPercent: number | null;
    dataStatus: string;
    snapshotAt: string | null;
    blockNumber: number | null;
  };
  staking: {
    tmaxMonths: number;
    mmax: number;
    permanentMultiplier: number;
    rewardToken: Asset;
    windowDays: number | null;
    ethPerDay: number | null;
  };
  caption: string;
  source: string;
  updatedAt: string;
  warnings?: string[];
}

type SourceResult<T> = {
  value: T;
  warning: string | null;
};

async function withFallback<T>(
  label: string,
  promise: Promise<T>,
  fallback: T
): Promise<SourceResult<T>> {
  try {
    return { value: await promise, warning: null };
  } catch (err) {
    console.error(`[/api/earn] ${label} unavailable:`, err);
    return { value: fallback, warning: label };
  }
}

function fmtPct(n: number): string {
  if (n >= 1000)
    return (
      new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n) +
      "%"
    );
  return n.toFixed(n >= 100 ? 0 : 1) + "%";
}

interface DividendsRow {
  value: string | null;
  snapshot_at: Date;
  block_number: string | null;
  metadata: DividendsMeta | null;
}

async function readDividends(): Promise<{
  aprPercent: number | null;
  dataStatus: string;
  snapshotAt: string | null;
  blockNumber: number | null;
}> {
  const db = getDb();
  const rows = await db<DividendsRow[]>`
    SELECT value, snapshot_at, block_number, metadata
    FROM metrics.metric_snapshots
    WHERE metric_name = 'dividends_apr'
      AND value IS NOT NULL
    ORDER BY snapshot_at DESC
    LIMIT 1
  `;
  if (rows.length === 0) {
    return {
      aprPercent: null,
      dataStatus: "no_data",
      snapshotAt: null,
      blockNumber: null,
    };
  }
  const r = rows[0];
  const meta = r.metadata ?? {};
  return {
    aprPercent: r.value !== null ? parseFloat(r.value) : null,
    dataStatus: (meta.dataStatus as string) ?? "ok",
    snapshotAt: r.snapshot_at.toISOString(),
    blockNumber:
      r.block_number !== null ? parseInt(r.block_number, 10) : null,
  };
}

interface LpRow {
  value: string | null;
  value2: string | null;
  value3: string | null;
  metadata: Record<string, unknown> | null;
  snapshot_at: Date;
}

/** Latest lp_staking_apr snapshot — blended + concentrated/full-range cohort APRs. */
async function readLpStaking(): Promise<{
  blendedApr: number | null;
  concentratedApr: number | null;
  fullRangeApr: number | null;
  rewardSlvrPerDay: number | null;
  stakedValueEth: number | null;
  positionCount: number | null;
}> {
  const db = getDb();
  const rows = await db<LpRow[]>`
    SELECT value, value2, value3, metadata, snapshot_at
    FROM metrics.metric_snapshots
    WHERE metric_name = 'lp_staking_apr' AND value IS NOT NULL
    ORDER BY snapshot_at DESC
    LIMIT 1
  `;
  if (rows.length === 0) {
    return { blendedApr: null, concentratedApr: null, fullRangeApr: null, rewardSlvrPerDay: null, stakedValueEth: null, positionCount: null };
  }
  const r = rows[0];
  const meta = r.metadata ?? {};
  return {
    blendedApr: r.value !== null ? parseFloat(r.value) : null,
    concentratedApr: r.value2 !== null ? parseFloat(r.value2) : null,
    fullRangeApr: r.value3 !== null ? parseFloat(r.value3) : null,
    rewardSlvrPerDay: typeof meta.reward_slvr_per_day === "number" ? meta.reward_slvr_per_day : null,
    stakedValueEth: typeof meta.staked_value_eth === "number" ? meta.staked_value_eth : null,
    positionCount: typeof meta.position_count === "number" ? meta.position_count : null,
  };
}

interface StakingAprResult {
  windowDays: number;
  aprBaseScalar: number; // multiply by m*100 to get APR%
  ethPerDay: number;
  ethUsd: number;
  slvrUsd: number;
  totalWeight: number;
}

/**
 * Compute the staking APR base scalar from Δrpw over a trailing window.
 * Returns null if archival calls fail or Δrpw = 0.
 */
async function computeStakingApr(
  headBlock: bigint,
  rpwHead: bigint,
  totalWeight: number,
  market: { eth_usd: number; slvr_usd: number }
): Promise<StakingAprResult | null> {
  for (const days of [1, 2, 3, 7]) {
    const wBlocks = BigInt(Math.round(days * BLOCKS_PER_DAY));
    const oldBlock = headBlock > wBlocks ? headBlock - wBlocks : 1n;

    // Try exact block + nudge ±5, ±15, ±50 blocks for archival quirks
    let rpwOld: bigint | null = null;
    for (const delta of [0n, 5n, -5n, 15n, -15n, 50n, -50n]) {
      const b = oldBlock + delta;
      if (b <= 0n) continue;
      try {
        const raw = await ethCall(VE_STAKING, SEL.rewardPerWeightStored, b);
        const val = decodeUint256(raw);
        if (val < rpwHead) {
          rpwOld = val;
          break;
        }
      } catch {
        // try next nudge
      }
    }

    if (rpwOld !== null) {
      const deltaRpw = rpwHead - rpwOld;
      // totalWeight is human units (raw/1e18), so eth_in_window = deltaRpw * totalWeight / 1e18
      const ethInWindow = (Number(deltaRpw) / 1e18) * totalWeight;
      const ethPerDay = ethInWindow / days;
      const aprBaseScalar =
        (Number(deltaRpw) / 1e18) *
        (365 / days) *
        (market.eth_usd / market.slvr_usd);
      return {
        windowDays: days,
        aprBaseScalar,
        ethPerDay,
        ethUsd: market.eth_usd,
        slvrUsd: market.slvr_usd,
        totalWeight,
      };
    }
  }
  return null;
}

function u(sel: string): Promise<bigint> {
  return ethCall(VE_ESCROW, sel, "latest").then(decodeUint256);
}

async function build(): Promise<EarnResponse> {
  const [
    dividendsResult,
    lpStakingResult,
    tmaxResult,
    mmaxResult,
    pResult,
    marketResult,
  ] = await Promise.all([
    withFallback("dividends snapshot", readDividends(), {
      aprPercent: null,
      dataStatus: "unavailable",
      snapshotAt: null,
      blockNumber: null,
    }),
    withFallback("lp staking snapshot", readLpStaking(), {
      blendedApr: null,
      concentratedApr: null,
      fullRangeApr: null,
      rewardSlvrPerDay: null,
      stakedValueEth: null,
      positionCount: null,
    }),
    withFallback("TMAX", u(SEL.TMAX), DEFAULT_TMAX_RAW),
    withFallback("MMAX", u(SEL.MMAX), DEFAULT_MMAX_RAW),
    withFallback("P", u(SEL.P), DEFAULT_P_RAW),
    withFallback<Awaited<ReturnType<typeof getMarketData>> | null>(
      "market data",
      getMarketData(),
      null
    ),
  ]);

  const warnings = [
    dividendsResult.warning,
    lpStakingResult.warning,
    tmaxResult.warning,
    mmaxResult.warning,
    pResult.warning,
    marketResult.warning,
  ].filter((warning): warning is string => warning !== null);
  const dividends = dividendsResult.value;
  const lpStaking = lpStakingResult.value;
  const tmaxRaw = tmaxResult.value;
  const mmaxRaw = mmaxResult.value;
  const pRaw = pResult.value;
  const market = marketResult.value;

  const tmaxSeconds = Number(tmaxRaw);
  const mmax = Number(mmaxRaw) / WAD; // 2.5
  const permanentFactor = Number(pRaw) / WAD; // 2.0
  const permanentMultiplier = 1 + (mmax - 1) * permanentFactor; // 4.0
  const tmaxMonths = Math.round(tmaxSeconds / 86400 / 30);

  // Multiplier formula
  const multForDays = (days: number): number => {
    const dSec = Math.min(days * 86400, tmaxSeconds);
    return 1 + (mmax - 1) * (dSec / tmaxSeconds);
  };

  let stakingApr: StakingAprResult | null = null;
  if (market && market.slvr_usd > 0 && market.eth_usd > 0) {
    const [headBlockResult, rpwHeadResult, totalWeightResult] =
      await Promise.all([
        withFallback<bigint | null>("head block", ethBlockNumber(), null),
        withFallback<bigint | null>(
          "staking reward accumulator",
          ethCall(VE_STAKING, SEL.rewardPerWeightStored, "latest").then(
            decodeUint256
          ),
          null
        ),
        withFallback<bigint | null>(
          "staking total weight",
          ethCall(VE_STAKING, SEL.totalWeight, "latest").then(decodeUint256),
          null
        ),
      ]);
    for (const warning of [
      headBlockResult.warning,
      rpwHeadResult.warning,
      totalWeightResult.warning,
    ]) {
      if (warning) warnings.push(warning);
    }
    const totalWeight =
      totalWeightResult.value !== null
        ? Number(totalWeightResult.value) / WAD
        : 0;
    if (
      headBlockResult.value !== null &&
      rpwHeadResult.value !== null &&
      totalWeight > 0
    ) {
      try {
        stakingApr = await computeStakingApr(
          headBlockResult.value,
          rpwHeadResult.value,
          totalWeight,
          market
        );
      } catch (err) {
        console.error("[/api/earn] staking APR unavailable:", err);
        warnings.push("staking APR");
      }
    }
  } else {
    warnings.push("staking market inputs");
  }

  // Lock length definitions
  const stakeDefs: Array<{
    key: string;
    name: string;
    days: number | null;
    howTo: string;
  }> = [
    {
      key: "stake_permanent",
      name: "Stake — Permanent",
      days: null,
      howTo:
        "Lock SLVR permanently (a permanent veSLVR lock). This earns the maximum reward weight and the biggest share of ETH revenue — but the SLVR is burned and never comes back.",
    },
    {
      key: "stake_4mo",
      name: "Stake — 4 months",
      days: 120,
      howTo:
        "Lock SLVR for 4 months — the maximum time-lock. Earns the top time-locked reward weight; the lock decays toward unlock, then you can withdraw the SLVR.",
    },
    {
      key: "stake_1mo",
      name: "Stake — 1 month",
      days: 30,
      howTo:
        "Lock SLVR for 1 month. A moderate reward weight for a short commitment; unlocks after ~30 days.",
    },
    {
      key: "stake_1week",
      name: "Stake — 1 week",
      days: 7,
      howTo:
        "Lock SLVR for 1 week. Low reward weight, barely above the 1.0× floor, but only a 7-day commitment.",
    },
    {
      key: "stake_1day",
      name: "Stake — 1 day",
      days: 1,
      howTo:
        "Lock SLVR for 1 day. The shortest lock — reward weight is essentially the 1.0× floor. Useful mainly to participate, not to maximise ETH.",
    },
  ];

  const stakeOptions: Omit<EarnOption, "rank">[] = stakeDefs.map((s) => {
    const m = s.days === null ? permanentMultiplier : multForDays(s.days);
    const aprPercent = stakingApr ? stakingApr.aprBaseScalar * m * 100 : null;
    const hasApr = aprPercent !== null;

    return {
      key: s.key,
      track: "staking",
      name: s.name,
      headline: {
        value: hasApr ? aprPercent : m,
        unit: hasApr ? "percent" : "multiplier",
        display: hasApr ? fmtPct(aprPercent!) : `${m.toFixed(2)}×`,
      },
      asset: "ETH",
      headlineNote: hasApr
        ? `${stakingApr!.windowDays}d trailing APR · paid in ETH`
        : "reward weight · paid in ETH",
      reliability: "live_volatile",
      reliabilityLabel: hasApr
        ? `live · volatile · ${stakingApr!.windowDays}d window`
        : "relative weight",
      howTo: s.howTo,
      multiplier: m,
      aprPercent: aprPercent ?? undefined,
      durationDays: s.days,
    };
  });

  // Dividends option (SLVR track)
  const divVolatile =
    dividends.dataStatus !== "ok" || dividends.aprPercent === null;
  const dividendsOption: Omit<EarnOption, "rank"> = {
    key: "mining_dividends",
    track: "dividends",
    name: "Mining Dividends",
    headline: {
      value: dividends.aprPercent,
      unit: "percent",
      display:
        dividends.aprPercent !== null ? fmtPct(dividends.aprPercent) : "—",
    },
    asset: "SLVR",
    headlineNote:
      dividends.aprPercent !== null
        ? "trailing-24h APR · paid in SLVR"
        : "APR unavailable · paid in SLVR",
    reliability: "live_volatile",
    reliabilityLabel: divVolatile ? "live · early/volatile" : "live · volatile",
    howTo:
      "Mine — play Grid Mining — and DON'T claim your rewards. A refining fee taken from other miners' claims is redistributed to everyone still holding unclaimed rewards. Sitting on your unclaimed pile is what earns the dividend.",
  };

  // LP staking options (Uniswap V4 position staking — SLVR from the sell tax),
  // split by range type: rewards are per unit of liquidity, so a concentrated
  // range packs more liquidity per dollar and earns a higher APR than full-range.
  const lpHow =
    "Provide liquidity to the SLVR/ETH Uniswap V4 pool (the one with the SLVR hook) and stake your position NFT on the SLVR site. You earn a share of the 2% sell tax as SLVR, split across stakers by liquidity. Volume-dependent — the rate moves with selling.";
  const lpConcentratedOption: Omit<EarnOption, "rank"> | null =
    lpStaking.concentratedApr !== null
      ? {
          key: "lp_concentrated",
          track: "staking",
          name: "LP Staking — concentrated",
          headline: { value: lpStaking.concentratedApr, unit: "percent", display: fmtPct(lpStaking.concentratedApr) },
          asset: "SLVR",
          headlineNote: "tight range · most reward per $ · paid in SLVR",
          reliability: "live_volatile",
          reliabilityLabel: "live · volatile · new pool",
          howTo: `${lpHow} A CONCENTRATED range (tight around the current price) packs the most liquidity per dollar, so it earns the highest APR — but it needs active management and stops earning if price leaves the range.`,
          aprPercent: lpStaking.concentratedApr,
        }
      : null;
  const lpFullRangeOption: Omit<EarnOption, "rank"> | null =
    lpStaking.fullRangeApr !== null
      ? {
          key: "lp_fullrange",
          track: "staking",
          name: "LP Staking — full-range",
          headline: { value: lpStaking.fullRangeApr, unit: "percent", display: fmtPct(lpStaking.fullRangeApr) },
          asset: "SLVR",
          headlineNote: "always in range · lower APR · paid in SLVR",
          reliability: "live_volatile",
          reliabilityLabel: "live · volatile · new pool",
          howTo: `${lpHow} A FULL-RANGE position always earns but spreads liquidity thin, so its APR is lower — set-and-forget.`,
          aprPercent: lpStaking.fullRangeApr,
        }
      : null;
  const lpOptions = [lpConcentratedOption, lpFullRangeOption].filter(
    (o): o is Omit<EarnOption, "rank"> => o !== null
  );

  // Ranking: sort all by APR value descending when both tracks have absolute APRs.
  // Fall back to dividends-first + staking-by-multiplier when staking APR unavailable.
  const allOptions: Omit<EarnOption, "rank">[] = [
    dividendsOption,
    ...lpOptions,
    ...stakeOptions,
  ];

  let ordered: Omit<EarnOption, "rank">[];
  const canRankByApr = stakingApr !== null;

  if (canRankByApr) {
    // Both tracks now in comparable % terms — sort globally by value desc.
    ordered = [...allOptions].sort((a, b) => {
      const aVal =
        a.headline.unit === "percent" ? (a.headline.value ?? 0) : 0;
      const bVal =
        b.headline.unit === "percent" ? (b.headline.value ?? 0) : 0;
      return bVal - aVal;
    });
  } else {
    // Fallback: dividends first, staking by multiplier desc
    const stakingRanked = [...stakeOptions].sort(
      (a, b) => (b.multiplier ?? 0) - (a.multiplier ?? 0)
    );
    ordered = [
      dividendsOption,
      ...lpOptions,
      ...stakingRanked,
    ];
  }

  const options: EarnOption[] = ordered.map((o, i) => ({ ...o, rank: i + 1 }));

  const lpNote =
    lpStaking.blendedApr !== null
      ? `LP staking (stake a Uniswap V4 SLVR/ETH position) earns a share of the 2% sell tax — ~${lpStaking.rewardSlvrPerDay?.toFixed(1) ?? "?"} SLVR/day across ${lpStaking.positionCount ?? "?"} positions (~${lpStaking.stakedValueEth?.toFixed(1) ?? "?"} ETH), valued exactly per-position. Rewards are per unit of liquidity, so a concentrated range earns more than full-range — shown as two rows. Volume-dependent + young pool, so treat as an estimate. `
      : "";
  const caption = stakingApr
    ? `Mining Dividends pay in SLVR; veSLVR staking pays in ETH; LP staking pays in SLVR — all shown as absolute % APR on trailing windows. ETH/SLVR ratio is embedded in the staking APR (~${stakingApr.ethPerDay.toFixed(1)} ETH/day to stakers). ${lpNote}All are early and volatile; rankings will shift. SLVR and ETH are different assets — consider every track.`
    : "Mining Dividends pays in SLVR; staking pays in ETH — different assets with different reliability. Staking APR temporarily unavailable; showing reward-weight multiplier instead. Rankings will update automatically.";

  return {
    options,
    dividends,
    staking: {
      tmaxMonths: tmaxMonths || 4,
      mmax,
      permanentMultiplier,
      rewardToken: "ETH",
      windowDays: stakingApr?.windowDays ?? null,
      ethPerDay: stakingApr?.ethPerDay ?? null,
    },
    caption,
    source:
      "dividends_apr snapshot (metrics.metric_snapshots) + rewardPerWeightStored Δ (0xaF68…7200) + TMAX/MMAX/P (0xd9b8…3B71) + Dexscreener + slvr.fun/api/price/eth",
    updatedAt: new Date().toISOString(),
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

export async function GET() {
  try {
    const data = await withCache(CACHE_KEY, CACHE_TTL, build);
    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "no-store",
        "X-Data-Sources": "postgres,robinhood-rpc,dexscreener",
      },
    });
  } catch (err) {
    console.error("[/api/earn] error:", err);
    return NextResponse.json(
      { error: "Earn comparison temporarily unavailable" },
      { status: 502 }
    );
  }
}

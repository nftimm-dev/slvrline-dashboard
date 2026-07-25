/**
 * GET /api/earn
 *
 * "How can I earn the most?" — a ranked comparison of every way to earn on SLVR.
 *
 * TWO EARNING TRACKS, deliberately NOT collapsed into one fake number:
 *
 *  1. Mining Dividends (earn SLVR). Headline = the LIVE trailing-24h dividends_apr
 *     metric, read from the same precomputed snapshot the vitals strip uses
 *     (metrics.metric_snapshots). This is a real, live SLVR APR — but early and
 *     volatile (24h trailing on a young accumulator), so it is tagged as such. We do
 *     NOT recompute or alter the APR here; we read the exact stored value.
 *
 *  2. veSLVR Staking (earn ETH). Locks earn protocol revenue paid in ETH, distributed
 *     by voting weight. Weight scales with lock length via the on-chain multiplier
 *         m(d) = 1 + (MMAX-1)·min(d, TMAX)/TMAX     (permanent = 1 + (MMAX-1)·P)
 *     read live from the vote-escrow contract (TMAX/MMAX/P). We publish the exact
 *     reward-WEIGHT multiplier per lock length (×N.NN). We deliberately DO NOT show an
 *     ETH % APR: the reward asset (ETH) differs from the staked asset (SLVR) and the
 *     staking contract is newly live / bootstrapping, so any annualised ETH rate is
 *     not reliable. This matches /api/staking-rewards exactly.
 *
 * RANKING: highest earning potential first. Because the two tracks are different
 * assets with different reliability, we rank by within-track attractiveness and label
 * each row's asset + reliability so the comparison is honest, not apples-to-oranges:
 *   - Mining Dividends is featured as the top SLVR yield (live % APR).
 *   - Staking rows rank by multiplier desc: Permanent (4.0×) > 4mo (2.5×) > 1mo
 *     (1.375×) > 1week (~1.09×) > 1day (~1.01×).
 *
 * Cache: 60s (bounded by the DB snapshot cadence; staking constants change rarely).
 */
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { withCache } from "@/lib/cache";
import { ethCall, decodeUint256 } from "@/lib/rpc";

export const dynamic = "force-dynamic";

const VE_ESCROW = "0xd9b8FBD61033145c5496132153CE675756313B71";

// Selectors — verified against the deployed vote-escrow contract (match staking-rewards).
const SEL = {
  TMAX: "0x545dcac3", // TMAX()  → uint256 (seconds)
  MMAX: "0xc656e634", // MMAX()  → uint256 (WAD)
  P: "0x8b8fbd92", // P()     → uint256 (WAD)
} as const;

const WAD = 1e18;
const CACHE_KEY = "earn:comparison";
const CACHE_TTL = 60;

type Asset = "SLVR" | "ETH";
type Reliability = "live_volatile" | "relative_weight";
type Track = "dividends" | "staking";

interface EarnOption {
  /** Stable machine key. */
  key: string;
  /** Rank, 1 = highest earning potential. */
  rank: number;
  track: Track;
  /** Display name. */
  name: string;
  /** The single headline figure to render big. */
  headline: {
    /** Numeric value (percent for dividends, multiplier for staking). */
    value: number | null;
    /** "percent" | "multiplier". */
    unit: "percent" | "multiplier";
    /** Pre-formatted display string, e.g. "4,012%" or "4.00×". */
    display: string;
  };
  /** What the reward is paid in. */
  asset: Asset;
  /** Small explanatory suffix for the headline, e.g. "APR, paid in SLVR". */
  headlineNote: string;
  /** Reliability tag. */
  reliability: Reliability;
  reliabilityLabel: string;
  /** Plain-English how-to. */
  howTo: string;
  /** For staking rows: the raw multiplier (== headline for staking). */
  multiplier?: number;
  /** For staking rows: lock duration in days (null for permanent). */
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
  };
  /** Honest caption about comparability. */
  caption: string;
  source: string;
  updatedAt: string;
}

function fmtPct(n: number): string {
  if (n >= 1000)
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n) + "%";
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
    return { aprPercent: null, dataStatus: "no_data", snapshotAt: null, blockNumber: null };
  }
  const r = rows[0];
  const meta = r.metadata ?? {};
  return {
    aprPercent: r.value !== null ? parseFloat(r.value) : null,
    dataStatus: (meta.dataStatus as string) ?? "ok",
    snapshotAt: r.snapshot_at.toISOString(),
    blockNumber: r.block_number !== null ? parseInt(r.block_number, 10) : null,
  };
}

async function u(sel: string): Promise<bigint> {
  return decodeUint256(await ethCall(VE_ESCROW, sel, "latest"));
}

async function build(): Promise<EarnResponse> {
  const [dividends, tmaxRaw, mmaxRaw, pRaw] = await Promise.all([
    readDividends(),
    u(SEL.TMAX),
    u(SEL.MMAX),
    u(SEL.P),
  ]);

  const tmaxSeconds = Number(tmaxRaw); // e.g. 10,368,000 (4 months)
  const mmax = Number(mmaxRaw) / WAD; // e.g. 2.5
  const permanentFactor = Number(pRaw) / WAD; // e.g. 2.0
  const permanentMultiplier = 1 + (mmax - 1) * permanentFactor; // 4.0
  const tmaxMonths = Math.round(tmaxSeconds / 86400 / 30);

  // m(d) = 1 + (MMAX-1) * min(d, TMAX)/TMAX  — matches getStakingWeight / staking-rewards.
  const multForDays = (days: number): number => {
    const d = Math.min(days * 86400, tmaxSeconds);
    return 1 + (mmax - 1) * (d / tmaxSeconds);
  };

  // The specific lock lengths the /earn page compares.
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
    return {
      key: s.key,
      track: "staking",
      name: s.name,
      headline: {
        value: m,
        unit: "multiplier",
        display: `${m.toFixed(2)}×`,
      },
      asset: "ETH",
      headlineNote: "reward weight · paid in ETH",
      reliability: "relative_weight",
      reliabilityLabel: "relative weight",
      howTo: s.howTo,
      multiplier: m,
      durationDays: s.days,
    };
  });

  // Dividends option (SLVR track).
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

  // Rank: Mining Dividends featured first (top SLVR yield), then staking by
  // multiplier descending (Permanent > 4mo > 1mo > 1week > 1day).
  const stakingRanked = [...stakeOptions].sort(
    (a, b) => (b.multiplier ?? 0) - (a.multiplier ?? 0)
  );
  const ordered = [dividendsOption, ...stakingRanked];
  const options: EarnOption[] = ordered.map((o, i) => ({ ...o, rank: i + 1 }));

  return {
    options,
    dividends,
    staking: {
      tmaxMonths: tmaxMonths || 4,
      mmax,
      permanentMultiplier,
      rewardToken: "ETH",
    },
    caption:
      "Mining Dividends pays in SLVR; staking pays in ETH — different assets with different reliability, so these are not directly comparable. This ranks earning potential within each track: the live (early, volatile) SLVR dividend APR, and the exact ETH reward-weight multiplier by lock length. No ETH % APR is shown because the staking rate is newly live and not reliably annualizable.",
    source:
      "dividends_apr snapshot (metrics.metric_snapshots) + getStakingWeight / TMAX / MMAX / P (0xd9b8…3B71)",
    updatedAt: new Date().toISOString(),
  };
}

export async function GET() {
  try {
    const data = await withCache(CACHE_KEY, CACHE_TTL, build);
    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "no-store",
        "X-Data-Sources": "postgres,robinhood-rpc",
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

/**
 * Markets aggregation for the /markets page.
 *
 * Reuses the Dexscreener token endpoint (same source as lib/dexscreener.ts) but
 * returns a richer, page-oriented shape: per-pair rows, liquidity-by-venue
 * rollup, and headline totals. 60-second in-process cache.
 */
import { withCache } from "./cache";
import { SLVR_TOKEN_ADDRESS } from "./labels";

const DEXSCREENER_URL = `https://api.dexscreener.com/latest/dex/tokens/${SLVR_TOKEN_ADDRESS}`;
const CACHE_TTL = 60;
const CACHE_KEY = "markets:page";

// Raw Dexscreener pair (partial).
interface DexPair {
  pairAddress?: string;
  dexId?: string;
  labels?: string[];
  baseToken?: { symbol?: string };
  quoteToken?: { symbol?: string };
  priceUsd?: string;
  liquidity?: { usd?: number | null };
  volume?: { h24?: number | null };
  fdv?: number | null;
  url?: string;
}

interface DexResponse {
  pairs?: DexPair[] | null;
}

export interface MarketPair {
  pairAddress: string;
  dexId: string;
  /** Human venue label, e.g. "Uniswap v4". */
  venue: string;
  pair: string; // "SLVR/WETH"
  priceUsd: number;
  liquidityUsd: number;
  volume24h: number;
  url: string;
}

export interface VenueLiquidity {
  venue: string;
  liquidityUsd: number;
  volume24h: number;
  poolCount: number;
}

export interface MarketsData {
  totalLiquidityUsd: number;
  totalVolume24h: number;
  poolCount: number;
  /** Price of the deepest (highest-liquidity) pool. */
  priceUsd: number;
  primaryVenue: string | null;
  pairs: MarketPair[];
  byVenue: VenueLiquidity[];
  cachedAt: string;
  cacheTtlSeconds: number;
}

function titleCase(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}

/** "uniswap" + ["v4"] → "Uniswap v4". */
function venueLabel(dexId: string, labels?: string[]): string {
  const base = titleCase(dexId || "unknown");
  const tag = labels && labels.length ? labels.join(" ") : "";
  return tag ? `${base} ${tag}` : base;
}

async function fetchMarkets(): Promise<MarketsData> {
  const res = await fetch(DEXSCREENER_URL, {
    signal: AbortSignal.timeout(9000),
    headers: { "User-Agent": "slvrline-dashboard/1.0" },
  });
  if (!res.ok) throw new Error(`Dexscreener fetch failed: ${res.status}`);
  const data = (await res.json()) as DexResponse;
  const rawPairs = data.pairs ?? [];

  const pairs: MarketPair[] = rawPairs
    .filter((p) => p.pairAddress && p.priceUsd && parseFloat(p.priceUsd) > 0)
    .map((p) => ({
      pairAddress: p.pairAddress as string,
      dexId: p.dexId ?? "unknown",
      venue: venueLabel(p.dexId ?? "unknown", p.labels),
      pair: `${p.baseToken?.symbol ?? "?"}/${p.quoteToken?.symbol ?? "?"}`,
      priceUsd: parseFloat(p.priceUsd as string),
      liquidityUsd: p.liquidity?.usd ?? 0,
      volume24h: p.volume?.h24 ?? 0,
      url:
        p.url ??
        `https://dexscreener.com/robinhood/${(p.pairAddress as string).toLowerCase()}`,
    }))
    .sort((a, b) => b.liquidityUsd - a.liquidityUsd);

  const totalLiquidityUsd = pairs.reduce((s, p) => s + p.liquidityUsd, 0);
  const totalVolume24h = pairs.reduce((s, p) => s + p.volume24h, 0);

  // Roll up by venue.
  const venueMap = new Map<string, VenueLiquidity>();
  for (const p of pairs) {
    const cur =
      venueMap.get(p.venue) ??
      { venue: p.venue, liquidityUsd: 0, volume24h: 0, poolCount: 0 };
    cur.liquidityUsd += p.liquidityUsd;
    cur.volume24h += p.volume24h;
    cur.poolCount += 1;
    venueMap.set(p.venue, cur);
  }
  const byVenue = [...venueMap.values()].sort(
    (a, b) => b.liquidityUsd - a.liquidityUsd
  );

  const primary = pairs[0];

  return {
    totalLiquidityUsd,
    totalVolume24h,
    poolCount: pairs.length,
    priceUsd: primary?.priceUsd ?? 0,
    primaryVenue: primary?.venue ?? null,
    pairs,
    byVenue,
    cachedAt: new Date().toISOString(),
    cacheTtlSeconds: CACHE_TTL,
  };
}

export async function getMarketsData(): Promise<MarketsData> {
  return withCache(CACHE_KEY, CACHE_TTL, fetchMarkets);
}

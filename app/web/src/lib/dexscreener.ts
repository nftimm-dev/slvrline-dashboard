/**
 * Dexscreener + ETH price proxy with 60-second in-process TTL.
 *
 * Sources:
 *   - https://api.dexscreener.com/latest/dex/tokens/0x791229E3EbD6CFdC3D8157f48722684173C29aD9
 *   - https://slvr.fun/api/price/eth  → { "price": "2530.12" }
 */
import { withCache } from "./cache";
import { SLVR_TOKEN_ADDRESS } from "./labels";

const DEXSCREENER_URL = `https://api.dexscreener.com/latest/dex/tokens/${SLVR_TOKEN_ADDRESS}`;
const ETH_PRICE_URL = "https://slvr.fun/api/price/eth";

// 60-second cache TTL for all market data
const MARKET_CACHE_TTL = 60;
const CACHE_KEY = "market:dexscreener";

export interface PoolInfo {
  pair_address: string;
  dex: string;
  base_token: string;
  quote_token: string;
  price_usd: number;
  liquidity_usd: number;
  volume_24h_usd: number;
  fdv_usd: number;
}

export interface MarketData {
  slvr_usd: number;
  slvr_eth: number;
  eth_usd: number;
  total_liquidity_usd: number;
  pool_count: number;
  pools: PoolInfo[];
  primary_pool: string;
  cached_at: string;
  cache_ttl_seconds: number;
}

// Raw Dexscreener pair shape (partial — only fields we use)
interface DexPair {
  pairAddress?: string;
  dexId?: string;
  labels?: string[];
  baseToken?: { symbol?: string };
  quoteToken?: { symbol?: string };
  priceUsd?: string;
  priceNative?: string;
  liquidity?: { usd?: number };
  volume?: { h24?: number };
  fdv?: number;
}

interface DexscreenerResponse {
  pairs?: DexPair[] | null;
}

async function fetchEthPrice(): Promise<number> {
  const res = await fetch(ETH_PRICE_URL, {
    signal: AbortSignal.timeout(3500),
    headers: { "User-Agent": "slvrline-dashboard/1.0" },
  });
  if (!res.ok) throw new Error(`ETH price fetch failed: ${res.status}`);
  // slvr.fun returns { priceUsd: number, updatedAt: string, source: string }
  // (some versions return { price: string } — handle both)
  const data = (await res.json()) as {
    price?: string | number;
    priceUsd?: string | number;
  };
  const raw = data.priceUsd ?? data.price ?? "0";
  const price = parseFloat(String(raw));
  if (!price || isNaN(price)) throw new Error("ETH price parse failed");
  return price;
}

async function fetchDexscreener(): Promise<DexscreenerResponse> {
  const res = await fetch(DEXSCREENER_URL, {
    signal: AbortSignal.timeout(8000),
    headers: { "User-Agent": "slvrline-dashboard/1.0" },
  });
  if (!res.ok) throw new Error(`Dexscreener fetch failed: ${res.status}`);
  return res.json() as Promise<DexscreenerResponse>;
}

/**
 * Derive ETH/USD from Dexscreener when the slvr.fun feed is unavailable: for a
 * WETH/ETH-quoted SLVR pair, ETH/USD = priceUsd / priceNative
 * (USD-per-SLVR ÷ WETH-per-SLVR). Picks the deepest such pool.
 */
function deriveEthUsdFromPairs(pairs: DexPair[]): number {
  const candidates = pairs
    .filter((p) => {
      const q = (p.quoteToken?.symbol ?? "").toUpperCase();
      return (q === "WETH" || q === "ETH") && p.priceUsd && p.priceNative;
    })
    .map((p) => ({
      liq: p.liquidity?.usd ?? 0,
      usd: parseFloat(p.priceUsd ?? "0"),
      native: parseFloat(p.priceNative ?? "0"),
    }))
    .filter((p) => p.usd > 0 && p.native > 0)
    .sort((a, b) => b.liq - a.liq);
  return candidates[0] ? candidates[0].usd / candidates[0].native : 0;
}

async function fetchMarketData(): Promise<MarketData> {
  // slvr.fun's ETH feed is a soft dependency — if it's down, derive ETH/USD from
  // Dexscreener so vitals/earn/staking-rewards don't all 500 with it.
  const [dexData, ethFromFeed] = await Promise.all([
    fetchDexscreener(),
    fetchEthPrice().catch(() => null),
  ]);

  const pairs = dexData.pairs ?? [];

  // Build pool list; skip pairs with no price
  const pools: PoolInfo[] = pairs
    .filter((p) => p.priceUsd && parseFloat(p.priceUsd) > 0)
    .map((p) => ({
      pair_address: p.pairAddress ?? "",
      dex: p.dexId ?? "unknown",
      base_token: p.baseToken?.symbol ?? "?",
      quote_token: p.quoteToken?.symbol ?? "?",
      price_usd: parseFloat(p.priceUsd ?? "0"),
      liquidity_usd: p.liquidity?.usd ?? 0,
      volume_24h_usd: p.volume?.h24 ?? 0,
      fdv_usd: p.fdv ?? 0,
    }));

  // Primary pool = highest liquidity
  const sorted = [...pools].sort(
    (a, b) => b.liquidity_usd - a.liquidity_usd
  );
  const primary = sorted[0];

  // Aggregate liquidity across ALL pools
  const totalLiquidityUsd = pools.reduce(
    (sum, p) => sum + p.liquidity_usd,
    0
  );

  const slvrUsd = primary?.price_usd ?? 0;
  const ethUsd =
    ethFromFeed && ethFromFeed > 0 ? ethFromFeed : deriveEthUsdFromPairs(pairs);
  const slvrEth = ethUsd > 0 ? slvrUsd / ethUsd : 0;

  return {
    slvr_usd: slvrUsd,
    slvr_eth: slvrEth,
    eth_usd: ethUsd,
    total_liquidity_usd: totalLiquidityUsd,
    pool_count: pools.length,
    pools,
    primary_pool: primary?.pair_address ?? "",
    cached_at: new Date().toISOString(),
    cache_ttl_seconds: MARKET_CACHE_TTL,
  };
}

/**
 * Returns cached market data (60s TTL).
 * Exported for use in /api/market and /api/vitals.
 */
export async function getMarketData(): Promise<MarketData> {
  return withCache(CACHE_KEY, MARKET_CACHE_TTL, fetchMarketData);
}

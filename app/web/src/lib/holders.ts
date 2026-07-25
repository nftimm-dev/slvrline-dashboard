/**
 * Holder distribution for the /holders page.
 *
 * Source: Blockscout v2. Holder count from /tokens/{SLVR}; ranked balances from
 * /tokens/{SLVR}/holders (pre-sorted desc). "% of supply" is measured against
 * current totalSupply() (Blockscout `total_supply`), the standard concentration
 * denominator. Protocol labels come from our registry, falling back to
 * Blockscout's on-chain contract name. 5-minute cache.
 */
import { withCache } from "./cache";
import { getTokenMeta, getTopHolders } from "./blockscout";
import { getLabel, SLVR_TOKEN_ADDRESS } from "./labels";

const CACHE_TTL = 300; // 5 min
const CACHE_KEY = "holders:page";
const TOP_N = 25;

export interface HolderRow {
  rank: number;
  address: string;
  label: string | null;
  isContract: boolean;
  balanceSlvr: number;
  pctOfSupply: number;
}

export interface HoldersData {
  holderCount: number | null;
  totalSupplySlvr: number;
  top10Pct: number;
  top: HolderRow[];
  cachedAt: string;
  cacheTtlSeconds: number;
}

async function fetchHolders(): Promise<HoldersData> {
  const [meta, rawHolders] = await Promise.all([
    getTokenMeta(SLVR_TOKEN_ADDRESS),
    getTopHolders(SLVR_TOKEN_ADDRESS),
  ]);

  const decimals = meta.decimals || 18;
  const scale = 10 ** decimals;
  const totalSupplyRaw = meta.totalSupplyRaw;
  const totalSupplySlvr = Number(totalSupplyRaw) / scale;

  const pctOf = (raw: bigint): number => {
    if (totalSupplyRaw <= 0n) return 0;
    // Ratio in float — magnitudes here are safe (both < ~1e22).
    return (Number(raw) / Number(totalSupplyRaw)) * 100;
  };

  const ranked = rawHolders
    .sort((a, b) => (a.balanceRaw < b.balanceRaw ? 1 : a.balanceRaw > b.balanceRaw ? -1 : 0))
    .slice(0, TOP_N)
    .map((h, i) => ({
      rank: i + 1,
      address: h.address,
      // Prefer our curated label; Blockscout on-chain name is the fallback.
      label: getLabel(h.address) ?? h.onchainName,
      isContract: h.isContract,
      balanceSlvr: Number(h.balanceRaw) / scale,
      pctOfSupply: pctOf(h.balanceRaw),
    }));

  const top10Pct = ranked
    .slice(0, 10)
    .reduce((s, h) => s + h.pctOfSupply, 0);

  return {
    holderCount: meta.holderCount,
    totalSupplySlvr,
    top10Pct,
    top: ranked,
    cachedAt: new Date().toISOString(),
    cacheTtlSeconds: CACHE_TTL,
  };
}

export async function getHoldersData(): Promise<HoldersData> {
  return withCache(CACHE_KEY, CACHE_TTL, fetchHolders);
}

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

/**
 * Holders-CONTEXT label overrides. On the holders table, the Grid Mining
 * contracts' SLVR balance IS the unclaimed mining-rewards pool — so we label it
 * as such here (only). This does NOT touch the global getLabel() registry used
 * elsewhere on the site.
 */
const HOLDERS_LABEL_OVERRIDES: Record<string, string> = {
  "0xb0cc994ce4e8fb106da9eb36e26fdd8c5f1e0c71": "Unclaimed SLVR", // Grid Mining V2
  "0x284eb4016305fa7fbc162fb68f27227271001c7f": "Unclaimed SLVR (Legacy)", // Grid Mining V1
};

function holdersLabel(address: string, fallback: string | null): string | null {
  return HOLDERS_LABEL_OVERRIDES[address.toLowerCase()] ?? getLabel(address) ?? fallback;
}

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
      // Holders-context override (Grid Mining → "Unclaimed SLVR"), then curated
      // global label, then Blockscout on-chain name.
      label: holdersLabel(h.address, h.onchainName),
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

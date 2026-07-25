/**
 * Holder distribution for the /holders page.
 *
 * Source: Blockscout v2. Holder count from /tokens/{SLVR}; ranked balances from
 * /tokens/{SLVR}/holders (pre-sorted desc). "% of supply" is measured against
 * current totalSupply() (Blockscout `total_supply`), the standard concentration
 * denominator. Protocol labels come from our registry, falling back to
 * Blockscout's on-chain contract name. 5-minute cache.
 *
 * Two views:
 *   - RAW (default): on-chain balances exactly as Blockscout reports them. Big
 *     "holders" here are protocol contracts (vote escrow, grid mining, LP, …).
 *   - ECONOMIC (opt-in): TRUE economic holders. The Grid Mining contract's SLVR
 *     is the unclaimed-rewards pool OWED to individual miners; the Vote Escrow
 *     contract's SLVR is time-locked SLVR OWNED by individual stakers. Economic
 *     mode reattributes those pooled balances back to the real people, so a
 *     top miner / staker with little in-wallet SLVR surfaces at their true
 *     economic weight. This is a pure REATTRIBUTION — the total is unchanged.
 *     Permanent ve locks are BURNED (not in the ve contract's balance) and are
 *     therefore excluded.
 */
import { withCache } from "./cache";
import { getTokenMeta, getTopHolders } from "./blockscout";
import { getLabel, SLVR_TOKEN_ADDRESS } from "./labels";
import { getMiningUnclaimed } from "./miningUnclaimed";
import { computeVeAggregate } from "./veLocks";

const CACHE_TTL = 300; // 5 min
const CACHE_KEY = "holders:page";
const CACHE_KEY_ECON = "holders:page:economic";
const TOP_N = 25;

// Grid Mining V2 — its SLVR balance is (mostly) the unclaimed-rewards pool.
const GRID_MINING_V2 = "0xb0cc994ce4e8fb106da9eb36e26fdd8c5f1e0c71";
// Vote Escrow NFT — its SLVR balance is the time-locked SLVR pool.
const VOTE_ESCROW = "0xd9b8fbd61033145c5496132153ce675756313b71";

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

/**
 * True ONLY for curated protocol addresses — our holders-context overrides
 * (Unclaimed SLVR) or the global contract registry (vote escrow, LP, DEX,
 * vesting, treasury, …). Deliberately NOT `isContract`: contracts we haven't
 * catalogued (e.g. FOMO wallets, Blockscout-named contracts) are treated as
 * real holders and stay in the rankings.
 */
function isProtocolAddress(address: string): boolean {
  return (
    address.toLowerCase() in HOLDERS_LABEL_OVERRIDES || getLabel(address) !== null
  );
}

/** Composition of an economic holder's total (SLVR). Non-zero parts only shown. */
export interface HolderComposition {
  /** Raw in-wallet SLVR (after protocol pools are reattributed away). */
  wallet: number;
  /** Unclaimed grid-mining SLVR owed to this address. */
  unclaimed: number;
  /** Time-locked (non-permanent) ve SLVR owned by this address. */
  staked: number;
}

export interface HolderRow {
  rank: number;
  address: string;
  label: string | null;
  isContract: boolean;
  /** Curated protocol address (vote escrow, unclaimed pool, LP, DEX, vesting…). */
  isProtocol: boolean;
  balanceSlvr: number;
  pctOfSupply: number;
  /** Only present in economic mode: breakdown of balanceSlvr by source. */
  composition?: HolderComposition;
}

export interface HoldersData {
  holderCount: number | null;
  totalSupplySlvr: number;
  top10Pct: number;
  top: HolderRow[];
  /** "raw" (on-chain balances) or "economic" (unclaimed + time-locked reattributed). */
  mode: "raw" | "economic";
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
      isProtocol: isProtocolAddress(h.address),
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
    mode: "raw",
    cachedAt: new Date().toISOString(),
    cacheTtlSeconds: CACHE_TTL,
  };
}

/**
 * Economic holders: start from raw Blockscout balances, then reattribute the
 * pooled protocol balances back to individuals —
 *   - Grid Mining V2 unclaimed pool → per-miner rewardsSlvr (miningUnclaimed).
 *   - Vote Escrow time-locked pool → per-owner NON-permanent lock amount (veLocks).
 * The pooled amount is SUBTRACTED from the contract's wallet component and ADDED
 * to each person, so the economic total equals the raw total (reattribution, not
 * new supply). Permanent ve locks are burned (not in the ve balance) → excluded.
 */
async function fetchEconomicHolders(): Promise<HoldersData> {
  const [meta, rawHolders, mining, ve] = await Promise.all([
    getTokenMeta(SLVR_TOKEN_ADDRESS),
    getTopHolders(SLVR_TOKEN_ADDRESS),
    // These libs cache internally; heavy enumerations are amortised.
    getMiningUnclaimed(),
    computeVeAggregate(),
  ]);

  const decimals = meta.decimals || 18;
  const scale = 10 ** decimals;
  const totalSupplyRaw = meta.totalSupplyRaw;
  const totalSupplySlvr = Number(totalSupplyRaw) / scale;

  // Per-address economic composition. Keyed by lowercase address.
  interface Acc {
    address: string; // canonical (mixed-case) form for display/links
    isContract: boolean;
    wallet: number;
    unclaimed: number;
    staked: number;
    onchainName: string | null;
  }
  const map = new Map<string, Acc>();
  const ensure = (address: string): Acc => {
    const key = address.toLowerCase();
    let a = map.get(key);
    if (!a) {
      a = {
        address,
        isContract: false,
        wallet: 0,
        unclaimed: 0,
        staked: 0,
        onchainName: null,
      };
      map.set(key, a);
    }
    return a;
  };

  // 1. Seed every raw on-chain holder's wallet balance.
  for (const h of rawHolders) {
    const a = ensure(h.address);
    a.wallet += Number(h.balanceRaw) / scale;
    a.isContract = a.isContract || h.isContract;
    if (h.onchainName && !a.onchainName) a.onchainName = h.onchainName;
  }

  // 2. Reattribute the Grid Mining V2 unclaimed pool → per miner.
  //    Redistribute exactly SUM(per-miner rewardsSlvr); the V2 contract keeps any
  //    residual (lazy-checkpoint gap + non-pool float), so totals reconcile.
  let miningRedistributed = 0;
  // allMiners is the FULL owed set (SUMs to sumMinerUnclaimed) — attribute every
  // miner, not just the top-N shown on the mining page.
  for (const m of mining.allMiners) {
    if (m.unclaimedSlvr <= 0) continue;
    const a = ensure(m.address);
    a.unclaimed += m.unclaimedSlvr;
    miningRedistributed += m.unclaimedSlvr;
  }
  {
    const v2 = map.get(GRID_MINING_V2);
    if (v2) v2.wallet = Math.max(0, v2.wallet - miningRedistributed);
  }

  // 3. Reattribute the Vote Escrow time-locked pool → per owner.
  //    Group NON-permanent active locks by owner (permanent locks are burned and
  //    are NOT part of the ve contract's SLVR balance → exclude).
  let veRedistributed = 0;
  const perOwnerStaked = new Map<string, number>();
  for (const lock of ve.locks) {
    if (lock.permanent) continue; // burned — not held
    if (lock.amountRaw <= 0n) continue;
    const amt = Number(lock.amountRaw) / scale;
    const key = lock.owner.toLowerCase();
    perOwnerStaked.set(key, (perOwnerStaked.get(key) ?? 0) + amt);
  }
  for (const [owner, amt] of perOwnerStaked) {
    const a = ensure(owner);
    a.staked += amt;
    veRedistributed += amt;
  }
  {
    const veAcc = map.get(VOTE_ESCROW);
    if (veAcc) veAcc.wallet = Math.max(0, veAcc.wallet - veRedistributed);
  }

  // 4. Total per address, rank, recompute % against the SAME supply denominator.
  const rows = [...map.values()]
    .map((a) => {
      const total = a.wallet + a.unclaimed + a.staked;
      return { a, total };
    })
    .filter((r) => r.total > 1e-9)
    .sort((x, y) => y.total - x.total);

  const pctOfTotal = (v: number): number =>
    totalSupplySlvr > 0 ? (v / totalSupplySlvr) * 100 : 0;

  const top: HolderRow[] = rows.slice(0, TOP_N).map((r, i) => ({
    rank: i + 1,
    address: r.a.address,
    label: holdersLabel(r.a.address, r.a.onchainName),
    isContract: r.a.isContract,
    isProtocol: isProtocolAddress(r.a.address),
    balanceSlvr: r.total,
    pctOfSupply: pctOfTotal(r.total),
    composition: {
      wallet: r.a.wallet,
      unclaimed: r.a.unclaimed,
      staked: r.a.staked,
    },
  }));

  const top10Pct = top.slice(0, 10).reduce((s, h) => s + h.pctOfSupply, 0);

  return {
    holderCount: meta.holderCount,
    totalSupplySlvr,
    top10Pct,
    top,
    mode: "economic",
    cachedAt: new Date().toISOString(),
    cacheTtlSeconds: CACHE_TTL,
  };
}

export async function getHoldersData(): Promise<HoldersData> {
  return withCache(CACHE_KEY, CACHE_TTL, fetchHolders);
}

export async function getEconomicHoldersData(): Promise<HoldersData> {
  return withCache(CACHE_KEY_ECON, CACHE_TTL, fetchEconomicHolders);
}

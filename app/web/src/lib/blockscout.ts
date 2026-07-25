/**
 * Blockscout API v2 client for token holders + token metadata.
 * Base: https://robinhoodchain.blockscout.com/api/v2/
 *
 * Endpoints used:
 *   GET /tokens/{addr}          → { total_supply, decimals, holders (count) }
 *   GET /tokens/{addr}/holders  → { items: [{ address:{hash,is_contract}, value }] }
 */

const BLOCKSCOUT_API = "https://robinhoodchain.blockscout.com/api/v2";

async function fetchBlockscout<T>(path: string): Promise<T> {
  const res = await fetch(`${BLOCKSCOUT_API}${path}`, {
    signal: AbortSignal.timeout(12_000),
    headers: {
      "User-Agent": "slvrline-dashboard/1.0",
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    throw new Error(`Blockscout ${path} failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// --- /tokens/{addr} ---------------------------------------------------------

interface BsTokenResponse {
  total_supply?: string | null;
  decimals?: string | null;
  holders?: string | null;
  holders_count?: string | null;
  symbol?: string | null;
  name?: string | null;
}

export interface TokenMeta {
  totalSupplyRaw: bigint;
  decimals: number;
  holderCount: number | null;
  symbol: string | null;
}

export async function getTokenMeta(tokenAddr: string): Promise<TokenMeta> {
  const data = await fetchBlockscout<BsTokenResponse>(`/tokens/${tokenAddr}`);
  const decimals = data.decimals ? parseInt(data.decimals, 10) : 18;
  // Blockscout has used both `holders` and `holders_count` across versions.
  const holdersRaw = data.holders ?? data.holders_count ?? null;
  const holderCount = holdersRaw != null ? parseInt(holdersRaw, 10) : null;
  return {
    totalSupplyRaw: data.total_supply ? BigInt(data.total_supply) : 0n,
    decimals: Number.isFinite(decimals) ? decimals : 18,
    holderCount: holderCount != null && Number.isFinite(holderCount) ? holderCount : null,
    symbol: data.symbol ?? null,
  };
}

// --- /tokens/{addr}/holders -------------------------------------------------

interface BsHolderItem {
  address?: {
    hash?: string;
    is_contract?: boolean;
    name?: string | null;
  };
  value?: string;
}

interface BsHoldersResponse {
  items?: BsHolderItem[];
}

export interface RawHolder {
  address: string;
  isContract: boolean;
  balanceRaw: bigint;
}

/**
 * Fetch the top holders (Blockscout returns them pre-sorted by balance desc).
 * Blockscout paginates ~50/page; we take the first page which comfortably
 * covers the top N we display.
 */
export async function getTopHolders(tokenAddr: string): Promise<RawHolder[]> {
  const data = await fetchBlockscout<BsHoldersResponse>(
    `/tokens/${tokenAddr}/holders`
  );
  const items = data.items ?? [];
  return items
    .filter((it) => it.address?.hash && it.value != null)
    .map((it) => ({
      address: it.address!.hash as string,
      isContract: Boolean(it.address!.is_contract),
      balanceRaw: BigInt(it.value as string),
    }));
}

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
  /** On-chain contract name from Blockscout, if any (fallback label). */
  onchainName: string | null;
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
      onchainName: it.address!.name ?? null,
    }));
}

// --- Paginated address history ---------------------------------------------
// The raw RPC eth_getLogs silently under-counts wide/dense ranges on this chain,
// so for accurate per-address transfer/spend history we page Blockscout (reliable).

interface BsPaged<T> {
  items?: T[];
  next_page_params?: Record<string, unknown> | null;
}

async function fetchAllPages<T>(path: string, maxPages = 20): Promise<T[]> {
  const out: T[] = [];
  let pageParams: Record<string, unknown> | null = null;
  for (let page = 0; page < maxPages; page++) {
    let url: string = path;
    if (pageParams) {
      const sep = path.includes("?") ? "&" : "?";
      const parts: string[] = Object.entries(pageParams).map(
        ([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`
      );
      url = path + sep + parts.join("&");
    }
    const data: BsPaged<T> = await fetchBlockscout<BsPaged<T>>(url);
    if (data.items?.length) out.push(...data.items);
    pageParams = data.next_page_params ?? null;
    if (!pageParams) break;
  }
  return out;
}

interface BsTransferItem {
  from?: { hash?: string };
  to?: { hash?: string };
  total?: { value?: string; decimals?: string };
  value?: string;
  block_number?: number;
  block?: number;
  timestamp?: string;
  transaction_hash?: string;
  tx_hash?: string;
}

export interface AddressTransfer {
  from: string;
  to: string;
  valueRaw: bigint;
  block: number;
  timestamp: string | null;
  txHash: string;
}

/** ERC-20 transfers of `tokenAddr` touching `address` (paginated, reliable). */
export async function getAddressTokenTransfers(
  address: string,
  tokenAddr: string,
  maxPages = 20
): Promise<AddressTransfer[]> {
  const items = await fetchAllPages<BsTransferItem>(
    `/addresses/${address}/token-transfers?type=ERC-20&token=${tokenAddr}`,
    maxPages
  );
  return items
    .map((it) => ({
      from: (it.from?.hash ?? "").toLowerCase(),
      to: (it.to?.hash ?? "").toLowerCase(),
      valueRaw: BigInt(it.total?.value ?? it.value ?? "0"),
      block: it.block_number ?? it.block ?? 0,
      timestamp: it.timestamp ?? null,
      txHash: (it.transaction_hash ?? it.tx_hash ?? "").toLowerCase(),
    }))
    .filter((t) => t.from || t.to);
}

interface BsTxItem {
  from?: { hash?: string };
  value?: string;
  timestamp?: string;
  hash?: string;
}

/**
 * Native-coin (ETH) value sent BY `address` (paginated). Returns the sum plus a
 * per-tx value map (txHash → wei), used to price each individual buy.
 */
export async function getAddressNativeSpent(
  address: string,
  maxPages = 20
): Promise<{
  spentRaw: bigint;
  spent24hRaw: bigint;
  txCount: number;
  firstTs: string | null;
  lastTs: string | null;
  valueByHash: Record<string, string>;
}> {
  const a = address.toLowerCase();
  const items = await fetchAllPages<BsTxItem>(
    `/addresses/${address}/transactions?filter=from`,
    maxPages
  );
  const cutoff = Date.now() - 24 * 3600 * 1000;
  let spentRaw = 0n;
  let spent24hRaw = 0n;
  let txCount = 0;
  let firstTs: string | null = null;
  let lastTs: string | null = null;
  const valueByHash: Record<string, string> = {};
  for (const it of items) {
    if ((it.from?.hash ?? "").toLowerCase() !== a) continue;
    const v = BigInt(it.value ?? "0");
    spentRaw += v;
    txCount++;
    if (it.hash) valueByHash[it.hash.toLowerCase()] = it.value ?? "0";
    if (it.timestamp) {
      lastTs = lastTs ?? it.timestamp; // items are newest-first
      firstTs = it.timestamp;
      if (Date.parse(it.timestamp) >= cutoff) spent24hRaw += v;
    }
  }
  return { spentRaw, spent24hRaw, txCount, firstTs, lastTs, valueByHash };
}

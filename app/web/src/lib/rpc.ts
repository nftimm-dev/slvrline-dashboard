/**
 * Minimal, dependency-free JSON-RPC layer for the SLVRline web app.
 *
 * Mirrors the proven pattern in app/metrics/src/rpc.ts but without viem:
 *   - eth_call / eth_getBalance round-robin PRIMARY↔SECONDARY with backoff (safe:
 *     historical state reads are consistent across both archive nodes).
 *   - getLogsAdaptive PINS to PRIMARY and adaptively subdivides the block range on
 *     timeout / range-too-large errors. The SECONDARY RPC silently returns TRUNCATED
 *     logs (no error), so round-robining getLogs would under-count — never do it.
 *
 * ABI encode/decode is hand-rolled for the handful of simple shapes we need
 * (uint256, address, bool tuples) to avoid pulling viem into the web bundle.
 */

export const RPC_PRIMARY = "https://rpc.mainnet.chain.robinhood.com";
export const RPC_SECONDARY = "https://slvr.fun/api/rpc";

const RPC_URLS = [RPC_PRIMARY, RPC_SECONDARY];

// ERC-20 / ERC-721 Transfer(address,address,uint256) topic0.
export const TRANSFER_TOPIC0 =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
export const ZERO_TOPIC =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// ABI helpers (hand-rolled — no viem)
// ---------------------------------------------------------------------------

/** Decode a single uint256 from a hex eth_call result (or a 32-byte word slice). */
export function decodeUint256(hex: string): bigint {
  if (!hex || hex === "0x") return 0n;
  return BigInt(hex.length > 66 ? "0x" + hex.slice(2, 66) : hex);
}

/** Decode an address from a bytes32-padded eth_call result (last 20 bytes). */
export function decodeAddress(hex: string): string {
  if (!hex || hex.length < 66) {
    return "0x0000000000000000000000000000000000000000";
  }
  return "0x" + hex.slice(hex.length - 40);
}

/** Encode a uint256 as a 32-byte (64 hex char) word, no 0x prefix. */
export function encodeUint256(value: bigint): string {
  return value.toString(16).padStart(64, "0");
}

/** Encode an address as a 32-byte left-padded word, no 0x prefix. */
export function encodeAddress(address: string): string {
  return address.toLowerCase().replace(/^0x/, "").padStart(64, "0");
}

/** Read the Nth 32-byte word (0-indexed) from a hex return blob as a bigint. */
export function wordAt(hex: string, index: number): bigint {
  const body = hex.startsWith("0x") ? hex.slice(2) : hex;
  const start = index * 64;
  const slice = body.slice(start, start + 64);
  if (!slice) return 0n;
  return BigInt("0x" + slice);
}

/** Read the Nth 32-byte word as an address (last 20 bytes). */
export function addressWordAt(hex: string, index: number): string {
  const body = hex.startsWith("0x") ? hex.slice(2) : hex;
  const start = index * 64;
  const slice = body.slice(start, start + 64);
  if (slice.length < 64) return "0x0000000000000000000000000000000000000000";
  return "0x" + slice.slice(24);
}

// ---------------------------------------------------------------------------
// Low-level fetch
// ---------------------------------------------------------------------------

async function fetchJson(
  url: string,
  body: string,
  timeoutMs = 20_000
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: controller.signal,
    });
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`);
    }
    return await resp.json();
  } finally {
    clearTimeout(timer);
  }
}

const MAX_RETRIES = 6;
const BASE_DELAY_MS = 200;

function isRateLimit(msg: string | undefined, code?: number): boolean {
  const m = (msg || "").toLowerCase();
  return (
    code === -32005 ||
    m.includes("limit") ||
    m.includes("429") ||
    m.includes("rate") ||
    m.includes("too many")
  );
}

type BlockParam = bigint | "latest";

function toBlockHex(block: BlockParam): string {
  return block === "latest" ? "latest" : "0x" + block.toString(16);
}

/**
 * eth_call with dual-RPC failover + exponential backoff.
 * Safe to round-robin: both are archive nodes returning consistent state reads.
 */
export async function ethCall(
  to: string,
  data: string,
  block: BlockParam = "latest"
): Promise<string> {
  const reqBody = JSON.stringify({
    jsonrpc: "2.0",
    method: "eth_call",
    params: [{ to, data }, toBlockHex(block)],
    id: 1,
  });

  let lastErr: Error | null = null;
  let idx = 0;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const rpcUrl = RPC_URLS[idx % RPC_URLS.length];
    try {
      const resp = (await fetchJson(rpcUrl, reqBody)) as {
        result?: string;
        error?: { code: number; message: string };
      };
      if (resp.error) {
        if (isRateLimit(resp.error.message, resp.error.code)) {
          await sleep(BASE_DELAY_MS * Math.pow(2, attempt));
          idx++;
          continue;
        }
        throw new Error(`RPC ${resp.error.code}: ${resp.error.message}`);
      }
      if (resp.result === undefined) throw new Error("Empty RPC result");
      return resp.result;
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      idx++;
      if (attempt < MAX_RETRIES - 1) {
        await sleep(BASE_DELAY_MS * Math.pow(2, attempt));
      }
    }
  }
  throw lastErr ?? new Error("ethCall failed after retries");
}

/** eth_getBalance (wei) with dual-RPC failover. */
export async function ethGetBalance(
  address: string,
  block: BlockParam = "latest"
): Promise<bigint> {
  const reqBody = JSON.stringify({
    jsonrpc: "2.0",
    method: "eth_getBalance",
    params: [address, toBlockHex(block)],
    id: 1,
  });

  let lastErr: Error | null = null;
  let idx = 0;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const rpcUrl = RPC_URLS[idx % RPC_URLS.length];
    try {
      const resp = (await fetchJson(rpcUrl, reqBody)) as {
        result?: string;
        error?: { code: number; message: string };
      };
      if (resp.error) {
        if (isRateLimit(resp.error.message, resp.error.code)) {
          await sleep(BASE_DELAY_MS * Math.pow(2, attempt));
          idx++;
          continue;
        }
        throw new Error(`RPC ${resp.error.code}: ${resp.error.message}`);
      }
      if (resp.result) return BigInt(resp.result);
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      idx++;
      if (attempt < MAX_RETRIES - 1) {
        await sleep(BASE_DELAY_MS * Math.pow(2, attempt));
      }
    }
  }
  throw lastErr ?? new Error("ethGetBalance failed after retries");
}

/** Latest block number (hex → bigint). Round-robin is fine for head reads. */
export async function ethBlockNumber(): Promise<bigint> {
  const reqBody = JSON.stringify({
    jsonrpc: "2.0",
    method: "eth_blockNumber",
    params: [],
    id: 1,
  });
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const rpcUrl = RPC_URLS[attempt % RPC_URLS.length];
    try {
      const resp = (await fetchJson(rpcUrl, reqBody)) as {
        result?: string;
        error?: { message: string };
      };
      if (resp.result) return BigInt(resp.result);
      if (resp.error) throw new Error(resp.error.message);
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      await sleep(BASE_DELAY_MS * Math.pow(2, attempt));
    }
  }
  throw lastErr ?? new Error("ethBlockNumber failed");
}

// ---------------------------------------------------------------------------
// getLogsAdaptive — PRIMARY-pinned, subdivides on error. NEVER round-robin.
// ---------------------------------------------------------------------------

export interface RawLog {
  topics: string[];
  data: string;
  blockNumber: string;
}

/**
 * Reliable historical eth_getLogs for wide genesis→head scans.
 *
 * WHY pinned to PRIMARY: the SECONDARY RPC returns TRUNCATED logs with no error on
 * wide ranges, so any round-robin under-counts. PRIMARY errors ("timed out" /
 * "too large") instead of truncating — so we catch those and subdivide.
 */
export async function getLogsAdaptive(params: {
  address: string;
  topics: Array<string | null | string[]>;
  fromBlock: bigint;
  toBlock: bigint;
  initialSpan?: bigint;
}): Promise<RawLog[]> {
  const { address, topics, fromBlock, toBlock } = params;
  const initialSpan = params.initialSpan ?? 250_000n;

  const out: RawLog[] = [];

  for (let lo = fromBlock; lo <= toBlock; lo += initialSpan) {
    const hi = lo + initialSpan - 1n < toBlock ? lo + initialSpan - 1n : toBlock;
    const chunk = await getLogsRangePinned(address, topics, lo, hi, 0);
    out.push(...chunk);
    await sleep(120); // gentle pacing to respect PRIMARY rate limits
  }

  return out;
}

async function getLogsRangePinned(
  address: string,
  topics: Array<string | null | string[]>,
  lo: bigint,
  hi: bigint,
  depth: number
): Promise<RawLog[]> {
  const reqBody = JSON.stringify({
    jsonrpc: "2.0",
    method: "eth_getLogs",
    params: [
      {
        address,
        topics,
        fromBlock: "0x" + lo.toString(16),
        toBlock: "0x" + hi.toString(16),
      },
    ],
    id: 1,
  });

  const MAX_ATTEMPTS = 5;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    let resp: Response;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30_000);
      try {
        resp = await fetch(RPC_PRIMARY, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: reqBody,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }
    } catch {
      await sleep(500 * Math.pow(2, attempt));
      continue;
    }

    let j: {
      result?: RawLog[];
      error?: { code: number; message: string };
    };
    try {
      j = (await resp.json()) as typeof j;
    } catch {
      await sleep(500 * Math.pow(2, attempt));
      continue;
    }

    if (resp.status === 429) {
      await sleep(1500 * Math.pow(2, attempt));
      continue;
    }

    if (j.error) {
      const m = (j.error.message || "").toLowerCase();
      if (m.includes("too many") || m.includes("429") || m.includes("rate")) {
        await sleep(1500 * Math.pow(2, attempt));
        continue;
      }
      // Range-too-large / timeout → split immediately.
      if (
        m.includes("timed out") ||
        m.includes("timeout") ||
        m.includes("limit") ||
        m.includes("too large") ||
        m.includes("range") ||
        m.includes("too many results")
      ) {
        break;
      }
      await sleep(400 * Math.pow(2, attempt));
      continue;
    }

    if (Array.isArray(j.result)) return j.result;
    await sleep(400 * Math.pow(2, attempt));
  }

  // Subdivide + recurse. Guard against pathological depth.
  if (hi > lo && depth < 40) {
    const mid = (lo + hi) / 2n;
    const left = await getLogsRangePinned(address, topics, lo, mid, depth + 1);
    await sleep(120);
    const right = await getLogsRangePinned(address, topics, mid + 1n, hi, depth + 1);
    return left.concat(right);
  }

  console.warn(`[getLogsAdaptive] gave up on block range ${lo}-${hi}`);
  return [];
}

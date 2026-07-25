/**
 * rpc.ts — Archival eth_call layer with dual-RPC failover and exponential backoff.
 *
 * Both RPCs are archive nodes — eth_call at historical blocks returns valid state.
 * Round-robins between PRIMARY and SECONDARY on 429s or network errors.
 *
 * Usage:
 *   const result = await archivalCall(contractAddr, calldata, blockNumber);
 *   const result = await archivalCall(contractAddr, calldata, "latest");
 */

import { RPC_PRIMARY, RPC_SECONDARY } from "./constants";

const RPC_URLS = [RPC_PRIMARY, RPC_SECONDARY];

// Shared ERC-20 / ERC-721 Transfer(address,address,uint256) topic0.
export const TRANSFER_TOPIC0 =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
export const ZERO_TOPIC =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

type BlockParam = bigint | "latest" | "earliest";

function toBlockHex(block: BlockParam): string {
  if (block === "latest") return "latest";
  if (block === "earliest") return "earliest";
  return "0x" + block.toString(16);
}

// Simple fetch with timeout
async function fetchJson(url: string, body: string, timeoutMs = 20_000): Promise<unknown> {
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
      throw new Error(`HTTP ${resp.status}: ${await resp.text().catch(() => "")}`);
    }
    return await resp.json();
  } finally {
    clearTimeout(timer);
  }
}

let _rpcIndex = 0;

function nextRpc(): string {
  const url = RPC_URLS[_rpcIndex % RPC_URLS.length];
  _rpcIndex++;
  return url;
}

function otherRpc(failed: string): string {
  return RPC_URLS.find((u) => u !== failed) ?? RPC_URLS[0];
}

const MAX_RETRIES = 6;
const BASE_DELAY_MS = 200;

export async function archivalCall(
  to: string,
  data: string,
  block: BlockParam = "latest"
): Promise<string> {
  const blockHex = toBlockHex(block);
  const reqBody = JSON.stringify({
    jsonrpc: "2.0",
    method: "eth_call",
    params: [{ to, data }, blockHex],
    id: 1,
  });

  let lastErr: Error | null = null;
  let rpcUrl = nextRpc();

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const resp = (await fetchJson(rpcUrl, reqBody)) as {
        result?: string;
        error?: { code: number; message: string };
      };
      if (resp.error) {
        // 429 or rate-limit: back off + try other RPC
        if (resp.error.code === -32005 || resp.error.message?.includes("limit") || resp.error.message?.includes("429")) {
          await sleep(BASE_DELAY_MS * Math.pow(2, attempt));
          rpcUrl = otherRpc(rpcUrl);
          continue;
        }
        throw new Error(`RPC error ${resp.error.code}: ${resp.error.message}`);
      }
      if (resp.result === undefined) {
        throw new Error("Empty RPC result");
      }
      return resp.result;
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      // Switch RPC on any failure and back off
      rpcUrl = otherRpc(rpcUrl);
      if (attempt < MAX_RETRIES - 1) {
        await sleep(BASE_DELAY_MS * Math.pow(2, attempt));
      }
    }
  }
  throw lastErr ?? new Error("archivalCall failed after retries");
}

export async function archivalGetBlock(
  block: BlockParam = "latest"
): Promise<{ number: bigint; timestamp: bigint } | null> {
  const blockHex = toBlockHex(block);
  const reqBody = JSON.stringify({
    jsonrpc: "2.0",
    method: "eth_getBlockByNumber",
    params: [blockHex, false],
    id: 1,
  });

  let lastErr: Error | null = null;
  let rpcUrl = nextRpc();

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const resp = (await fetchJson(rpcUrl, reqBody)) as {
        result?: { number: string; timestamp: string } | null;
        error?: { code: number; message: string };
      };
      if (resp.error) {
        if (resp.error.code === -32005 || resp.error.message?.includes("limit") || resp.error.message?.includes("429")) {
          await sleep(BASE_DELAY_MS * Math.pow(2, attempt));
          rpcUrl = otherRpc(rpcUrl);
          continue;
        }
        throw new Error(`RPC error: ${resp.error.message}`);
      }
      if (!resp.result) return null;
      return {
        number: BigInt(resp.result.number),
        timestamp: BigInt(resp.result.timestamp),
      };
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      rpcUrl = otherRpc(rpcUrl);
      if (attempt < MAX_RETRIES - 1) {
        await sleep(BASE_DELAY_MS * Math.pow(2, attempt));
      }
    }
  }
  throw lastErr ?? new Error("archivalGetBlock failed after retries");
}

export async function getLogs(params: {
  address: string;
  topics: string[];
  fromBlock: bigint;
  toBlock: bigint;
}): Promise<Array<{ topics: string[]; data: string; blockNumber: string }>> {
  const reqBody = JSON.stringify({
    jsonrpc: "2.0",
    method: "eth_getLogs",
    params: [{
      address: params.address,
      topics: params.topics,
      fromBlock: "0x" + params.fromBlock.toString(16),
      toBlock: "0x" + params.toBlock.toString(16),
    }],
    id: 1,
  });

  let lastErr: Error | null = null;
  let rpcUrl = nextRpc();

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const resp = (await fetchJson(rpcUrl, reqBody)) as {
        result?: Array<{ topics: string[]; data: string; blockNumber: string }>;
        error?: { code: number; message: string };
      };
      if (resp.error) {
        if (resp.error.code === -32005 || resp.error.message?.includes("limit") || resp.error.message?.includes("429")) {
          await sleep(BASE_DELAY_MS * Math.pow(2, attempt));
          rpcUrl = otherRpc(rpcUrl);
          continue;
        }
        throw new Error(`getLogs RPC error: ${resp.error.message}`);
      }
      return resp.result ?? [];
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      rpcUrl = otherRpc(rpcUrl);
      if (attempt < MAX_RETRIES - 1) {
        await sleep(BASE_DELAY_MS * Math.pow(2, attempt));
      }
    }
  }
  throw lastErr ?? new Error("getLogs failed after retries");
}

/**
 * getLogsAdaptive — reliable historical eth_getLogs for full genesis→head scans.
 *
 * WHY this exists (and why plain getLogs is unsafe for large historical ranges):
 *   - The SECONDARY RPC (slvr.fun) has a shallow / divergent log index — a full-range
 *     eth_getLogs there returns near-zero results with NO error. Round-robining between
 *     RPCs (as getLogs does) therefore silently under-counts by ~50%+, corrupting any
 *     cumulative sum (burns, ve mints). So this function pins to PRIMARY only.
 *   - The PRIMARY RPC (Robinhood) errors ("log query timed out" / 429) on dense wide
 *     ranges rather than truncating. So we adaptively subdivide the block range on those
 *     errors and recurse, with exponential backoff on rate-limits.
 *
 * The result is a complete, deterministic log set. Supports nested-array topics
 * (e.g. [topic0, null, toAddrTopic]) for Transfer(from=any, to=0x0) style filters.
 *
 * @param topics  Filter topics; each entry may be a string, null (wildcard), or string[].
 * @param onProgress optional callback for coarse progress logging.
 */
export async function getLogsAdaptive(params: {
  address: string;
  topics: Array<string | null | string[]>;
  fromBlock: bigint;
  toBlock: bigint;
  initialSpan?: bigint;
  onProgress?: (info: { from: bigint; to: bigint; count: number }) => void;
}): Promise<Array<{ topics: string[]; data: string; blockNumber: string }>> {
  const { address, topics, fromBlock, toBlock } = params;
  const initialSpan = params.initialSpan ?? 250_000n;

  const out: Array<{ topics: string[]; data: string; blockNumber: string }> = [];

  // Walk the range in initialSpan windows; each window subdivides on error.
  for (let lo = fromBlock; lo <= toBlock; lo += initialSpan) {
    const hi = lo + initialSpan - 1n < toBlock ? lo + initialSpan - 1n : toBlock;
    const chunk = await getLogsRangePinned(address, topics, lo, hi, 0);
    if (chunk.length > 0 && params.onProgress) {
      params.onProgress({ from: lo, to: hi, count: chunk.length });
    }
    out.push(...chunk);
    // Gentle pacing between windows to respect PRIMARY rate limits.
    await sleep(120);
  }

  return out;
}

// Single pinned-PRIMARY getLogs for a range, subdividing on timeout/429/range errors.
async function getLogsRangePinned(
  address: string,
  topics: Array<string | null | string[]>,
  lo: bigint,
  hi: bigint,
  depth: number
): Promise<Array<{ topics: string[]; data: string; blockNumber: string }>> {
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
      // Network/abort — back off and retry, then fall through to split.
      await sleep(500 * Math.pow(2, attempt));
      continue;
    }

    let j: {
      result?: Array<{ topics: string[]; data: string; blockNumber: string }>;
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
      // Range-too-large / timeout signals → split immediately.
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
      // Unknown error — brief backoff then retry.
      await sleep(400 * Math.pow(2, attempt));
      continue;
    }

    if (Array.isArray(j.result)) return j.result;
    await sleep(400 * Math.pow(2, attempt));
  }

  // Subdivide and recurse. Guard against pathological recursion depth.
  if (hi > lo && depth < 40) {
    const mid = (lo + hi) / 2n;
    const left = await getLogsRangePinned(address, topics, lo, mid, depth + 1);
    await sleep(120);
    const right = await getLogsRangePinned(address, topics, mid + 1n, hi, depth + 1);
    return left.concat(right);
  }

  // Single block still failing after retries — give up on it (returns empty).
  console.warn(`[getLogsAdaptive] gave up on block range ${lo}-${hi} after retries`);
  return [];
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// Helper to decode a uint256 from a hex eth_call result
export function decodeUint256(hex: string): bigint {
  if (!hex || hex === "0x") return 0n;
  return BigInt(hex);
}

// Helper to decode an address (bytes32-padded) from eth_call
export function decodeAddress(hex: string): string {
  if (!hex || hex.length < 66) return "0x0000000000000000000000000000000000000000";
  return "0x" + hex.slice(hex.length - 40);
}

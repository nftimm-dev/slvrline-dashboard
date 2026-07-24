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

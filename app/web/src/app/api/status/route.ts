/**
 * GET /api/status
 *
 * Returns indexed block height vs chain head to expose indexer lag.
 *
 * indexed_block: MAX(block_number) FROM metrics.metric_snapshots
 * chain_head: eth_blockNumber via JSON-RPC to Robinhood Chain
 * lag_blocks: chain_head - indexed_block
 * lag_seconds: lag_blocks * 0.1  (100ms block time, Arbitrum Nitro constant)
 */
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { CHAIN } from "@/lib/labels";

const BLOCK_TIME_SECONDS = 0.1; // 100ms blocks — Arbitrum Nitro constant

interface MaxBlockRow {
  indexed_block: string | null;
}

async function getIndexedBlock(): Promise<number> {
  const db = getDb();
  const rows = await db<MaxBlockRow[]>`
    SELECT MAX(block_number)::text AS indexed_block
    FROM metrics.metric_snapshots
  `;
  const raw = rows[0]?.indexed_block;
  return raw !== null && raw !== undefined ? parseInt(raw, 10) : 0;
}

async function getChainHead(): Promise<number> {
  const res = await fetch(CHAIN.rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "eth_blockNumber",
      params: [],
      id: 1,
    }),
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) throw new Error(`RPC fetch failed: ${res.status}`);

  const data = (await res.json()) as { result?: string };
  if (!data.result) throw new Error("No result in eth_blockNumber response");

  return parseInt(data.result, 16);
}

export async function GET() {
  try {
    const [indexedBlock, chainHead] = await Promise.all([
      getIndexedBlock(),
      getChainHead(),
    ]);

    const lagBlocks = Math.max(0, chainHead - indexedBlock);
    const lagSeconds = lagBlocks * BLOCK_TIME_SECONDS;

    return NextResponse.json({
      indexed_block: indexedBlock,
      chain_head: chainHead,
      lag_blocks: lagBlocks,
      lag_seconds: lagSeconds,
      block_time_seconds: BLOCK_TIME_SECONDS,
      chain_id: CHAIN.id,
      rpc_url: CHAIN.rpcUrl,
      checked_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[/api/status] error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

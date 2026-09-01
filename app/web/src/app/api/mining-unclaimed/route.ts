/**
 * GET /api/mining-unclaimed
 *
 * "Unclaimed SLVR by miner" — a per-miner breakdown of the Grid Mining
 * active unclaimed-rewards pool. Miner addresses are enumerated from SlvrMinerVault
 * Credited/MigratedIn events, then getMinerState(miner) is Multicall3-batched.
 * The per-miner sum plus the vault's reserved amount reconciles to totalUnclaimed().
 *
 * Cache: 5-minute in-process TTL.
 */
import { NextResponse } from "next/server";
import { getMiningUnclaimed } from "@/lib/miningUnclaimed";
import { readDbCache } from "@/lib/dbCache";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // Serverless-safe: the cron worker precomputes this ~33s enumeration into
    // metrics.cache. Read it back instantly; only compute live if the cache is
    // cold (e.g. local dev before the worker has run).
    const cached = await readDbCache<Record<string, unknown>>("mining_unclaimed_vault_v1");
    const data = cached
      ? { ...cached.data, cached_at: cached.updatedAt }
      : await getMiningUnclaimed();
    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "no-store",
        "X-Data-Sources": "goldsky-address-index,robinhood-rpc,multicall3",
        "X-Cache": cached ? "hit" : "miss",
      },
    });
  } catch (err) {
    console.error("[/api/mining-unclaimed] error:", err);
    return NextResponse.json(
      { error: "Unclaimed-by-miner data temporarily unavailable" },
      { status: 502 }
    );
  }
}

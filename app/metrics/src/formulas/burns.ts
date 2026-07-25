/**
 * burns.ts — Cumulative SLVR burn accounting from on-chain Transfer(to=0x0) events.
 *
 * Permanent ve-locks BURN the underlying SLVR (RESEARCH.md §5), and misc burns also
 * send SLVR to the zero address. The cumulative burned total is therefore:
 *
 *   cumulativeBurned(block) = Σ value of every Transfer(to=0x0) with blockNumber ≤ block
 *
 * This matters for the "emitted" figure: totalSupply() alone hides SLVR that was minted
 * (emitted from the 500K budget) but subsequently burned — most of it via permanent locks.
 *   emitted = totalSupply + cumulativeBurned.
 *
 * We fetch the full burn log set ONCE (genesis→head, via getLogsAdaptive on PRIMARY with
 * adaptive subdivision — see rpc.ts for why round-robin getLogs silently under-counts),
 * then answer cumulative-at-block queries by filtering on blockNumber. This lets supply
 * and runway (which needs emitted at a past block) share a single expensive scan.
 */

import { SLVR_TOKEN, DEPLOY_BLOCK_TOKEN } from "../constants";
import { getLogsAdaptive, TRANSFER_TOPIC0, ZERO_TOPIC } from "../rpc";

export type BurnLog = { value: bigint; block: bigint };

let _cache: { logs: BurnLog[]; scannedToBlock: bigint } | null = null;
let _inFlight: { toBlock: bigint; promise: Promise<BurnLog[]> } | null = null;

/**
 * Fetch (and cache) every SLVR burn (Transfer → 0x0) from genesis through `toBlock`.
 * Cached for the lifetime of the process; a later call with a higher toBlock re-scans.
 * An in-flight guard coalesces concurrent callers (e.g. supply + runway in backfill) so
 * the expensive full-range scan runs exactly once.
 */
export async function fetchBurnLogs(toBlock: bigint): Promise<BurnLog[]> {
  if (_cache && _cache.scannedToBlock >= toBlock) {
    return _cache.logs;
  }
  if (_inFlight && _inFlight.toBlock >= toBlock) {
    return _inFlight.promise;
  }

  const promise = (async (): Promise<BurnLog[]> => {
    // topics: [Transfer, from=any, to=0x0]. `value` is the non-indexed data word.
    const raw = await getLogsAdaptive({
      address: SLVR_TOKEN,
      topics: [TRANSFER_TOPIC0, null, ZERO_TOPIC],
      fromBlock: DEPLOY_BLOCK_TOKEN,
      toBlock,
    });

    const logs: BurnLog[] = raw.map((lg) => ({
      value: BigInt(lg.data && lg.data !== "0x" ? lg.data : "0x0"),
      block: BigInt(lg.blockNumber),
    }));

    _cache = { logs, scannedToBlock: toBlock };
    return logs;
  })();

  _inFlight = { toBlock, promise };
  try {
    return await promise;
  } finally {
    if (_inFlight && _inFlight.promise === promise) _inFlight = null;
  }
}

/** Sum of burn values with blockNumber ≤ atBlock. Fetches (cached) up to `scanTo`. */
export async function cumulativeBurnedAt(
  atBlock: bigint,
  scanTo: bigint
): Promise<{ burnedRaw: bigint; burnCount: number }> {
  const logs = await fetchBurnLogs(scanTo);
  let burnedRaw = 0n;
  let burnCount = 0;
  for (const l of logs) {
    if (l.block <= atBlock) {
      burnedRaw += l.value;
      burnCount++;
    }
  }
  return { burnedRaw, burnCount };
}

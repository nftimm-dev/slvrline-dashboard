/**
 * block-resolver.ts — Binary search to find the block number closest to a given Unix timestamp.
 *
 * Used for:
 *   - "7 days ago" block for APR delta
 *   - "30 days ago" block for emission rate
 *   - Historical backfill sample points
 *
 * Algorithm: binary search between a known lower bound and chain head.
 * Takes ~14 iterations (2^14 = 16384 >> any realistic chain size mismatch).
 * Each iteration is one eth_getBlockByNumber call.
 */

import { archivalGetBlock } from "./rpc";
import { DEPLOY_BLOCK_TOKEN, APPROX_BLOCKS_PER_SEC } from "./constants";

// Cache head block to avoid repeated fetches within a run
let _headCache: { block: bigint; timestamp: bigint; fetchedAt: number } | null = null;
const HEAD_CACHE_TTL_MS = 30_000; // 30s

export async function getHead(): Promise<{ block: bigint; timestamp: bigint }> {
  const now = Date.now();
  if (_headCache && now - _headCache.fetchedAt < HEAD_CACHE_TTL_MS) {
    return { block: _headCache.block, timestamp: _headCache.timestamp };
  }
  const b = await archivalGetBlock("latest");
  if (!b) throw new Error("Failed to fetch latest block");
  _headCache = { block: b.number, timestamp: b.timestamp, fetchedAt: now };
  return { block: b.number, timestamp: b.timestamp };
}

/**
 * Returns the block number whose timestamp is the closest to (but not exceeding) targetTs.
 * Falls back to DEPLOY_BLOCK_TOKEN if targetTs precedes genesis.
 */
export async function resolveBlockAtTimestamp(
  targetTs: bigint,
  lowBlock?: bigint,
  highBlock?: bigint
): Promise<{ block: bigint; timestamp: bigint }> {
  const head = await getHead();

  // Clamp: if target is after head, return head
  if (targetTs >= head.timestamp) {
    return { block: head.block, timestamp: head.timestamp };
  }

  // Get genesis block timestamp
  const genesisBlock = await archivalGetBlock(DEPLOY_BLOCK_TOKEN);
  if (!genesisBlock) throw new Error("Failed to fetch genesis block");

  // If target precedes genesis, return genesis
  if (targetTs <= genesisBlock.timestamp) {
    return { block: genesisBlock.number, timestamp: genesisBlock.timestamp };
  }

  let lo = lowBlock ?? DEPLOY_BLOCK_TOKEN;
  let hi = highBlock ?? head.block;

  // Binary search
  for (let i = 0; i < 20; i++) {
    if (hi - lo <= 1n) break;
    const mid = (lo + hi) / 2n;
    const midBlock = await archivalGetBlock(mid);
    if (!midBlock) break;

    if (midBlock.timestamp <= targetTs) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  const result = await archivalGetBlock(lo);
  if (!result) throw new Error(`Failed to fetch block ${lo}`);
  return { block: result.number, timestamp: result.timestamp };
}

/**
 * Fast approximation: estimate a block number from a timestamp using average block time.
 * Returns a starting estimate that the binary search can refine quickly.
 */
export async function estimateBlockAtTimestamp(
  targetTs: bigint,
  headBlock: bigint,
  headTs: bigint
): Promise<bigint> {
  const deltaTs = headTs - targetTs;
  const deltaBlocks = deltaTs * BigInt(APPROX_BLOCKS_PER_SEC);
  const estimated = headBlock > deltaBlocks ? headBlock - deltaBlocks : DEPLOY_BLOCK_TOKEN;
  return estimated > DEPLOY_BLOCK_TOKEN ? estimated : DEPLOY_BLOCK_TOKEN;
}

/**
 * Resolve block at timestamp with a fast approximation hint to reduce binary search iterations.
 * Typically converges in 3-5 iterations instead of 14.
 */
export async function resolveBlockAtTimestampFast(
  targetTs: bigint
): Promise<{ block: bigint; timestamp: bigint }> {
  const head = await getHead();

  if (targetTs >= head.timestamp) {
    return { block: head.block, timestamp: head.timestamp };
  }

  const genesisBlock = await archivalGetBlock(DEPLOY_BLOCK_TOKEN);
  if (!genesisBlock) throw new Error("Failed to fetch genesis block");

  if (targetTs <= genesisBlock.timestamp) {
    return { block: genesisBlock.number, timestamp: genesisBlock.timestamp };
  }

  // Use approximate block time to get a good starting estimate
  const estimate = await estimateBlockAtTimestamp(targetTs, head.block, head.timestamp);

  // Narrow the search window: +/- 200% of estimate deviation
  // Use a window of ±5 minutes worth of blocks around estimate
  const windowBlocks = BigInt(5 * 60 * APPROX_BLOCKS_PER_SEC);
  const lo = estimate > windowBlocks ? estimate - windowBlocks : DEPLOY_BLOCK_TOKEN;
  const hi = estimate + windowBlocks < head.block ? estimate + windowBlocks : head.block;

  return resolveBlockAtTimestamp(targetTs, lo, hi);
}

/**
 * Generate evenly-spaced sample block numbers from genesis to head for historical backfill.
 * Returns array of { block, timestamp } pairs at ~stepSeconds cadence.
 *
 * Fast path: uses linear interpolation between genesis and head to estimate block numbers.
 * At 100ms/block, the linear estimate is very accurate. We batch fetch blocks in parallel
 * (10 at a time) to verify timestamps. Total RPC calls = ceil(N/10) batches.
 */
export async function generateSampleBlocks(
  stepSeconds: number
): Promise<Array<{ block: bigint; timestamp: bigint }>> {
  const head = await getHead();
  const genesisBlock = await archivalGetBlock(DEPLOY_BLOCK_TOKEN);
  if (!genesisBlock) throw new Error("Failed to fetch genesis block");

  const genesisTs = genesisBlock.timestamp;
  const headTs = head.timestamp;
  const genesisBlockNum = genesisBlock.number;
  const headBlockNum = head.block;

  // Compute linear interpolation factor: blocks per second
  const chainDurationSec = Number(headTs - genesisTs);
  const chainBlocks = Number(headBlockNum - genesisBlockNum);
  const blocksPerSec = chainBlocks / chainDurationSec;

  // Generate all target timestamps first
  const targetTimestamps: bigint[] = [];
  let t = genesisTs;
  while (t <= headTs) {
    targetTimestamps.push(t);
    t += BigInt(stepSeconds);
  }

  // Estimate block numbers for all timestamps via linear interpolation
  const estimatedBlocks: bigint[] = targetTimestamps.map((ts) => {
    const offsetSec = Number(ts - genesisTs);
    const estimated = genesisBlockNum + BigInt(Math.round(offsetSec * blocksPerSec));
    return estimated < genesisBlockNum
      ? genesisBlockNum
      : estimated > headBlockNum
        ? headBlockNum
        : estimated;
  });

  // Batch fetch block timestamps in parallel (10 at a time)
  const BATCH_SIZE = 10;
  const results: Array<{ block: bigint; timestamp: bigint }> = [];

  for (let i = 0; i < estimatedBlocks.length; i += BATCH_SIZE) {
    const batch = estimatedBlocks.slice(i, i + BATCH_SIZE);
    const fetched = await Promise.allSettled(
      batch.map((b) => archivalGetBlock(b))
    );
    for (const r of fetched) {
      if (r.status === "fulfilled" && r.value) {
        results.push({ block: r.value.number, timestamp: r.value.timestamp });
      }
    }
  }

  // Always include head if not already close
  const lastBlock = results.length > 0 ? results[results.length - 1].block : 0n;
  if (lastBlock < headBlockNum - 1000n) {
    results.push(head);
  }

  return results;
}

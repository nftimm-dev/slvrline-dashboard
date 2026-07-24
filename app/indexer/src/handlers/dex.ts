import { ponder } from "ponder:registry";
import { v2Sync, v4Swap } from "ponder:schema";
import { CHAIN_ID, V4_SLVR_ETH_POOL_ID, V4_SLVR_USDG_POOL_ID } from "../lib/constants";

// ── UniswapV2Pair:Sync ────────────────────────────────────────────────────────
// ABI: Sync(reserve0:uint112, reserve1:uint112) — NOT indexed
// Reserve snapshots for price/liquidity time series.
// NOTE: Token order (which reserve is SLVR vs WETH) must be confirmed via token0() in Phase 3.
ponder.on("UniswapV2Pair:Sync", async ({ event, context }) => {
  await context.db
    .insert(v2Sync)
    .values({
      chainId:         CHAIN_ID,
      contractAddress: event.log.address,
      txHash:          event.transaction.hash,
      logIndex:        event.log.logIndex,
      blockNumber:     event.block.number,
      blockTime:       Number(event.block.timestamp),
      reserve0:        event.args.reserve0,
      reserve1:        event.args.reserve1,
    })
    .onConflictDoNothing();
});

// ── UniswapV4PoolManager:Swap ─────────────────────────────────────────────────
// ABI: Swap(id:PoolId indexed, sender indexed, amount0:int128, amount1:int128,
//           sqrtPriceX96:uint160, liquidity:uint128, tick:int24, fee:uint24)
// Filter to SLVR pools only — all other V4 pools are silently ignored.
// amount0 and amount1 are int128 (signed) — negative = pool paid out that token.
ponder.on("UniswapV4PoolManager:Swap", async ({ event, context }) => {
  const poolId = event.args.id as string;

  // Filter: only index SLVR/ETH and SLVR/USDG pools
  if (poolId !== V4_SLVR_ETH_POOL_ID && poolId !== V4_SLVR_USDG_POOL_ID) {
    return; // not a SLVR pool — silently drop
  }

  await context.db
    .insert(v4Swap)
    .values({
      chainId:         CHAIN_ID,
      contractAddress: event.log.address,
      txHash:          event.transaction.hash,
      logIndex:        event.log.logIndex,
      blockNumber:     event.block.number,
      blockTime:       Number(event.block.timestamp),
      poolId:          poolId as `0x${string}`,
      sender:          event.args.sender,
      amount0:         event.args.amount0,          // int128 → bigint (can be negative)
      amount1:         event.args.amount1,          // int128 → bigint (can be negative)
      sqrtPriceX96:    event.args.sqrtPriceX96,    // uint160 → bigint
      liquidity:       event.args.liquidity,        // uint128 → bigint
      tick:            Number(event.args.tick),     // int24 → number (range: -887272 to 887272, safe)
      fee:             Number(event.args.fee),      // uint24 → number
    })
    .onConflictDoNothing();
});

// UniswapV4PoolManager:Initialize — NOT stored (no schema table for pool init in Phase 2 scope).
// The pool ID filter on Swap events serves as implicit verification that SLVR pools exist.
// Phase 4 validation will confirm pool IDs via v4_swap table (spot-check presence of expected pool IDs).

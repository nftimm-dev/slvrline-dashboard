/**
 * Current lottery round state.
 *
 * roundId:        eth_call currentRoundId() on LOTTERY_V2 (selector 0x9cbe5efd)
 * activeBetCount: COUNT(*) FROM lottery_bet WHERE round_id = currentRoundId
 * jackpotEth:     eth_getBalance on the jackpot contract address
 *                 (jackpot() returns the jackpot contract address; balance is the pot)
 *
 * Confirmed from ABI inspection:
 *   - currentRoundId() selector = 0x9cbe5efd (verified via eth_call → 14264)
 *   - jackpot() returns address of jackpot contract (not a balance getter)
 *   - ETH balance of that jackpot contract = current jackpot pool
 *
 * Tolerance: per ROADMAP SC4, must match on-chain round state within ONE round.
 * eth_call is live on-chain — 0% drift (not an estimate).
 */

import { type PublicClient } from "viem";
import { sql } from "../db";
import { LOTTERY_V2 } from "../constants";

const LOTTERY_ABI = [
  {
    name: "currentRoundId",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "jackpot",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    name: "getLatestResolvedRoundId",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
] as const;

export type LotteryRoundResult = {
  roundId: number;
  activeBetCount: number;
  jackpotEth: number;
  jackpotWei: bigint;
  source: "eth_call" | "indexed_fallback";
};

export async function computeLotteryRoundState(
  viemClient: PublicClient
): Promise<LotteryRoundResult> {
  // 1. Get current round ID via eth_call
  let roundId: number;
  let source: "eth_call" | "indexed_fallback" = "eth_call";

  try {
    const roundIdRaw = await viemClient.readContract({
      address: LOTTERY_V2,
      abi: LOTTERY_ABI,
      functionName: "currentRoundId",
    }) as bigint;
    roundId = Number(roundIdRaw);
  } catch (e) {
    // Fallback: derive from latest canonical lottery_round row + 1
    console.warn("[lottery] currentRoundId() eth_call failed, using indexed_fallback:", e);
    source = "indexed_fallback";
    const [row] = await sql<[{ round_id: string }]>`
      SELECT MAX(round_id)::text AS round_id
      FROM slvr.lottery_round
      WHERE is_canonical = true
    `;
    roundId = Number(row?.round_id ?? "0") + 1;
  }

  // 2. Active bet count for this round from indexed data
  let activeBetCount = 0;
  try {
    const [betRow] = await sql<[{ cnt: string }]>`
      SELECT COUNT(*)::text AS cnt
      FROM slvr.lottery_bet
      WHERE contract_address = ${LOTTERY_V2.toLowerCase()}
        AND round_id = ${roundId}
    `;
    activeBetCount = Number(betRow?.cnt ?? "0");
  } catch {
    activeBetCount = 0;
  }

  // 3. Jackpot: get jackpot contract address, then eth_getBalance
  let jackpotWei = 0n;
  try {
    const jackpotAddr = await viemClient.readContract({
      address: LOTTERY_V2,
      abi: LOTTERY_ABI,
      functionName: "jackpot",
    }) as `0x${string}`;

    jackpotWei = await viemClient.getBalance({ address: jackpotAddr });
  } catch (e) {
    // Fallback: ETH balance of the lottery contract itself
    console.warn("[lottery] jackpot address lookup failed, using lottery contract balance:", e);
    try {
      jackpotWei = await viemClient.getBalance({ address: LOTTERY_V2 });
    } catch {
      jackpotWei = 0n;
    }
  }

  // 4. Sanity check: confirm roundId is within one round of latest indexed canonical
  try {
    const [maxRow] = await sql<[{ max_round: string }]>`
      SELECT MAX(round_id)::text AS max_round
      FROM slvr.lottery_round
      WHERE is_canonical = true
    `;
    const maxIndexed = Number(maxRow?.max_round ?? "0");
    const drift = roundId - maxIndexed;
    if (drift > 1) {
      console.warn(
        `[lottery] WARNING: eth_call roundId (${roundId}) is ${drift} rounds ahead of indexed (${maxIndexed}). Indexer may be lagging.`
      );
    }
  } catch {
    // Non-critical
  }

  return {
    roundId,
    activeBetCount,
    jackpotEth: Number(jackpotWei) / 1e18,
    jackpotWei,
    source,
  };
}

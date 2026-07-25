/**
 * veSLVR + LP staking totals — reads ON-CHAIN STATE, not fragile event parsing.
 *
 * veSLVR (FIX 1):
 *   1. Enumerate every ve lock tokenId ever minted: getLogs on VOTE_ESCROW for ERC-721
 *      mints — Transfer(from=0x0) — across genesis→block, adaptively (getLogsAdaptive,
 *      PRIMARY-pinned + subdivision; plain round-robin getLogs silently under-counts on
 *      wide historical ranges — see rpc.ts). tokenId is the indexed topic3.
 *   2. For each unique tokenId, eth_call `locks(tokenId)` → (amount, lockStart, lockEnd,
 *      permanent, isMaxTime). This reads CURRENT state, so it self-corrects for
 *      withdrawals (withdrawn locks read amount 0) and permanent conversions.
 *   3. If amount > 0: add to total; classify permanent when (permanent==true OR lockEnd==0),
 *      else time-locked. Sum totals + active lock count.
 *
 * Expected @ head: total ≈12,110, permanent ≈10,877, time-locked ≈1,233, active ≈933.
 *
 * NOTE: Permanent locks BURN the underlying SLVR (RESEARCH.md §5). Counting them in
 * total_staked is informational — those tokens are no longer in totalSupply().
 *
 * LP staking: totalStaked() on the LP staking contract (single eth_call) — returns LP
 * tokens staked (not raw SLVR). Kept as-is.
 */

import { toFunctionSelector, encodeAbiParameters, decodeAbiParameters, parseAbiParameters } from "viem";
import {
  VOTE_ESCROW,
  LP_STAKING,
  SLVR_TOKEN,
  DEPLOY_BLOCK_TOKEN,
} from "../constants";
import { archivalCall, getLogsAdaptive, decodeUint256, TRANSFER_TOPIC0, ZERO_TOPIC } from "../rpc";
import { getHead } from "../block-resolver";

// Function selectors
const LP_TOTAL_STAKED_SEL = "0x817b1cd2"; // totalStaked()
const BALANCE_OF_SEL = "0x70a08231";      // balanceOf(address)

// locks(uint256) → (uint256 amount, uint256 lockStart, uint256 lockEnd, bool permanent, bool isMaxTime)
const LOCKS_SEL = toFunctionSelector(
  "function locks(uint256) view returns (uint256,uint256,uint256,bool,bool)"
);
const LOCKS_OUT = parseAbiParameters("uint256, uint256, uint256, bool, bool");
const UINT256 = parseAbiParameters("uint256");

// Concurrency for the ~1,600 locks() eth_calls.
const LOCKS_CONCURRENCY = 10;

export type VeLock = {
  tokenId: string;
  owner: string;
  amountRaw: bigint;
  permanent: boolean;
  lockEnd: bigint;
};

export type StakingResult = {
  totalLockedRaw: bigint;
  timelockedRaw: bigint;
  permanentRaw: bigint;
  activeLockCount: number;
  lpStakedRaw: bigint;
  lpStakedHuman: number;
  /** Every ACTIVE lock (amount > 0), with current owner. Empty on fallback. */
  activeLocks: VeLock[];
  source: "ve_onchain_state" | "ve_balance_fallback";
  note: string;
};

export async function computeStaking(atBlock?: bigint): Promise<StakingResult> {
  const head = await getHead();
  const block = atBlock ?? head.block;

  // 1. LP staking totalStaked (easy: single eth_call)
  let lpStakedRaw = 0n;
  try {
    const lpHex = await archivalCall(LP_STAKING, LP_TOTAL_STAKED_SEL, block);
    lpStakedRaw = decodeUint256(lpHex);
  } catch (e) {
    console.warn("[staking] LP totalStaked() failed:", String(e));
  }

  // 2. veSLVR locks: on-chain state reconstruction
  try {
    const lockResult = await computeVeLockTotals(block);
    return {
      ...lockResult,
      lpStakedRaw,
      lpStakedHuman: Number(lpStakedRaw) / 1e18,
    };
  } catch (e) {
    console.warn("[staking] ve_onchain_state failed, falling back to balanceOf:", String(e));
  }

  // (fallback below)

  // 3. Fallback: balanceOf(voteEscrow) ≈ time-locked SLVR (permanent locks are burned).
  let balanceFallback = 0n;
  try {
    const addr = VOTE_ESCROW.toLowerCase().replace("0x", "").padStart(64, "0");
    const hex = await archivalCall(SLVR_TOKEN, BALANCE_OF_SEL + addr, block);
    balanceFallback = decodeUint256(hex);
  } catch {
    balanceFallback = 0n;
  }

  return {
    totalLockedRaw: balanceFallback,
    timelockedRaw: balanceFallback,
    permanentRaw: 0n,
    activeLockCount: -1,
    lpStakedRaw,
    lpStakedHuman: Number(lpStakedRaw) / 1e18,
    activeLocks: [],
    source: "ve_balance_fallback",
    note: "Fallback: balanceOf(voteEscrow) = time-locked only. Permanent locks are burned and not included. On-chain enumeration failed.",
  };
}

async function computeVeLockTotals(
  atBlock: bigint
): Promise<Pick<StakingResult, "totalLockedRaw" | "timelockedRaw" | "permanentRaw" | "activeLockCount" | "activeLocks" | "source" | "note">> {
  // Step 1: enumerate every ve lock tokenId ever minted (ERC-721 Transfer from 0x0).
  // topics = [sig, from(0x0), to, tokenId]; owner (soulbound → mint `to`) at topic2,
  // tokenId indexed at topic3.
  const mintLogs = await getLogsAdaptive({
    address: VOTE_ESCROW,
    topics: [TRANSFER_TOPIC0, ZERO_TOPIC], // [Transfer, from=0x0]  (to, tokenId not filtered)
    fromBlock: DEPLOY_BLOCK_TOKEN,
    toBlock: atBlock,
  });

  const idToOwner = new Map<string, string>();
  for (const lg of mintLogs) {
    if (lg.topics.length >= 4) {
      const tokenId = lg.topics[3];
      const owner = "0x" + lg.topics[2].slice(26); // last 20 bytes of the 32-byte topic
      idToOwner.set(tokenId, owner);
    }
  }

  if (idToOwner.size === 0) {
    return {
      totalLockedRaw: 0n,
      timelockedRaw: 0n,
      permanentRaw: 0n,
      activeLockCount: 0,
      activeLocks: [],
      source: "ve_onchain_state",
      note: "No ve lock mints found.",
    };
  }

  // Step 2+3: read current locks(tokenId) state for each, sum + classify.
  const ids = [...idToOwner.keys()];
  let totalLockedRaw = 0n;
  let timelockedRaw = 0n;
  let permanentRaw = 0n;
  let activeLockCount = 0;
  const activeLocks: VeLock[] = [];

  for (let i = 0; i < ids.length; i += LOCKS_CONCURRENCY) {
    const batch = ids.slice(i, i + LOCKS_CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (tid) => {
        const calldata =
          LOCKS_SEL + encodeAbiParameters(UINT256, [BigInt(tid)]).slice(2);
        const hex = await archivalCall(VOTE_ESCROW, calldata, atBlock);
        try {
          return { tid, decoded: decodeAbiParameters(LOCKS_OUT, hex as `0x${string}`) };
        } catch {
          return { tid, decoded: null };
        }
      })
    );

    for (const r of results) {
      if (!r.decoded) continue;
      const amount = r.decoded[0] as bigint;
      const lockEnd = r.decoded[2] as bigint;
      const permanent = r.decoded[3] as boolean;
      if (amount <= 0n) continue; // withdrawn/empty
      totalLockedRaw += amount;
      activeLockCount++;
      const isPerm = permanent || lockEnd === 0n;
      if (isPerm) {
        permanentRaw += amount;
      } else {
        timelockedRaw += amount;
      }
      activeLocks.push({
        tokenId: r.tid,
        owner: idToOwner.get(r.tid) ?? "0x0000000000000000000000000000000000000000",
        amountRaw: amount,
        permanent: isPerm,
        lockEnd,
      });
    }
  }

  return {
    totalLockedRaw,
    timelockedRaw,
    permanentRaw,
    activeLockCount,
    activeLocks,
    source: "ve_onchain_state",
    note: `On-chain state: ${ids.length} lock tokenIds enumerated, ${activeLockCount} active (amount>0).`,
  };
}

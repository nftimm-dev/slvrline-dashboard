/**
 * veSLVR lock enumeration — reads ON-CHAIN STATE, not fragile event parsing.
 *
 * Mirrors app/metrics/src/formulas/staking.ts, reimplemented viem-free:
 *   1. Enumerate every ve lock tokenId ever minted: getLogsAdaptive on VOTE_ESCROW
 *      for ERC-721 mints Transfer(from=0x0) across genesis→head. PRIMARY-pinned +
 *      subdivision — plain round-robin getLogs silently under-counts on wide ranges.
 *      tokenId is indexed topic3; owner (soulbound → current owner) is topic2.
 *   2. For each unique tokenId, eth_call locks(tokenId) → (amount, lockStart, lockEnd,
 *      permanent, isMaxTime). Current state self-corrects for withdrawals (amount 0)
 *      and permanent conversions.
 *   3. amount > 0 → active. Classify permanent when (permanent==true OR lockEnd==0).
 *
 * Expected @ head: total ≈12,119, permanent ≈10,885, time-locked ≈1,234, active ≈933.
 *
 * NOTE: permanent locks BURN the underlying SLVR — counting them in "total staked" is
 * informational; those tokens are no longer in totalSupply().
 *
 * Heavy (~1,600 tokenIds). Cache the aggregate ~30min upstream.
 */
import {
  ethCall,
  ethBlockNumber,
  getLogsAdaptive,
  decodeUint256,
  encodeUint256,
  wordAt,
  TRANSFER_TOPIC0,
  ZERO_TOPIC,
} from "./rpc";

const VOTE_ESCROW = "0xd9b8FBD61033145c5496132153CE675756313B71";
const LP_STAKING = "0x7D888f4Ca88Fc3578aEfc45C82482Bd66415DfeA";
const DEPLOY_BLOCK_TOKEN = 5_574_774n;

// Selectors (verified against on-chain returns; keccak256 4-byte prefixes).
const LP_TOTAL_STAKED_SEL = "0x817b1cd2"; // totalStaked()
const LOCKS_SELECTOR = "0xf4dadc61"; // locks(uint256)

const LOCKS_CONCURRENCY = 12;

export interface VeLock {
  tokenId: string;
  owner: string;
  amountRaw: bigint;
  permanent: boolean;
  lockEnd: bigint;
}

export interface VeAggregate {
  totalLockedRaw: bigint;
  permanentRaw: bigint;
  timelockedRaw: bigint;
  activeLockCount: number;
  lpStakedRaw: bigint;
  locks: VeLock[];
  atBlock: string;
  source: "ve_onchain_state" | "ve_balance_fallback";
}

/** Enumerate ve lock mints → {tokenId, owner}. */
async function enumerateMints(
  toBlock: bigint
): Promise<Map<string, string>> {
  const mintLogs = await getLogsAdaptive({
    address: VOTE_ESCROW,
    topics: [TRANSFER_TOPIC0, ZERO_TOPIC], // [Transfer, from=0x0]
    fromBlock: DEPLOY_BLOCK_TOKEN,
    toBlock,
  });

  // topics = [sig, from(0x0), to, tokenId]. Owner is topic2, tokenId topic3.
  // Soulbound NFTs → mint `to` is the current owner.
  const idToOwner = new Map<string, string>();
  for (const lg of mintLogs) {
    if (lg.topics.length >= 4) {
      const tokenId = lg.topics[3];
      const owner = "0x" + lg.topics[2].slice(26); // last 20 bytes of the 32-byte topic
      idToOwner.set(tokenId, owner);
    }
  }
  return idToOwner;
}

export async function computeVeAggregate(): Promise<VeAggregate> {
  const head = await ethBlockNumber();
  const atBlockHex = "0x" + head.toString(16);

  // LP staking totalStaked (single call; independent of ve).
  let lpStakedRaw = 0n;
  try {
    const lpHex = await ethCall(LP_STAKING, LP_TOTAL_STAKED_SEL, head);
    lpStakedRaw = decodeUint256(lpHex);
  } catch (e) {
    console.warn("[veLocks] LP totalStaked() failed:", String(e));
  }

  const idToOwner = await enumerateMints(head);
  const ids = [...idToOwner.keys()];

  if (ids.length === 0) {
    return {
      totalLockedRaw: 0n,
      permanentRaw: 0n,
      timelockedRaw: 0n,
      activeLockCount: 0,
      lpStakedRaw,
      locks: [],
      atBlock: atBlockHex,
      source: "ve_onchain_state",
    };
  }

  let totalLockedRaw = 0n;
  let permanentRaw = 0n;
  let timelockedRaw = 0n;
  let activeLockCount = 0;
  const locks: VeLock[] = [];

  for (let i = 0; i < ids.length; i += LOCKS_CONCURRENCY) {
    const batch = ids.slice(i, i + LOCKS_CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (tid) => {
        const calldata = LOCKS_SELECTOR + encodeUint256(BigInt(tid));
        try {
          const hex = await ethCall(VOTE_ESCROW, calldata, head);
          return { tid, hex };
        } catch {
          return { tid, hex: null as string | null };
        }
      })
    );

    for (const { tid, hex } of results) {
      if (!hex || hex === "0x") continue;
      // (amount, lockStart, lockEnd, permanent, isMaxTime) — 5 words.
      const amount = wordAt(hex, 0);
      const lockEnd = wordAt(hex, 2);
      const permanent = wordAt(hex, 3) !== 0n;
      if (amount <= 0n) continue; // withdrawn/empty
      totalLockedRaw += amount;
      activeLockCount++;
      const isPerm = permanent || lockEnd === 0n;
      if (isPerm) permanentRaw += amount;
      else timelockedRaw += amount;
      locks.push({
        tokenId: tid,
        owner: idToOwner.get(tid) ?? "0x0000000000000000000000000000000000000000",
        amountRaw: amount,
        permanent: isPerm,
        lockEnd,
      });
    }
  }

  return {
    totalLockedRaw,
    permanentRaw,
    timelockedRaw,
    activeLockCount,
    lpStakedRaw,
    locks,
    atBlock: atBlockHex,
    source: "ve_onchain_state",
  };
}

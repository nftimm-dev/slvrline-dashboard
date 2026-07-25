/**
 * veSLVR lock enumeration — reads ON-CHAIN STATE, not fragile event parsing.
 *
 * Mirrors app/metrics/src/formulas/staking.ts, reimplemented viem-free:
 *   1. Enumerate every ve lock tokenId ever minted: getLogsAdaptive on VOTE_ESCROW
 *      for ERC-721 mints Transfer(from=0x0) across genesis→head. PRIMARY-pinned +
 *      subdivision — plain round-robin getLogs silently under-counts on wide ranges.
 *      tokenId is indexed topic3; owner (soulbound → current owner) is topic2.
 *   2. For each unique tokenId, call locks(tokenId) via Multicall3 aggregate3 batched
 *      ~400 per eth_call → (amount, lockStart, lockEnd, permanent, isMaxTime). Current
 *      state self-corrects for withdrawals (amount 0) and permanent conversions.
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
  sleep,
  TRANSFER_TOPIC0,
  ZERO_TOPIC,
  RPC_PRIMARY,
} from "./rpc";

const VOTE_ESCROW = "0xd9b8FBD61033145c5496132153CE675756313B71";
const LP_STAKING = "0x7D888f4Ca88Fc3578aEfc45C82482Bd66415DfeA";
const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11";
const DEPLOY_BLOCK_TOKEN = 5_574_774n;

// Selectors (verified against on-chain returns; keccak256 4-byte prefixes).
const LP_TOTAL_STAKED_SEL = "0x817b1cd2"; // totalStaked()
const LOCKS_SELECTOR = "0xf4dadc61"; // locks(uint256)
const AGGREGATE3_SELECTOR = "0x82ad56cb"; // aggregate3((address,bool,bytes)[])

// Multicall3 batch size: 200 per request → ~8 requests for 1,596 tokenIds.
// 200 calls × 224 bytes/call ≈ 45 KB calldata — within typical RPC limits.
const MULTICALL_BATCH = 200;

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

// ---------------------------------------------------------------------------
// Multicall3 ABI encode/decode (hand-rolled, no viem)
// ---------------------------------------------------------------------------

/**
 * Encode a call to Multicall3.aggregate3((address,bool,bytes)[]).
 *
 * ABI for aggregate3((address target, bool allowFailure, bytes callData)[]):
 *   - selector (4 bytes)
 *   - top-level offset word: 0x20 (the sole argument, the array, starts at word 1)
 *   - array length word: N
 *   - N offset words: each offset is relative to the byte immediately after the length word;
 *     each struct has a dynamic `bytes` field so each array element is itself offset-encoded.
 *   - N struct encodings, each:
 *       word0: address (left-padded to 32 bytes)
 *       word1: bool allowFailure (0 or 1)
 *       word2: offset to bytes data within this struct = 0x60 (3 words forward)
 *       word3: bytes length in bytes
 *       word4+: bytes data, right-padded to 32-byte boundary
 *
 * For locks(uint256): callData = 4-byte selector + 32-byte uint256 = 36 bytes → 64 bytes padded.
 * Each struct is therefore 5 words + 2 data words = 7 words = 224 bytes.
 */
function encodeAggregate3(
  calls: Array<{ target: string; allowFailure: boolean; callData: string }>
): string {
  const n = calls.length;

  const callDataHexes = calls.map((c) =>
    c.callData.startsWith("0x") ? c.callData.slice(2) : c.callData
  );

  // Byte length of each struct's encoding.
  function structByteLen(cdHex: string): number {
    const byteLen = cdHex.length / 2;
    const paddedLen = Math.ceil(Math.max(byteLen, 1) / 32) * 32;
    // addr(32) + bool(32) + bytes_offset(32) + bytes_len(32) + data(paddedLen)
    return 128 + paddedLen;
  }

  // Struct offsets are relative to the byte immediately after the length word.
  // The offset table itself is N * 32 bytes.
  const structOffsets: number[] = [];
  let runningOffset = n * 32;
  for (let i = 0; i < n; i++) {
    structOffsets.push(runningOffset);
    runningOffset += structByteLen(callDataHexes[i]);
  }

  const parts: string[] = [];

  // Top-level: offset to the sole arg (the array) = 0x20.
  parts.push(encodeUint256(0x20n));
  // Array length.
  parts.push(encodeUint256(BigInt(n)));
  // Offset words.
  for (let i = 0; i < n; i++) {
    parts.push(encodeUint256(BigInt(structOffsets[i])));
  }
  // Struct encodings.
  for (let i = 0; i < n; i++) {
    const c = calls[i];
    const cdHex = callDataHexes[i];
    const byteLen = cdHex.length / 2;
    const paddedLen = Math.ceil(Math.max(byteLen, 1) / 32) * 32;

    parts.push(c.target.toLowerCase().replace(/^0x/, "").padStart(64, "0"));
    parts.push(encodeUint256(c.allowFailure ? 1n : 0n));
    parts.push(encodeUint256(0x60n)); // bytes data is 3 words forward
    parts.push(encodeUint256(BigInt(byteLen)));
    parts.push(cdHex.padEnd(paddedLen * 2, "0"));
  }

  return AGGREGATE3_SELECTOR + parts.join("");
}

/**
 * Decode the return of aggregate3: ((bool success, bytes returnData)[]).
 *
 * Return layout (starting from byte 0 of the return data):
 *   word 0 (bytes 0–31):   offset to array body = 0x20
 *   word 1 (bytes 32–63):  array length N
 *   words 2..N+1:          element offsets, each relative to byte after the length word
 *   each element:
 *     word 0: bool success
 *     word 1: offset to bytes data within this element = 0x40 (2 words forward)
 *     word 2 (at offset 0x40 from elem start): bytes length
 *     word 3+: bytes data, padded
 */
function decodeAggregate3Result(hex: string): Array<{ success: boolean; data: string }> {
  const body = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (!body) return [];

  function wordAtByte(byteOffset: number): bigint {
    const c = byteOffset * 2;
    const s = body.slice(c, c + 64);
    return s.length === 64 ? BigInt("0x" + s) : 0n;
  }

  const arrayOffset = Number(wordAtByte(0)); // should be 32 (0x20)
  const n = Number(wordAtByte(arrayOffset));
  const offsetsBase = arrayOffset + 32; // byte offset of the first element-offset word

  const results: Array<{ success: boolean; data: string }> = [];
  for (let i = 0; i < n; i++) {
    const elemRelOffset = Number(wordAtByte(offsetsBase + i * 32));
    const elemBase = offsetsBase + elemRelOffset; // absolute byte position of element

    const success = wordAtByte(elemBase) !== 0n;
    // Offset to bytes returnData within this element (word 1 of element).
    const bytesRelOffset = Number(wordAtByte(elemBase + 32));
    const bytesBase = elemBase + bytesRelOffset; // absolute byte position of bytes value
    const bytesLen = Number(wordAtByte(bytesBase));
    const dataCharStart = (bytesBase + 32) * 2;
    const dataHex = body.slice(dataCharStart, dataCharStart + bytesLen * 2);

    results.push({ success, data: dataHex ? "0x" + dataHex : "0x" });
  }

  return results;
}

/**
 * Execute one aggregate3 batch against the PRIMARY RPC with retry + backoff.
 * On repeated failure, halves the batch and retries each half.
 */
async function runAggregate3Batch(
  calls: Array<{ target: string; allowFailure: boolean; callData: string }>,
  block: bigint,
  depth = 0
): Promise<Array<{ success: boolean; data: string }>> {
  if (calls.length === 0) return [];

  const calldata = encodeAggregate3(calls);
  const blockHex = "0x" + block.toString(16);

  const reqBody = JSON.stringify({
    jsonrpc: "2.0",
    method: "eth_call",
    params: [{ to: MULTICALL3, data: calldata }, blockHex],
    id: 1,
  });

  const MAX_ATTEMPTS = 4;
  const BASE_DELAY = 300;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30_000);
      let resp: Response;
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

      if (!resp.ok) {
        await sleep(BASE_DELAY * Math.pow(2, attempt));
        continue;
      }

      const j = (await resp.json()) as {
        result?: string;
        error?: { code: number; message: string };
      };

      if (j.error) {
        const m = (j.error.message || "").toLowerCase();
        const isRate =
          j.error.code === -32005 ||
          m.includes("limit") ||
          m.includes("429") ||
          m.includes("rate") ||
          m.includes("too many");
        if (isRate) {
          await sleep(1500 * Math.pow(2, attempt));
          continue;
        }
        // Other error (timeout, revert) → fall through to halve.
        break;
      }

      if (j.result && j.result !== "0x") {
        return decodeAggregate3Result(j.result);
      }

      await sleep(BASE_DELAY * Math.pow(2, attempt));
    } catch {
      await sleep(BASE_DELAY * Math.pow(2, attempt));
    }
  }

  // Halve the batch and retry (up to depth 4).
  if (calls.length > 1 && depth < 4) {
    const mid = Math.ceil(calls.length / 2);
    const left = calls.slice(0, mid);
    const right = calls.slice(mid);
    console.warn(
      `[veLocks] aggregate3 batch=${calls.length} failed; splitting ${left.length}+${right.length}`
    );
    const [leftRes, rightRes] = await Promise.all([
      runAggregate3Batch(left, block, depth + 1),
      runAggregate3Batch(right, block, depth + 1),
    ]);
    return [...leftRes, ...rightRes];
  }

  console.warn(`[veLocks] aggregate3 leaf batch=${calls.length} gave up`);
  return calls.map(() => ({ success: false, data: "0x" }));
}

/**
 * Batch-read locks(tokenId) for all ids via Multicall3 aggregate3.
 * Builds ~MULTICALL_BATCH-sized batches and fires them all in parallel.
 * ~8 concurrent eth_calls for 1,596 tokenIds → ~2-3s wall time.
 */
async function batchReadLocks(
  ids: string[],
  block: bigint
): Promise<Map<string, { amount: bigint; lockEnd: bigint; permanent: boolean } | null>> {
  // Split all ids into batches.
  const batches: Array<{ ids: string[]; calls: Array<{ target: string; allowFailure: boolean; callData: string }> }> = [];
  for (let batchStart = 0; batchStart < ids.length; batchStart += MULTICALL_BATCH) {
    const batchIds = ids.slice(batchStart, batchStart + MULTICALL_BATCH);
    const batchCalls = batchIds.map((tid) => ({
      target: VOTE_ESCROW,
      allowFailure: true,
      callData: LOCKS_SELECTOR + encodeUint256(BigInt(tid)),
    }));
    batches.push({ ids: batchIds, calls: batchCalls });
  }

  // Fire all batches concurrently.
  const allBatchResults = await Promise.all(
    batches.map((b) => runAggregate3Batch(b.calls, block))
  );

  const result = new Map<
    string,
    { amount: bigint; lockEnd: bigint; permanent: boolean } | null
  >();

  for (let b = 0; b < batches.length; b++) {
    const { ids: batchIds } = batches[b];
    const batchResults = allBatchResults[b];
    for (let j = 0; j < batchIds.length; j++) {
      const tid = batchIds[j];
      const res = batchResults[j];
      if (!res || !res.success || !res.data || res.data === "0x") {
        result.set(tid, null);
        continue;
      }
      const amount = wordAt(res.data, 0);
      const lockEnd = wordAt(res.data, 2);
      const permanent = wordAt(res.data, 3) !== 0n;
      result.set(tid, { amount, lockEnd, permanent });
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

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

  // Batch-read all lock states via Multicall3.
  const t0 = Date.now();
  console.log(`[veLocks] batch-reading ${ids.length} locks via Multicall3 (batch=${MULTICALL_BATCH})…`);
  const lockMap = await batchReadLocks(ids, head);
  console.log(`[veLocks] Multicall3 complete in ${((Date.now() - t0) / 1000).toFixed(2)}s`);

  let totalLockedRaw = 0n;
  let permanentRaw = 0n;
  let timelockedRaw = 0n;
  let activeLockCount = 0;
  const locks: VeLock[] = [];

  for (const tid of ids) {
    const lock = lockMap.get(tid);
    if (!lock || lock.amount <= 0n) continue;

    const { amount, lockEnd, permanent } = lock;
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

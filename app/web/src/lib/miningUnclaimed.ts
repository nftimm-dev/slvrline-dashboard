/**
 * "Unclaimed SLVR by miner" — WHO is owed the Grid Mining unclaimed-rewards pool.
 *
 * The Grid Mining V2 contract (GridLottery V2, 0xB0Cc…0c71) holds ~totalUnclaimed()
 * SLVR of accrued-but-unclaimed mining rewards. This module breaks that pool down
 * PER MINER so the /mining page can show a holders-list-style ranking.
 *
 * HOW (verified against the verified source + on-chain reconciliation):
 *   1. Enumerate miner addresses from BetPlaced(roundId, beneficiary, total, squares)
 *      logs on V2 (beneficiary is indexed topic2) via getLogsAdaptive across
 *      genesis→head, deduped. PRIMARY-pinned + subdivided — the secondary RPC
 *      silently truncates wide getLogs ranges.
 *   2. Multicall3 aggregate3-batch getMinerState(miner) for every miner and read
 *      `rewardsSlvr` (word 0) — the miner's current UNCLAIMED SLVR balance. Filter >0.
 *
 * WHY rewardsSlvr is the right field (not getUnclaimedSlvrPerRound):
 *   getMinerState returns (rewardsSlvr, refinedAccrued, indexSnapshot, hasAccount).
 *   - `rewardsSlvr` is the miner's unclaimed principal; SUM(rewardsSlvr) reconciles to
 *     totalUnclaimed() within a small residual (see below).
 *   - `refinedAccrued` is a SEPARATE refining BONUS accrued to that miner; it is NOT
 *     part of totalUnclaimed(), so we surface it as extra context, never fold it in.
 *   - getUnclaimedSlvrPerRound(roundId, account) is DEAD in the deployed contract:
 *     the backing mapping is declared + returned but never written → always 0. So it
 *     is NOT a usable fallback; we rely on rewardsSlvr, which reconciles.
 *
 * RECONCILIATION (checked live at build time, ~577 SLVR pool):
 *   SUM(rewardsSlvr) ≈ totalUnclaimed() to within ~0.5% (a few SLVR). The residual is
 *   the contract's LAZY checkpointing: totalUnclaimed grows at round resolution
 *   (totalUnclaimed += slvrForWinners) for ALL winners, but a winner's per-account
 *   rewardsSlvr is only populated once they interact (claim), so very recent winners
 *   who have not claimed sit in the aggregate but not yet in any per-miner balance. We
 *   report this reconciliation transparently rather than fabricating a split.
 *
 * Cache: 5 minutes.
 */
import { withCache } from "./cache";
import {
  ethCall,
  ethBlockNumber,
  getLogsAdaptive,
  decodeUint256,
  encodeAddress,
  encodeUint256,
  wordAt,
  sleep,
  RPC_PRIMARY,
} from "./rpc";
import { getLabel, getBlockscoutUrl } from "./labels";

const LOTTERY_V2 = "0xB0Cc994Ce4E8fb106da9Eb36e26fDd8C5f1e0c71";
const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11";

// V2 deploy / migration block (accumulator reset). BetPlaced never precedes it.
const V2_DEPLOY_BLOCK = 16_764_101n;

// keccak256("BetPlaced(uint256,address,uint256,uint8[])")
const BET_PLACED_TOPIC0 =
  "0xd60a2fc8819207eb21f78d0ae6d3c0a97cc7a3e76eb20e4d8c3049023f9da306";

// Selectors (keccak256(sig)[:4] — verified against the deployed V2 contract).
const GET_MINER_STATE_SEL = "0xe8fd1cb9"; // getMinerState(address)
const TOTAL_UNCLAIMED_SEL = "0xc96f14b8"; // totalUnclaimed()
const MINER_INDEX_SEL = "0x9806b4d2"; // minerIndex()
const AGGREGATE3_SELECTOR = "0x82ad56cb"; // aggregate3((address,bool,bytes)[])

const WAD = 1e18;
const MULTICALL_BATCH = 300; // getMinerState calldata is tiny (36 bytes) → 300/call is safe
const CACHE_TTL = 300; // 5 min
const CACHE_KEY = "mining:unclaimed-by-miner";
const TOP_N = 50;

export interface UnclaimedMinerRow {
  rank: number;
  address: string;
  label: string | null;
  blockscoutUrl: string;
  /** Miner's current unclaimed SLVR (getMinerState.rewardsSlvr). */
  unclaimedSlvr: number;
  /** % of totalUnclaimed() this miner represents. */
  pct: number;
  /** Separate refining bonus accrued to this miner (NOT part of the pool). */
  refinedAccruedSlvr: number;
}

export interface MiningUnclaimedData {
  /** Contract aggregate: totalUnclaimed() in SLVR — the pool total. */
  totalUnclaimed: number;
  /** Sum of per-miner rewardsSlvr — should reconcile to totalUnclaimed. */
  sumMinerUnclaimed: number;
  /** totalUnclaimed − sumMinerUnclaimed (the lazy-checkpoint residual), SLVR. */
  reconciliationResidual: number;
  /** |residual| / totalUnclaimed × 100. */
  reconciliationPct: number;
  /** How many distinct miner accounts we enumerated from BetPlaced. */
  minersEnumerated: number;
  /** How many of those are currently owed (rewardsSlvr > 0). */
  minerCount: number;
  /** current minerIndex (WAD-scaled → human). Context only. */
  minerIndex: number;
  /** Top-N miners owed, ranked desc by unclaimed SLVR. */
  top: UnclaimedMinerRow[];
  atBlock: string;
  cachedAt: string;
  cacheTtlSeconds: number;
}

// ---------------------------------------------------------------------------
// Multicall3 aggregate3 encode/decode (hand-rolled — mirrors lib/veLocks.ts)
// ---------------------------------------------------------------------------

function encodeAggregate3(
  calls: Array<{ target: string; allowFailure: boolean; callData: string }>
): string {
  const n = calls.length;
  const callDataHexes = calls.map((c) =>
    c.callData.startsWith("0x") ? c.callData.slice(2) : c.callData
  );

  function structByteLen(cdHex: string): number {
    const byteLen = cdHex.length / 2;
    const paddedLen = Math.ceil(Math.max(byteLen, 1) / 32) * 32;
    return 128 + paddedLen; // addr + bool + bytesOffset + bytesLen + data
  }

  const structOffsets: number[] = [];
  let runningOffset = n * 32;
  for (let i = 0; i < n; i++) {
    structOffsets.push(runningOffset);
    runningOffset += structByteLen(callDataHexes[i]);
  }

  const parts: string[] = [];
  parts.push(encodeUint256(0x20n)); // offset to the sole arg (the array)
  parts.push(encodeUint256(BigInt(n))); // array length
  for (let i = 0; i < n; i++) parts.push(encodeUint256(BigInt(structOffsets[i])));
  for (let i = 0; i < n; i++) {
    const c = calls[i];
    const cdHex = callDataHexes[i];
    const byteLen = cdHex.length / 2;
    const paddedLen = Math.ceil(Math.max(byteLen, 1) / 32) * 32;
    parts.push(c.target.toLowerCase().replace(/^0x/, "").padStart(64, "0"));
    parts.push(encodeUint256(c.allowFailure ? 1n : 0n));
    parts.push(encodeUint256(0x60n));
    parts.push(encodeUint256(BigInt(byteLen)));
    parts.push(cdHex.padEnd(paddedLen * 2, "0"));
  }

  return AGGREGATE3_SELECTOR + parts.join("");
}

function decodeAggregate3Result(
  hex: string
): Array<{ success: boolean; data: string }> {
  const body = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (!body) return [];

  function wordAtByte(byteOffset: number): bigint {
    const c = byteOffset * 2;
    const s = body.slice(c, c + 64);
    return s.length === 64 ? BigInt("0x" + s) : 0n;
  }

  const arrayOffset = Number(wordAtByte(0));
  const n = Number(wordAtByte(arrayOffset));
  const offsetsBase = arrayOffset + 32;

  const results: Array<{ success: boolean; data: string }> = [];
  for (let i = 0; i < n; i++) {
    const elemRelOffset = Number(wordAtByte(offsetsBase + i * 32));
    const elemBase = offsetsBase + elemRelOffset;
    const success = wordAtByte(elemBase) !== 0n;
    const bytesRelOffset = Number(wordAtByte(elemBase + 32));
    const bytesBase = elemBase + bytesRelOffset;
    const bytesLen = Number(wordAtByte(bytesBase));
    const dataCharStart = (bytesBase + 32) * 2;
    const dataHex = body.slice(dataCharStart, dataCharStart + bytesLen * 2);
    results.push({ success, data: dataHex ? "0x" + dataHex : "0x" });
  }

  return results;
}

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
        break; // other error → halve
      }

      if (j.result && j.result !== "0x") {
        return decodeAggregate3Result(j.result);
      }
      await sleep(BASE_DELAY * Math.pow(2, attempt));
    } catch {
      await sleep(BASE_DELAY * Math.pow(2, attempt));
    }
  }

  if (calls.length > 1 && depth < 4) {
    const mid = Math.ceil(calls.length / 2);
    const [leftRes, rightRes] = await Promise.all([
      runAggregate3Batch(calls.slice(0, mid), block, depth + 1),
      runAggregate3Batch(calls.slice(mid), block, depth + 1),
    ]);
    return [...leftRes, ...rightRes];
  }

  console.warn(`[miningUnclaimed] aggregate3 leaf batch=${calls.length} gave up`);
  return calls.map(() => ({ success: false, data: "0x" }));
}

// ---------------------------------------------------------------------------
// Enumerate + batch-read
// ---------------------------------------------------------------------------

/** Unique miner (beneficiary) addresses from BetPlaced logs on V2. */
async function enumerateMiners(toBlock: bigint): Promise<string[]> {
  const logs = await getLogsAdaptive({
    address: LOTTERY_V2,
    topics: [BET_PLACED_TOPIC0], // beneficiary is topic2 (indexed), not filterable here → dedupe below
    fromBlock: V2_DEPLOY_BLOCK,
    toBlock,
  });

  const set = new Set<string>();
  for (const lg of logs) {
    // topics = [sig, roundId, beneficiary]. beneficiary = last 20 bytes of topic2.
    if (lg.topics.length >= 3) {
      set.add("0x" + lg.topics[2].slice(26).toLowerCase());
    }
  }
  return [...set];
}

interface MinerState {
  rewardsSlvrRaw: bigint;
  refinedAccruedRaw: bigint;
}

/** Multicall3-batch getMinerState(miner) for all miners. */
async function batchReadMinerState(
  miners: string[],
  block: bigint
): Promise<Map<string, MinerState>> {
  const batches: Array<{
    miners: string[];
    calls: Array<{ target: string; allowFailure: boolean; callData: string }>;
  }> = [];
  for (let i = 0; i < miners.length; i += MULTICALL_BATCH) {
    const batchMiners = miners.slice(i, i + MULTICALL_BATCH);
    batches.push({
      miners: batchMiners,
      calls: batchMiners.map((m) => ({
        target: LOTTERY_V2,
        allowFailure: true,
        callData: GET_MINER_STATE_SEL + encodeAddress(m),
      })),
    });
  }

  const allResults = await Promise.all(
    batches.map((b) => runAggregate3Batch(b.calls, block))
  );

  const out = new Map<string, MinerState>();
  for (let b = 0; b < batches.length; b++) {
    const { miners: batchMiners } = batches[b];
    const res = allResults[b];
    for (let j = 0; j < batchMiners.length; j++) {
      const r = res[j];
      if (!r || !r.success || !r.data || r.data === "0x") {
        out.set(batchMiners[j], { rewardsSlvrRaw: 0n, refinedAccruedRaw: 0n });
        continue;
      }
      // getMinerState → (rewardsSlvr, refinedAccrued, indexSnapshot, hasAccount)
      out.set(batchMiners[j], {
        rewardsSlvrRaw: wordAt(r.data, 0),
        refinedAccruedRaw: wordAt(r.data, 1),
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Public
// ---------------------------------------------------------------------------

async function fetchMiningUnclaimed(): Promise<MiningUnclaimedData> {
  const head = await ethBlockNumber();
  const atBlock = "0x" + head.toString(16);

  // Aggregate contract state (independent of enumeration).
  const [totalUnclaimedHex, minerIndexHex] = await Promise.all([
    ethCall(LOTTERY_V2, TOTAL_UNCLAIMED_SEL, head),
    ethCall(LOTTERY_V2, MINER_INDEX_SEL, head),
  ]);
  const totalUnclaimedRaw = decodeUint256(totalUnclaimedHex);
  const totalUnclaimed = Number(totalUnclaimedRaw) / WAD;
  const minerIndex = Number(decodeUint256(minerIndexHex)) / WAD;

  const miners = await enumerateMiners(head);
  const stateMap = await batchReadMinerState(miners, head);

  let sumRaw = 0n;
  const owed: Array<{
    address: string;
    rewardsRaw: bigint;
    refinedRaw: bigint;
  }> = [];
  for (const m of miners) {
    const s = stateMap.get(m);
    if (!s) continue;
    sumRaw += s.rewardsSlvrRaw;
    if (s.rewardsSlvrRaw > 0n) {
      owed.push({
        address: m,
        rewardsRaw: s.rewardsSlvrRaw,
        refinedRaw: s.refinedAccruedRaw,
      });
    }
  }

  owed.sort((a, b) =>
    a.rewardsRaw < b.rewardsRaw ? 1 : a.rewardsRaw > b.rewardsRaw ? -1 : 0
  );

  const denom = totalUnclaimedRaw > 0n ? Number(totalUnclaimedRaw) : 1;
  const top: UnclaimedMinerRow[] = owed.slice(0, TOP_N).map((o, i) => ({
    rank: i + 1,
    address: o.address,
    label: getLabel(o.address),
    blockscoutUrl: getBlockscoutUrl(o.address),
    unclaimedSlvr: Number(o.rewardsRaw) / WAD,
    pct: (Number(o.rewardsRaw) / denom) * 100,
    refinedAccruedSlvr: Number(o.refinedRaw) / WAD,
  }));

  const sumMinerUnclaimed = Number(sumRaw) / WAD;
  const reconciliationResidual = totalUnclaimed - sumMinerUnclaimed;
  const reconciliationPct =
    totalUnclaimed > 0
      ? (Math.abs(reconciliationResidual) / totalUnclaimed) * 100
      : 0;

  return {
    totalUnclaimed,
    sumMinerUnclaimed,
    reconciliationResidual,
    reconciliationPct,
    minersEnumerated: miners.length,
    minerCount: owed.length,
    minerIndex,
    top,
    atBlock,
    cachedAt: new Date().toISOString(),
    cacheTtlSeconds: CACHE_TTL,
  };
}

export async function getMiningUnclaimed(): Promise<MiningUnclaimedData> {
  return withCache(CACHE_KEY, CACHE_TTL, fetchMiningUnclaimed);
}

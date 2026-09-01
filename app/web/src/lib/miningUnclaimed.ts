/**
 * "Unclaimed SLVR by miner" — WHO is owed the Grid Mining unclaimed-rewards pool.
 *
 * The permanent SlvrMinerVault (0x2070…5260) holds totalUnclaimed() SLVR of
 * accrued-but-unclaimed mining rewards. This module breaks the attributed part
 * of that pool down PER MINER for the /mining rankings.
 *
 * HOW (verified against the verified source + on-chain reconciliation):
 *   1. Enumerate every known miner from the protocol's event-indexed
 *      MinerAccount set, then scan Credited/MigratedIn logs from that indexer's
 *      exact block to head. This avoids replaying ~150k logs on every refresh
 *      while the direct tail scan prevents indexing lag from dropping new miners.
 *   2. Multicall3 aggregate3-batch getMinerState(miner) for every miner and read
 *      `rewardsSlvr` (word 0) — the miner's current UNCLAIMED SLVR balance. Filter >0.
 *
 * WHY rewardsSlvr is the right field (not getUnclaimedSlvrPerRound):
 *   Vault getMinerState returns (rewardsSlvr, indexSnapshot, refinedAccrued, refineClock).
 *   - `rewardsSlvr` is the miner's unclaimed principal; SUM(rewardsSlvr) reconciles to
 *     totalUnclaimed() within a small residual (see below).
 *   - `refinedAccrued` is a SEPARATE refining BONUS accrued to that miner; it is NOT
 *     part of totalUnclaimed(), so we surface it as extra context, never fold it in.
 *   - getUnclaimedSlvrPerRound(roundId, account) is DEAD in the deployed contract:
 *     the backing mapping is declared + returned but never written → always 0. So it
 *     is NOT a usable fallback; we rely on rewardsSlvr, which reconciles.
 *
 * RECONCILIATION (an on-chain invariant):
 *   totalUnclaimed == reserved + SUM(rewardsSlvr). `reserved` is emitted SLVR for
 *   resolved rounds whose winners have not yet claimed and therefore cannot yet be
 *   attributed to an address.
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

const MINER_VAULT = "0x2070b4B0c57EaF070CF86cD8321a6054f3D25260";
const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11";
const SUBGRAPH_URL =
  "https://api.goldsky.com/api/public/project_cmre158qbffn101xe929tflsk/subgraphs/slvr-robinhood/1.9.0/gn";

const MINER_VAULT_DEPLOY_BLOCK = 35_594_698n;

// Credited(address indexed game,address indexed miner,uint256 amount,uint64 refineClock)
const CREDITED_TOPIC0 =
  "0x197168f6ee671a838e6651cacdaba1944018a6813668a8e539d74fed8d322683";
// MigratedIn(address indexed miner,uint256 amount,uint64 refineClock)
const MIGRATED_IN_TOPIC0 =
  "0x876b81ca412fc58a2f184475ffd0aa4461ac2831b9baff5791b4c5dff250b060";

// Selectors (keccak256(sig)[:4] — verified against SlvrMinerVault).
const GET_MINER_STATE_SEL = "0xe8fd1cb9"; // getMinerState(address)
const TOTAL_UNCLAIMED_SEL = "0xc96f14b8"; // totalUnclaimed()
const MINER_INDEX_SEL = "0x9806b4d2"; // minerIndex()
const RESERVED_SEL = "0xfe60d12c"; // reserved()
const AGGREGATE3_SELECTOR = "0x82ad56cb"; // aggregate3((address,bool,bytes)[])

const WAD = 1e18;
const MULTICALL_BATCH = 300; // getMinerState calldata is tiny (36 bytes) → 300/call is safe
const CACHE_TTL = 300; // 5 min
const CACHE_KEY = "mining:unclaimed-by-miner:vault:v1";
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

/** Minimal per-miner owed amount — the FULL owed set (not just the top-N). */
export interface MinerOwed {
  address: string;
  unclaimedSlvr: number;
}

export interface MiningUnclaimedData {
  /** Contract aggregate: totalUnclaimed() in SLVR — the pool total. */
  totalUnclaimed: number;
  /** Sum of per-miner rewardsSlvr; plus reservedUnattributed equals totalUnclaimed. */
  sumMinerUnclaimed: number;
  /** totalUnclaimed − sumMinerUnclaimed; equals reservedUnattributed. */
  reconciliationResidual: number;
  /** Resolved-round SLVR not yet attributed to a winner. */
  reservedUnattributed: number;
  /** |residual| / totalUnclaimed × 100. */
  reconciliationPct: number;
  /** How many distinct candidate miner accounts were checked on-chain. */
  minersEnumerated: number;
  /** How many of those are currently owed (rewardsSlvr > 0). */
  minerCount: number;
  /** current minerIndex (WAD-scaled → human). Context only. */
  minerIndex: number;
  /** Top-N miners owed, ranked desc by unclaimed SLVR. */
  top: UnclaimedMinerRow[];
  /**
   * EVERY owed miner (address + unclaimedSlvr), ranked desc — the full set that
   * SUMS to sumMinerUnclaimed. Used by economic-holders reattribution so no
   * miner is dropped by the top-N cut. Kept lean (no labels/urls).
   */
  allMiners: MinerOwed[];
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

async function fetchIndexedMiners(): Promise<{
  miners: string[];
  indexedThrough: bigint;
}> {
  const miners: string[] = [];
  let indexedThrough: bigint | null = null;
  const pageSize = 1_000;

  for (let page = 0; page < 10; page++) {
    const query = `{
      _meta { block { number } }
      minerAccounts(
        first: ${pageSize}
        skip: ${page * pageSize}
        orderBy: id
        orderDirection: asc
      ) { address }
    }`;
    const response = await fetch(SUBGRAPH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`MinerAccount index HTTP ${response.status}`);

    const result = (await response.json()) as {
      data?: {
        _meta?: { block?: { number?: number } };
        minerAccounts?: Array<{ address?: string }>;
      };
      errors?: Array<{ message?: string }>;
    };
    if (result.errors?.length || !result.data?.minerAccounts) {
      throw new Error(result.errors?.[0]?.message ?? "MinerAccount index unavailable");
    }

    if (indexedThrough === null) {
      const block = result.data._meta?.block?.number;
      if (!Number.isSafeInteger(block)) throw new Error("MinerAccount index missing head block");
      indexedThrough = BigInt(block!);
    }

    for (const row of result.data.minerAccounts) {
      if (/^0x[0-9a-fA-F]{40}$/.test(row.address ?? "")) {
        miners.push(row.address!.toLowerCase());
      }
    }
    if (result.data.minerAccounts.length < pageSize) break;
  }

  if (indexedThrough === null) throw new Error("MinerAccount index returned no metadata");
  return { miners, indexedThrough };
}

/** Unique miner addresses, with the index-to-chain tail covered by raw logs. */
async function enumerateMiners(toBlock: bigint): Promise<string[]> {
  const set = new Set<string>();
  let fromBlock = MINER_VAULT_DEPLOY_BLOCK;
  try {
    const indexed = await fetchIndexedMiners();
    for (const miner of indexed.miners) set.add(miner);
    fromBlock = indexed.indexedThrough + 1n;
  } catch (error) {
    // Correctness fallback: replay all vault state events if the address index is
    // unavailable. It is slower, but never silently returns a partial ranking.
    console.warn(
      "[miningUnclaimed] MinerAccount index unavailable; scanning vault from deploy:",
      error instanceof Error ? error.message : error
    );
  }

  const logs =
    fromBlock <= toBlock
      ? await getLogsAdaptive({
          address: MINER_VAULT,
          topics: [[CREDITED_TOPIC0, MIGRATED_IN_TOPIC0]],
          fromBlock,
          toBlock,
        })
      : [];

  for (const lg of logs) {
    const topic = lg.topics[0]?.toLowerCase();
    const minerTopic = topic === CREDITED_TOPIC0 ? lg.topics[2] : lg.topics[1];
    if (minerTopic) set.add("0x" + minerTopic.slice(26).toLowerCase());
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
        target: MINER_VAULT,
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
      // Vault getMinerState → (rewardsSlvr, indexSnapshot, refinedAccrued, refineClock)
      out.set(batchMiners[j], {
        rewardsSlvrRaw: wordAt(r.data, 0),
        refinedAccruedRaw: wordAt(r.data, 2),
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
  const [totalUnclaimedHex, minerIndexHex, reservedHex] = await Promise.all([
    ethCall(MINER_VAULT, TOTAL_UNCLAIMED_SEL, head),
    ethCall(MINER_VAULT, MINER_INDEX_SEL, head),
    ethCall(MINER_VAULT, RESERVED_SEL, head),
  ]);
  const totalUnclaimedRaw = decodeUint256(totalUnclaimedHex);
  const totalUnclaimed = Number(totalUnclaimedRaw) / WAD;
  const minerIndex = Number(decodeUint256(minerIndexHex)) / WAD;
  const reservedRaw = decodeUint256(reservedHex);
  const reservedUnattributed = Number(reservedRaw) / WAD;

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

  const attributedRaw = totalUnclaimedRaw - reservedRaw;
  if (sumRaw !== attributedRaw) {
    throw new Error(
      `Miner vault invariant mismatch: states=${sumRaw}, attributed=${attributedRaw}`
    );
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

  // Full owed set (already sorted desc) — SUMS to sumMinerUnclaimed exactly.
  const allMiners: MinerOwed[] = owed.map((o) => ({
    address: o.address,
    unclaimedSlvr: Number(o.rewardsRaw) / WAD,
  }));

  const sumMinerUnclaimed = Number(sumRaw) / WAD;
  const reconciliationResidual = Number(totalUnclaimedRaw - sumRaw) / WAD;
  const reconciliationPct =
    totalUnclaimed > 0
      ? (Math.abs(reconciliationResidual) / totalUnclaimed) * 100
      : 0;

  return {
    totalUnclaimed,
    sumMinerUnclaimed,
    reconciliationResidual,
    reservedUnattributed,
    reconciliationPct,
    minersEnumerated: miners.length,
    minerCount: owed.length,
    minerIndex,
    top,
    allMiners,
    atBlock,
    cachedAt: new Date().toISOString(),
    cacheTtlSeconds: CACHE_TTL,
  };
}

export async function getMiningUnclaimed(): Promise<MiningUnclaimedData> {
  return withCache(CACHE_KEY, CACHE_TTL, fetchMiningUnclaimed);
}

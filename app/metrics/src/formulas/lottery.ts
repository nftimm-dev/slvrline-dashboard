/**
 * Current lottery round state via archival eth_call.
 *
 * currentRoundId()        — selector 0x9cbe5efd (confirmed RESEARCH.md)
 * jackpot()               — selector 0x6b31ee01 (returns jackpot contract address)
 * minerIndex()            — selector 0x9806b4d2 (for display)
 * totalUnclaimed()        — selector 0xc96f14b8 (for display)
 * totalRefined()          — selector 0x9ff953a0 (for display)
 * getLatestResolvedRoundId() — exists in ABI
 *
 * Jackpot balance: eth_getBalance on the jackpot contract address.
 */

import { LOTTERY_V2 } from "../constants";
import { archivalCall, decodeUint256, decodeAddress } from "../rpc";
import { getHead } from "../block-resolver";

const CURRENT_ROUND_ID_SEL = "0x9cbe5efd";
const JACKPOT_SEL = "0x6b31ee01";
const MINER_INDEX_SEL = "0x9806b4d2";
const TOTAL_UNCLAIMED_SEL = "0xc96f14b8";
const TOTAL_REFINED_SEL = "0x9ff953a0";

export type LotteryRoundResult = {
  roundId: number;
  latestResolvedRoundId: number | null;
  jackpotEth: number;
  jackpotWei: bigint;
  minerIndex: bigint;
  totalUnclaimed: bigint;
  totalRefined: bigint;
  block: bigint;
  source: "eth_call";
};

export async function computeLotteryRoundState(): Promise<LotteryRoundResult> {
  const head = await getHead();
  const block = head.block;

  // Parallel reads
  const [roundIdHex, jackpotAddrHex, minerIndexHex, totalUnclaimedHex, totalRefinedHex] =
    await Promise.all([
      archivalCall(LOTTERY_V2, CURRENT_ROUND_ID_SEL, block),
      archivalCall(LOTTERY_V2, JACKPOT_SEL, block).catch(() => "0x"),
      archivalCall(LOTTERY_V2, MINER_INDEX_SEL, block),
      archivalCall(LOTTERY_V2, TOTAL_UNCLAIMED_SEL, block),
      archivalCall(LOTTERY_V2, TOTAL_REFINED_SEL, block),
    ]);

  const roundId = Number(decodeUint256(roundIdHex));
  const minerIndex = decodeUint256(minerIndexHex);
  const totalUnclaimed = decodeUint256(totalUnclaimedHex);
  const totalRefined = decodeUint256(totalRefinedHex);

  // Get jackpot ETH balance
  let jackpotWei = 0n;
  if (jackpotAddrHex && jackpotAddrHex !== "0x") {
    const jackpotAddr = decodeAddress(jackpotAddrHex);
    try {
      // eth_getBalance via RPC directly
      const jackpotBal = await getEthBalance(jackpotAddr, block);
      jackpotWei = jackpotBal;
    } catch {
      // Fallback: balance of lottery itself
      try {
        jackpotWei = await getEthBalance(LOTTERY_V2, block);
      } catch {
        jackpotWei = 0n;
      }
    }
  }

  return {
    roundId,
    latestResolvedRoundId: null, // would require another call, omit for now
    jackpotEth: Number(jackpotWei) / 1e18,
    jackpotWei,
    minerIndex,
    totalUnclaimed,
    totalRefined,
    block,
    source: "eth_call",
  };
}

async function getEthBalance(address: string, block: bigint): Promise<bigint> {
  // Import RPC internals to make a balance call
  const { RPC_PRIMARY, RPC_SECONDARY } = await import("../constants");
  const blockHex = "0x" + block.toString(16);
  const body = JSON.stringify({
    jsonrpc: "2.0",
    method: "eth_getBalance",
    params: [address, blockHex],
    id: 1,
  });

  const urls = [RPC_PRIMARY, RPC_SECONDARY];
  for (const url of urls) {
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      if (!resp.ok) continue;
      const data = (await resp.json()) as { result?: string; error?: unknown };
      if (data.result) return BigInt(data.result);
    } catch {
      // try next
    }
  }
  return 0n;
}

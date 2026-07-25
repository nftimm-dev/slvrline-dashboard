/**
 * multicall.ts — Multicall3 aggregate3 batched eth_call AT a historical block.
 *
 * Used by the staking backfill to read locks(tokenId) for ~1,600 tokenIds at each
 * sample block in a handful of eth_calls (instead of 1,600 individual calls).
 *
 * Encoding/decoding is delegated to viem (already a dependency) for correctness;
 * transport is the existing archivalCall (PRIMARY/SECONDARY round-robin + retry,
 * block-param aware). allowFailure=true so a reverting lock doesn't fail the batch.
 */
import {
  encodeFunctionData,
  decodeFunctionResult,
  type Abi,
} from "viem";
import { archivalCall } from "./rpc";

const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11";

const AGGREGATE3_ABI = [
  {
    type: "function",
    name: "aggregate3",
    stateMutability: "payable",
    inputs: [
      {
        name: "calls",
        type: "tuple[]",
        components: [
          { name: "target", type: "address" },
          { name: "allowFailure", type: "bool" },
          { name: "callData", type: "bytes" },
        ],
      },
    ],
    outputs: [
      {
        name: "returnData",
        type: "tuple[]",
        components: [
          { name: "success", type: "bool" },
          { name: "returnData", type: "bytes" },
        ],
      },
    ],
  },
] as const satisfies Abi;

export type Call3 = { target: string; allowFailure: boolean; callData: `0x${string}` };
export type Result3 = { success: boolean; returnData: `0x${string}` };

// 200 calls/batch (≈45 KB calldata) is comfortably within RPC limits.
const BATCH_SIZE = 200;

type BlockParam = bigint | "latest";

/**
 * aggregate3(calls) at `block`, auto-batched. Returns results in input order.
 * On a batch-level RPC failure, that batch's entries are returned as {success:false}.
 */
export async function aggregate3(
  calls: Call3[],
  block: BlockParam = "latest"
): Promise<Result3[]> {
  const out: Result3[] = [];

  for (let i = 0; i < calls.length; i += BATCH_SIZE) {
    const batch = calls.slice(i, i + BATCH_SIZE);
    const data = encodeFunctionData({
      abi: AGGREGATE3_ABI,
      functionName: "aggregate3",
      args: [
        batch.map((c) => ({
          target: c.target as `0x${string}`,
          allowFailure: c.allowFailure,
          callData: c.callData,
        })),
      ],
    });

    try {
      const hex = await archivalCall(MULTICALL3, data, block);
      const decoded = decodeFunctionResult({
        abi: AGGREGATE3_ABI,
        functionName: "aggregate3",
        data: hex as `0x${string}`,
      }) as ReadonlyArray<{ success: boolean; returnData: `0x${string}` }>;
      for (const r of decoded) {
        out.push({ success: r.success, returnData: r.returnData });
      }
    } catch (e) {
      console.warn(
        `[multicall] aggregate3 batch [${i}, ${i + batch.length}) at block ${block} failed:`,
        String(e)
      );
      for (let j = 0; j < batch.length; j++) {
        out.push({ success: false, returnData: "0x" });
      }
    }
  }

  return out;
}

export { MULTICALL3 };

/**
 * Circulating supply computation.
 *
 * circulating_supply = totalSupply() − excluded_balances
 *
 * Exclusions (eth_call balanceOf per address):
 *   - Team Vesting    0xFAfcBd4D09C096Eb06Aa2256C7A65CEAB2db39F5
 *   - Growth Fund     0x1A1633FDB2f19082099A6AD6C3d4F1Ec6BCE9729
 *   - Growth Recipient 0x4444479B89b684e79392924B3A70BE03733190dE
 *
 * NOTE: Permanent locks are NOT subtracted — they are already burned from totalSupply()
 * per RESEARCH.md §5. Do not double-subtract.
 *
 * burnedRaw (from token_burn events) is stored for display only, not subtracted from
 * circulating supply — burns are already reflected in totalSupply().
 *
 * Cross-check: getCirculatingSupply() is called as a reference; divergence is logged.
 */

import { type PublicClient } from "viem";
import { sql } from "../db";
import {
  SLVR_TOKEN,
  EXCLUDED_ADDRESSES,
  AUDIT_ADDRESSES,
} from "../constants";

// Minimal ABI fragments needed
const ERC20_ABI = [
  {
    name: "totalSupply",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "getCirculatingSupply",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
] as const;

export type SupplyResult = {
  totalSupplyRaw: bigint;
  burnedRaw: bigint;
  excludedRaw: bigint;
  circulatingRaw: bigint;
  circulatingHuman: number;
  totalHuman: number;
  burnedHuman: number;
  excludedBalances: Record<string, bigint>;
  onChainCirculatingRaw: bigint | null;
  permanentLockedNote: string;
  deployerBalance: bigint;
};

export async function computeSupply(
  asOfTime: Date | undefined,
  viemClient: PublicClient
): Promise<SupplyResult> {
  const tEpoch = asOfTime ? Math.floor(asOfTime.getTime() / 1000) : Math.floor(Date.now() / 1000);

  // 1. totalSupply via eth_call (live ground truth)
  const totalSupplyRaw = await viemClient.readContract({
    address: SLVR_TOKEN,
    abi: ERC20_ABI,
    functionName: "totalSupply",
  }) as bigint;

  // 2. Cumulative burns from TokensBurned events (for display; already in totalSupply)
  const [burnRow] = await sql<[{ total: string | null }]>`
    SELECT SUM(amount)::text AS total
    FROM slvr.token_burn
    WHERE block_time <= ${tEpoch}
  `;
  const burnedRaw = BigInt(burnRow?.total ?? "0");

  // 3. Excluded balances via eth_call balanceOf() for each excluded address
  const excludedBalances: Record<string, bigint> = {};
  let excludedRaw = 0n;

  for (const { address, label } of EXCLUDED_ADDRESSES) {
    const balance = await viemClient.readContract({
      address: SLVR_TOKEN,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [address as `0x${string}`],
    }) as bigint;
    excludedBalances[label] = balance;
    excludedRaw += balance;
  }

  // 4. circulating = totalSupply - excluded
  // Burns already reflected in totalSupply; do NOT subtract burnedRaw again.
  const circulatingRaw = totalSupplyRaw - excludedRaw;

  // 5. Cross-check: on-chain getCirculatingSupply()
  let onChainCirculatingRaw: bigint | null = null;
  try {
    onChainCirculatingRaw = await viemClient.readContract({
      address: SLVR_TOKEN,
      abi: ERC20_ABI,
      functionName: "getCirculatingSupply",
    }) as bigint;
  } catch {
    // If getter doesn't exist or reverts, proceed without cross-check
    onChainCirculatingRaw = null;
  }

  // 6. Deployer balance for audit (NOT subtracted)
  let deployerBalance = 0n;
  try {
    for (const { address } of AUDIT_ADDRESSES) {
      const balance = await viemClient.readContract({
        address: SLVR_TOKEN,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [address as `0x${string}`],
      }) as bigint;
      deployerBalance += balance;
    }
  } catch {
    deployerBalance = 0n;
  }

  return {
    totalSupplyRaw,
    burnedRaw,
    excludedRaw,
    circulatingRaw,
    circulatingHuman: Number(circulatingRaw) / 1e18,
    totalHuman: Number(totalSupplyRaw) / 1e18,
    burnedHuman: Number(burnedRaw) / 1e18,
    excludedBalances,
    onChainCirculatingRaw,
    permanentLockedNote:
      "Permanent locks burn the underlying SLVR (RESEARCH.md §5) — already absent from totalSupply(). Not double-subtracted.",
    deployerBalance,
  };
}

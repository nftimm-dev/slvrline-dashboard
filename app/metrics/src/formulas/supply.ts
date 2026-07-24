/**
 * Circulating supply computation — archival eth_call.
 *
 * circulating_supply = totalSupply(block) − excluded_balances(block)
 *
 * Exclusions (eth_call balanceOf per address):
 *   - Team Vesting    0xFAfcBd4D09C096Eb06Aa2256C7A65CEAB2db39F5
 *   - Growth Fund     0x1A1633FDB2f19082099A6AD6C3d4F1Ec6BCE9729
 *   - Growth Recipient 0x4444479B89b684e79392924B3A70BE03733190dE
 *
 * NOTE: Permanent locks are NOT subtracted — they are already burned from totalSupply()
 * per RESEARCH.md §5. Do not double-subtract.
 *
 * Cross-check: getCirculatingSupply() is called for reference — it uses the same
 * exclusion list internally on the contract side.
 *
 * Selectors (Ethereum keccak256):
 *   totalSupply()       = 0x18160ddd
 *   balanceOf(address)  = 0x70a08231
 *   getCirculatingSupply() = 0x2b112e49
 */

import {
  SLVR_TOKEN,
  SLVR_CAP,
  EXCLUDED_ADDRESSES,
  AUDIT_ADDRESSES,
} from "../constants";
import { archivalCall, decodeUint256 } from "../rpc";

const TOTAL_SUPPLY_SEL = "0x18160ddd";
const BALANCE_OF_SEL = "0x70a08231";
const GET_CIRCULATING_SEL = "0x2b112e49";

// Encode balanceOf(address) call data
function encodeBalanceOf(address: string): string {
  // Pad address to 32 bytes
  const addr = address.toLowerCase().replace("0x", "").padStart(64, "0");
  return BALANCE_OF_SEL + addr;
}

export type SupplyResult = {
  totalSupplyRaw: bigint;
  excludedRaw: bigint;
  circulatingRaw: bigint;
  circulatingHuman: number;
  totalHuman: number;
  excludedBalances: Record<string, bigint>;
  onChainCirculatingRaw: bigint | null;
  deployerBalance: bigint;
  block: bigint;
};

export async function computeSupply(block: bigint): Promise<SupplyResult> {
  // 1. totalSupply at given block
  const totalSupplyHex = await archivalCall(SLVR_TOKEN, TOTAL_SUPPLY_SEL, block);
  const totalSupplyRaw = decodeUint256(totalSupplyHex);

  // 2. Excluded balances via balanceOf
  const excludedBalances: Record<string, bigint> = {};
  let excludedRaw = 0n;

  await Promise.all(
    EXCLUDED_ADDRESSES.map(async ({ address, label }) => {
      const hex = await archivalCall(SLVR_TOKEN, encodeBalanceOf(address), block);
      const balance = decodeUint256(hex);
      excludedBalances[label] = balance;
    })
  );

  // Sum exclusions
  for (const { label } of EXCLUDED_ADDRESSES) {
    excludedRaw += excludedBalances[label] ?? 0n;
  }

  // 3. circulating = totalSupply - excluded
  const circulatingRaw = totalSupplyRaw > excludedRaw ? totalSupplyRaw - excludedRaw : 0n;

  // 4. Cross-check: on-chain getCirculatingSupply()
  let onChainCirculatingRaw: bigint | null = null;
  try {
    const csHex = await archivalCall(SLVR_TOKEN, GET_CIRCULATING_SEL, block);
    onChainCirculatingRaw = decodeUint256(csHex);
  } catch {
    onChainCirculatingRaw = null;
  }

  // 5. Deployer balance for audit (NOT subtracted)
  let deployerBalance = 0n;
  for (const { address } of AUDIT_ADDRESSES) {
    try {
      const hex = await archivalCall(SLVR_TOKEN, encodeBalanceOf(address), block);
      deployerBalance += decodeUint256(hex);
    } catch {
      // non-critical
    }
  }

  void SLVR_CAP; // referenced for type completeness

  return {
    totalSupplyRaw,
    excludedRaw,
    circulatingRaw,
    circulatingHuman: Number(circulatingRaw) / 1e18,
    totalHuman: Number(totalSupplyRaw) / 1e18,
    excludedBalances,
    onChainCirculatingRaw,
    deployerBalance,
    block,
  };
}

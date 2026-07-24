/**
 * Emission rate and runway computation — archival eth_call.
 *
 * emission_rate_30d = totalSupply(head) − totalSupply(block@now−30d)
 *   This measures how much new SLVR entered circulation over 30 days.
 *   Burns reduce totalSupply, so this is NET emission (minted − burned).
 *
 * remaining_cap = 500,000 − totalSupply(head)
 * runway_months = remaining_cap / (emission_rate_30d) — in months
 *   (emission_rate_30d is already a 30-day quantity; result = months remaining)
 *
 * If emission_rate_30d <= 0 (net deflation or no change), runway_months = null.
 *
 * selector: totalSupply() = 0x18160ddd
 */

import {
  SLVR_TOKEN,
  SLVR_CAP,
  EMISSION_WINDOW_SECONDS,
} from "../constants";
import { archivalCall, decodeUint256 } from "../rpc";
import { resolveBlockAtTimestampFast, getHead } from "../block-resolver";

const TOTAL_SUPPLY_SEL = "0x18160ddd";

export type RunwayResult = {
  totalSupplyNowRaw: bigint;
  totalSupply30dAgoRaw: bigint;
  emissionRate30dRaw: bigint;   // net change in supply over 30d (may be negative → clamped to 0)
  remainingCapRaw: bigint;
  runwayMonths: number | null;
  blockNow: bigint;
  block30dAgo: bigint;
  dataStatus: "ok" | "no_net_emission" | "pre_genesis_window";
};

export async function computeRunway(atBlock?: bigint): Promise<RunwayResult> {
  const head = await getHead();
  const blockNow = atBlock ?? head.block;

  // Timestamp at head (used to find 30d-ago block)
  const nowTs = head.timestamp;
  const ts30dAgo = nowTs - BigInt(EMISSION_WINDOW_SECONDS);

  // Resolve block at 30d ago
  const block30dInfo = await resolveBlockAtTimestampFast(ts30dAgo);
  const block30dAgo = block30dInfo.block;

  // Read totalSupply at both blocks
  const [hexNow, hex30dAgo] = await Promise.all([
    archivalCall(SLVR_TOKEN, TOTAL_SUPPLY_SEL, blockNow),
    archivalCall(SLVR_TOKEN, TOTAL_SUPPLY_SEL, block30dAgo),
  ]);

  const totalSupplyNowRaw = decodeUint256(hexNow);
  const totalSupply30dAgoRaw = decodeUint256(hex30dAgo);
  const remainingCapRaw = SLVR_CAP > totalSupplyNowRaw ? SLVR_CAP - totalSupplyNowRaw : 0n;

  // Net emission = supply change over 30 days (burns reduce supply, mints increase it)
  // If supply decreased (net burn), rate is 0 / "deflationary"
  const netChange = totalSupplyNowRaw >= totalSupply30dAgoRaw
    ? totalSupplyNowRaw - totalSupply30dAgoRaw
    : 0n;
  const emissionRate30dRaw = netChange;

  if (emissionRate30dRaw === 0n) {
    return {
      totalSupplyNowRaw,
      totalSupply30dAgoRaw,
      emissionRate30dRaw,
      remainingCapRaw,
      runwayMonths: null,
      blockNow,
      block30dAgo,
      dataStatus: "no_net_emission",
    };
  }

  // runway_months = remaining_cap / rate_30d
  // (rate_30d is SLVR net-emitted over 30 days = 1 month; remaining / rate = months remaining)
  const runwayMonths = Number(remainingCapRaw) / Number(emissionRate30dRaw);

  return {
    totalSupplyNowRaw,
    totalSupply30dAgoRaw,
    emissionRate30dRaw,
    remainingCapRaw,
    runwayMonths,
    blockNow,
    block30dAgo,
    dataStatus: "ok",
  };
}

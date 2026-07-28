"use client";

import { useState } from "react";
import TimeRangeSelector from "./TimeRangeSelector";
import LineChartSvg from "./LineChartSvg";
import { useHistory } from "@/hooks/useHistory";
import type { RangeKey } from "@/hooks/useHistory";

/**
 * veSLVR staking APY over time — the permanent-lock headline rate (value column
 * of the staking_apr series). Rewards are native ETH; APY = trailing-24h
 * rewardPerWeightStored Δ, priced by the on-chain SLVR/WETH pool. Mirrors the
 * Dividends APR chart.
 */
export default function StakingApyChartSection() {
  const [range, setRange] = useState<RangeKey>("all");
  const { data, isLoading } = useHistory("staking_apr", range);

  return (
    <section className="mb-10">
      <div className="flex justify-between items-center mb-4 flex-wrap gap-2">
        <h2
          style={{
            fontSize: "0.9375rem",
            fontWeight: 600,
            color: "var(--color-silver-200)",
          }}
        >
          Staking APY{" "}
          <span style={{ fontSize: "0.75rem", fontWeight: 400, color: "var(--color-silver-400)" }}>
            · permanent lock · 24h rolling · ETH rewards
          </span>
        </h2>
        <TimeRangeSelector value={range} onChange={setRange} />
      </div>
      <div
        className="overflow-hidden"
        style={{
          height: 256,
          borderRadius: "var(--radius-card)",
          border: "1px solid var(--color-silver-800)",
          backgroundColor: "var(--color-silver-900)",
        }}
      >
        <LineChartSvg
          data={data}
          isLoading={isLoading}
          series={[{ key: "v", color: "#a78bfa", label: "Permanent APY" }]}
          format={(n) => (n >= 100 ? Math.round(n).toLocaleString() : n.toFixed(2)) + "%"}
        />
      </div>
    </section>
  );
}

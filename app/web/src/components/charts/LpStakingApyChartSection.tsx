"use client";

import { useState } from "react";
import TimeRangeSelector from "./TimeRangeSelector";
import LineChartSvg from "./LineChartSvg";
import { useHistory } from "@/hooks/useHistory";
import type { RangeKey } from "@/hooks/useHistory";

/**
 * LP-staking APR over time — Uniswap V4 SLVR/ETH position staking, rewarded in
 * SLVR from the 2% sell tax. A trailing, volume-dependent rate: annualized 24h
 * rewards ÷ exact per-position staked value. The pool is young, so expect a
 * short, jagged series.
 */
export default function LpStakingApyChartSection() {
  const [range, setRange] = useState<RangeKey>("all");
  const { data, isLoading } = useHistory("lp_staking_apr", range);

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
          LP Staking APR{" "}
          <span style={{ fontSize: "0.75rem", fontWeight: 400, color: "var(--color-silver-400)" }}>
            · Uniswap V4 · sell-tax rewards · 24h rolling
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
          series={[{ key: "v", color: "#34d399", label: "LP APR" }]}
          format={(n) => (n >= 100 ? Math.round(n).toLocaleString() : n.toFixed(2)) + "%"}
        />
      </div>
    </section>
  );
}

"use client";

import { useMemo, useState } from "react";
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

  // Defensive: null out any implausible price point so a single bad on-chain read
  // can never blow out the right axis (SLVR lives well within [$0.01, $5000]).
  const chartData = useMemo(() => {
    if (!data?.rows) return data;
    return {
      ...data,
      rows: data.rows.map((r) =>
        r.v3 != null && (r.v3 < 0.01 || r.v3 > 5000) ? { ...r, v3: null } : r
      ),
    };
  }, [data]);

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
            · permanent lock · 24h rolling · vs SLVR price
          </span>
        </h2>
        <TimeRangeSelector value={range} onChange={setRange} />
      </div>
      {/* Legend — APY (left axis) vs SLVR price (right axis) */}
      <div
        className="flex items-center gap-4 mb-3"
        style={{ fontSize: "0.75rem", color: "var(--color-silver-400)" }}
      >
        <span className="inline-flex items-center gap-1.5">
          <span style={{ width: 12, height: 3, borderRadius: 2, background: "#a78bfa", display: "inline-block" }} />
          Permanent APY
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span style={{ width: 12, height: 3, borderRadius: 2, background: "#fbbf24", display: "inline-block" }} />
          SLVR price (USD)
        </span>
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
          data={chartData}
          isLoading={isLoading}
          series={[
            { key: "v", color: "#a78bfa", label: "Permanent APY" },
            { key: "v3", color: "#fbbf24", label: "SLVR price", axis: "right" },
          ]}
          format={(n) => (n >= 100 ? Math.round(n).toLocaleString() : n.toFixed(2)) + "%"}
          rightFormat={(n) => "$" + (n >= 100 ? n.toFixed(0) : n.toFixed(2))}
        />
      </div>
    </section>
  );
}

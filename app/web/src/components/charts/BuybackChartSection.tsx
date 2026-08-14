"use client";

import { useState } from "react";
import TimeRangeSelector from "./TimeRangeSelector";
import LineChartSvg from "./LineChartSvg";
import { useHistory } from "@/hooks/useHistory";
import type { RangeKey } from "@/hooks/useHistory";

/**
 * Cumulative buyback-and-burn over time — SLVR removed (left axis) and ETH spent
 * (right axis), both monotonically rising. Reads the `buyback_totals` series, whose
 * value = cumulative SLVR burned and value2 = cumulative ETH spent.
 */
export default function BuybackChartSection() {
  const [range, setRange] = useState<RangeKey>("all");
  const { data, isLoading } = useHistory("buyback_totals", range);

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
          Cumulative buybacks{" "}
          <span style={{ fontSize: "0.75rem", fontWeight: 400, color: "var(--color-silver-400)" }}>
            · SLVR burned &amp; ETH spent
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
          series={[
            { key: "v", color: "#fbbf24", label: "SLVR burned", axis: "left" },
            { key: "v2", color: "#22d3ee", label: "ETH spent", axis: "right" },
          ]}
          format={(n) => (n >= 100 ? Math.round(n).toLocaleString() : n.toFixed(2)) + " SLVR"}
          rightFormat={(n) => n.toFixed(n >= 10 ? 2 : 4) + " ETH"}
        />
      </div>
    </section>
  );
}

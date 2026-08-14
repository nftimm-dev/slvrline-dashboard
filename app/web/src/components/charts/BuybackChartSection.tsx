"use client";

import { useMemo, useState } from "react";
import TimeRangeSelector from "./TimeRangeSelector";
import LineChartSvg from "./LineChartSvg";
import { useHistory } from "@/hooks/useHistory";
import type { RangeKey } from "@/hooks/useHistory";

function usdAxis(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e6) return "$" + (n / 1e6).toFixed(1) + "M";
  if (a >= 1e3) return "$" + (n / 1e3).toFixed(1) + "K";
  return "$" + Math.round(n).toLocaleString();
}

/**
 * Cumulative buyback-and-burn over time — SLVR removed (left axis) and USD spent
 * (right axis). The `buyback_totals` series stores cumulative ETH in value2; we
 * convert it to USD at the current ETH price (consistent with the "at current ETH"
 * figures on the cards). Falls back to ETH if no price is available.
 */
export default function BuybackChartSection({ ethUsd }: { ethUsd?: number | null }) {
  const [range, setRange] = useState<RangeKey>("all");
  const { data, isLoading } = useHistory("buyback_totals", range);

  const showUsd = ethUsd != null && ethUsd > 0;

  const chartData = useMemo(() => {
    if (!data?.rows || !showUsd) return data;
    return {
      ...data,
      rows: data.rows.map((r) => ({
        ...r,
        v2: r.v2 != null ? r.v2 * (ethUsd as number) : null,
      })),
    };
  }, [data, ethUsd, showUsd]);

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
            · SLVR burned &amp; {showUsd ? "USD" : "ETH"} spent
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
          data={chartData}
          isLoading={isLoading}
          series={[
            { key: "v", color: "#fbbf24", label: "SLVR burned", axis: "left" },
            { key: "v2", color: "#22d3ee", label: showUsd ? "USD spent" : "ETH spent", axis: "right" },
          ]}
          format={(n) => (n >= 100 ? Math.round(n).toLocaleString() : n.toFixed(2)) + " SLVR"}
          rightFormat={showUsd ? usdAxis : (n) => n.toFixed(n >= 10 ? 2 : 4) + " ETH"}
        />
      </div>
    </section>
  );
}

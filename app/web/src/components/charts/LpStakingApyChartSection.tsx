"use client";

import { useMemo, useState } from "react";
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
// Null non-positive values and isolated upward spikes (> 2.5× the local rolling
// median, robust to a single outlier) so reward-burst blips don't ruin the axis.
function cleanApr(values: (number | null)[]): (number | null)[] {
  const WINDOW = 12; // points on each side (~2h at 5-min cadence)
  const SPIKE_ABOVE = 2.5; // multiple of local median
  return values.map((v, i) => {
    if (v == null || v <= 0) return null;
    const neighbours: number[] = [];
    for (let j = i - WINDOW; j <= i + WINDOW; j++) {
      if (j === i) continue;
      const n = values[j];
      if (n != null && n > 0) neighbours.push(n);
    }
    if (neighbours.length < 4) return v;
    neighbours.sort((a, b) => a - b);
    const median = neighbours[Math.floor(neighbours.length / 2)];
    return v > median * SPIKE_ABOVE ? null : v;
  });
}

export default function LpStakingApyChartSection({
  dataKey = "v",
  title = "LP Staking APR",
  subtitle = "· Uniswap V4 · sell-tax rewards · 24h rolling",
  color = "#34d399",
}: {
  dataKey?: "v" | "v2" | "v3";
  title?: string;
  subtitle?: string;
  color?: string;
} = {}) {
  const [range, setRange] = useState<RangeKey>("all");
  const { data, isLoading } = useHistory("lp_staking_apr", range);

  // Clean the cohort series before charting:
  //  - drop non-positive points (a cohort with no positions yet → APR 0), and
  //  - drop upward spikes: APR annualizes a trailing-24h reward stream, so a single
  //    large sell briefly inflates it many-fold (we saw 30k%+ blips). A point far
  //    above its local rolling median is a burst artifact, not a real rate.
  const chartData = useMemo(() => {
    if (!data?.rows) return data;
    const cleaned = cleanApr(data.rows.map((r) => r[dataKey] as number | null));
    return { ...data, rows: data.rows.map((r, i) => ({ ...r, [dataKey]: cleaned[i] })) };
  }, [data, dataKey]);

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
          {title}{" "}
          <span style={{ fontSize: "0.75rem", fontWeight: 400, color: "var(--color-silver-400)" }}>
            {subtitle}
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
          series={[{ key: dataKey, color, label: title }]}
          format={(n) => (n >= 100 ? Math.round(n).toLocaleString() : n.toFixed(2)) + "%"}
        />
      </div>
    </section>
  );
}

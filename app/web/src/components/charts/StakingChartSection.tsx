"use client";

import { useMemo, useState } from "react";
import TimeRangeSelector from "./TimeRangeSelector";
import LineChartSvg from "./LineChartSvg";
import { useHistory } from "@/hooks/useHistory";
import type { RangeKey } from "@/hooks/useHistory";
import ScreenshotStamp from "@/components/analytics/ScreenshotStamp";

// Total staked moves gradually and stays large, so an isolated point that
// collapses far below its neighbours is a bad on-chain read (partial lock
// enumeration / RPC hiccup), not a real change. Null those out so the line
// doesn't spike down to ~0. Uses a centered rolling median (robust to a single
// outlier) and drops any point below 60% of that local trend.
function dropDips(values: (number | null)[]): (number | null)[] {
  const WINDOW = 5; // points on each side
  const DROP_BELOW = 0.6; // fraction of local median
  return values.map((v, i) => {
    if (v == null) return null;
    if (v <= 0) return null; // exact-zero snapshot = failed read, never a real value
    const neighbours: number[] = [];
    for (let j = i - WINDOW; j <= i + WINDOW; j++) {
      if (j === i) continue;
      const n = values[j];
      if (n != null && n > 0) neighbours.push(n);
    }
    if (neighbours.length < 3) return v;
    neighbours.sort((a, b) => a - b);
    const median = neighbours[Math.floor(neighbours.length / 2)];
    return v < median * DROP_BELOW ? null : v;
  });
}

export default function StakingChartSection() {
  const [range, setRange] = useState<RangeKey>("7d");
  const { data, isLoading } = useHistory("total_staked_slvr", range);

  const chartData = useMemo(() => {
    if (!data?.rows) return data;
    const cleaned = dropDips(data.rows.map((r) => r.v));
    return { ...data, rows: data.rows.map((r, i) => ({ ...r, v: cleaned[i] })) };
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
          Staking
        </h2>
        <TimeRangeSelector value={range} onChange={setRange} />
      </div>
      <div
        className="relative overflow-hidden"
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
          series={[{ key: "v", color: "#7dd3fc", label: "Staked" }]}
          format={(n) => Math.round(n).toLocaleString() + " SLVR"}
        />
        <ScreenshotStamp placement="top" />
      </div>
    </section>
  );
}

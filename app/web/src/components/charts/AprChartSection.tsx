"use client";

import { useMemo, useState } from "react";
import TimeRangeSelector from "./TimeRangeSelector";
import LineChartSvg from "./LineChartSvg";
import { useHistory } from "@/hooks/useHistory";
import type { RangeKey } from "@/hooks/useHistory";
import ScreenshotStamp from "@/components/analytics/ScreenshotStamp";

// The V2 minerIndex reset to 0 at the 22 Jul migration, so the trailing-24h APR
// reads astronomically high for the first ~3 days while the window fills, then
// settles. Start the chart on 25 Jul so it shows the real, settled rate instead
// of being dominated by that launch decay.
const DIVIDENDS_START = Date.parse("2026-07-25T00:00:00Z");

export default function AprChartSection() {
  const [range, setRange] = useState<RangeKey>("all");
  const { data, isLoading } = useHistory("dividends_apr", range);

  const chartData = useMemo(() => {
    if (!data?.rows) return data;
    return { ...data, rows: data.rows.filter((r) => Date.parse(r.t) >= DIVIDENDS_START) };
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
          Dividends APR{" "}
          <span style={{ fontSize: "0.75rem", fontWeight: 400, color: "var(--color-silver-400)" }}>
            · 24h rolling · since 25 Jul
          </span>
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
          series={[{ key: "v", color: "#5eead4", label: "APR" }]}
          format={(n) => (n >= 100 ? Math.round(n).toLocaleString() : n.toFixed(2)) + "%"}
        />
        <ScreenshotStamp placement="top" />
      </div>
    </section>
  );
}

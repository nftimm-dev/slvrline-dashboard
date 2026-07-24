"use client";

import { useState } from "react";
import TimeRangeSelector from "./TimeRangeSelector";
import LineChartSvg from "./LineChartSvg";
import { useHistory } from "@/hooks/useHistory";
import type { RangeKey } from "@/hooks/useHistory";

export default function AprChartSection() {
  const [range, setRange] = useState<RangeKey>("7d");
  const { data, isLoading } = useHistory("dividends_apr", range);

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
          Dividends APR
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
        <LineChartSvg data={data} isLoading={isLoading} series={[{ key: "v", color: "#5eead4" }]} />
      </div>
    </section>
  );
}

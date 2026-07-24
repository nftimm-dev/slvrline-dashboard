"use client";

import { useState, ReactNode } from "react";
import TimeRangeSelector from "./TimeRangeSelector";
import { useHistory } from "@/hooks/useHistory";
import type { RangeKey, MetricName, HistoryResponse } from "@/hooks/useHistory";

interface ChartSectionProps {
  title: string;
  metric: MetricName;
  children: (
    range: RangeKey,
    data: HistoryResponse | undefined,
    isLoading: boolean
  ) => ReactNode;
}

export default function ChartSection({
  title,
  metric,
  children,
}: ChartSectionProps) {
  const [range, setRange] = useState<RangeKey>("7d");
  const { data, isLoading } = useHistory(metric, range);

  return (
    <section className="mb-10">
      <div
        className="flex justify-between items-center mb-4 flex-wrap gap-2"
      >
        <h2
          style={{
            fontSize: "0.9375rem",
            fontWeight: 600,
            color: "var(--color-silver-200)",
          }}
        >
          {title}
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
        {children(range, data, isLoading)}
      </div>
    </section>
  );
}

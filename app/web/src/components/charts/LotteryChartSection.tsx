"use client";

import { useMemo, useState } from "react";
import TimeRangeSelector from "./TimeRangeSelector";
import LineChartSvg from "./LineChartSvg";
import { useHistory } from "@/hooks/useHistory";
import type { RangeKey, HistoryResponse } from "@/hooks/useHistory";

/**
 * The raw `lottery_round_state` series is a monotonic round counter — a
 * straight ramp that tells you nothing. Transform it into ROUNDS PER DAY:
 * for each consecutive pair, (round[i] − round[i−1]) / (hoursBetween / 24).
 * Drop the first point (no predecessor) and any non-positive rate.
 */
function toRoundsPerDay(data: HistoryResponse | undefined): HistoryResponse | undefined {
  if (!data) return data;
  const src = data.rows.filter((r) => r.v !== null);
  const rows: HistoryResponse["rows"] = [];
  for (let i = 1; i < src.length; i++) {
    const prev = src[i - 1];
    const cur = src[i];
    const dRound = (cur.v as number) - (prev.v as number);
    const hours =
      (new Date(cur.t).getTime() - new Date(prev.t).getTime()) / 3_600_000;
    if (hours <= 0) continue;
    const perDay = dRound / (hours / 24);
    if (perDay <= 0) continue; // drop flat/negative (counter resets, gaps)
    rows.push({ t: cur.t, v: perDay, v2: null, v3: null, block: cur.block });
  }
  return { ...data, rows };
}

export default function LotteryChartSection() {
  const [range, setRange] = useState<RangeKey>("7d");
  const { data, isLoading } = useHistory("lottery_round_state", range);

  const perDay = useMemo(() => toRoundsPerDay(data), [data]);

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
          Rounds / day
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
          data={perDay}
          isLoading={isLoading}
          series={[{ key: "v", color: "#f0c674", label: "Rounds / day" }]}
          format={(n) =>
            n.toLocaleString(undefined, { maximumFractionDigits: 0 })
          }
        />
      </div>
    </section>
  );
}

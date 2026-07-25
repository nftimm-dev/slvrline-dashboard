"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export interface BarDatum {
  label: string;
  value: number;
  /** Optional per-bar accent override. */
  color?: string;
}

interface BarChartSvgProps {
  data: BarDatum[];
  /** Default bar color (CSS var or hex). */
  color?: string;
  /** Orientation. Horizontal is best for ranked category lists. */
  layout?: "vertical" | "horizontal";
  /** Value formatter for axis + tooltip. */
  format?: (n: number) => string;
  height?: number;
  /** Tooltip label for the value row. */
  valueLabel?: string;
}

function compact(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e9) return (n / 1e9).toFixed(1) + "B";
  if (a >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (a >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

interface TipProps {
  active?: boolean;
  payload?: Array<{ payload: BarDatum; value: number }>;
  format: (n: number) => string;
  valueLabel?: string;
}

function BarTooltip({ active, payload, format, valueLabel }: TipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const datum = payload[0].payload;
  return (
    <div
      style={{
        background: "#14171c",
        border: "1px solid var(--color-silver-700)",
        borderRadius: 8,
        padding: "8px 10px",
        fontSize: 12,
        boxShadow: "0 4px 16px rgba(0,0,0,0.45)",
        minWidth: 140,
      }}
    >
      <div style={{ color: "var(--color-silver-400)", marginBottom: 4 }}>
        {datum.label}
      </div>
      <div
        style={{
          display: "flex",
          gap: 8,
          color: "var(--color-silver-100)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        <span style={{ color: "var(--color-silver-400)" }}>
          {valueLabel ?? "Value"}
        </span>
        <span style={{ marginLeft: "auto" }}>{format(payload[0].value)}</span>
      </div>
    </div>
  );
}

/**
 * Silver-styled bar chart (recharts). Horizontal layout ranks categories;
 * vertical layout for distributions/buckets.
 */
export default function BarChartSvg({
  data,
  color = "var(--color-silver-400)",
  layout = "vertical",
  format,
  height = 280,
  valueLabel,
}: BarChartSvgProps) {
  const fmt =
    format ??
    ((n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 }));

  if (data.length === 0) {
    return (
      <div
        style={{
          height,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--color-silver-400)",
          fontSize: "0.8125rem",
        }}
      >
        No data available
      </div>
    );
  }

  const horizontal = layout === "vertical"; // recharts "vertical" = bars run horizontally

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        data={data}
        layout={layout}
        margin={{ top: 8, right: 20, bottom: 8, left: 8 }}
        barCategoryGap={horizontal ? "22%" : "18%"}
      >
        <CartesianGrid
          stroke="var(--color-silver-800)"
          horizontal={!horizontal}
          vertical={horizontal}
        />
        {horizontal ? (
          <>
            <XAxis
              type="number"
              tickFormatter={compact}
              tick={{ fill: "var(--color-silver-400)", fontSize: 11 }}
              stroke="var(--color-silver-700)"
              tickMargin={6}
            />
            <YAxis
              type="category"
              dataKey="label"
              tick={{ fill: "var(--color-silver-300)", fontSize: 11 }}
              stroke="var(--color-silver-700)"
              width={132}
              tickMargin={6}
            />
          </>
        ) : (
          <>
            <XAxis
              type="category"
              dataKey="label"
              tick={{ fill: "var(--color-silver-400)", fontSize: 11 }}
              stroke="var(--color-silver-700)"
              tickMargin={6}
              interval={0}
              angle={data.length > 6 ? -20 : 0}
              textAnchor={data.length > 6 ? "end" : "middle"}
              height={data.length > 6 ? 48 : 24}
            />
            <YAxis
              type="number"
              tickFormatter={compact}
              tick={{ fill: "var(--color-silver-400)", fontSize: 11 }}
              stroke="var(--color-silver-700)"
              width={48}
            />
          </>
        )}
        <Tooltip
          cursor={{ fill: "rgba(255,255,255,0.04)" }}
          content={<BarTooltip format={fmt} valueLabel={valueLabel} />}
        />
        <Bar dataKey="value" radius={horizontal ? [0, 3, 3, 0] : [3, 3, 0, 0]} isAnimationActive={false}>
          {data.map((d, i) => (
            <Cell key={i} fill={d.color ?? color} fillOpacity={0.85} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

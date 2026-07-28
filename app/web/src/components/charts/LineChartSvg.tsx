"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { HistoryResponse } from "@/hooks/useHistory";

export interface ChartSeries {
  key: "v" | "v2" | "v3";
  color: string;
  label?: string;
  /** Which Y axis to bind to. Default "left"; "right" enables a secondary axis. */
  axis?: "left" | "right";
}

interface Props {
  data: HistoryResponse | undefined;
  isLoading: boolean;
  series: ChartSeries[];
  format?: (n: number) => string;
  /** Formatter for the right (secondary) axis + its series in the tooltip. */
  rightFormat?: (n: number) => string;
  /** Log-scale Y axis — makes values spanning orders of magnitude legible (drops non-positive points). */
  logScale?: boolean;
}

const fmtDay = (t: number) =>
  new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const fmtFull = (t: number) =>
  new Date(t).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

function compact(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e9) return (n / 1e9).toFixed(1) + "B";
  if (a >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (a >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

interface TipPayloadItem {
  dataKey: string;
  value: number;
  color: string;
}

function ChartTooltip(props: {
  active?: boolean;
  label?: number;
  payload?: TipPayloadItem[];
  series: ChartSeries[];
  format: (n: number) => string;
  rightFormat?: (n: number) => string;
}) {
  const { active, label, payload, series, format, rightFormat } = props;
  if (!active || !payload || payload.length === 0) return null;
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
      <div style={{ color: "var(--color-silver-400)", marginBottom: 5 }}>
        {label != null ? fmtFull(label) : ""}
      </div>
      {payload.map((p) => {
        const s = series.find((x) => x.key === p.dataKey);
        return (
          <div
            key={p.dataKey}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              color: "var(--color-silver-100)",
              lineHeight: 1.6,
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: 2,
                background: p.color,
                display: "inline-block",
                flexShrink: 0,
              }}
            />
            <span style={{ color: "var(--color-silver-400)" }}>{s?.label ?? p.dataKey}</span>
            <span style={{ marginLeft: "auto", fontVariantNumeric: "tabular-nums" }}>
              {(s?.axis === "right" ? rightFormat ?? format : format)(p.value)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Interactive time-series chart (recharts). Renders as SVG in the React tree —
 * unlike the canvas libs (echarts/lightweight-charts) whose dynamic imports
 * silently failed to mount in this Next 15 build. Hover for crosshair + tooltip.
 */
export default function LineChartSvg({ data, isLoading, series, format, rightFormat, logScale }: Props) {
  const fmt =
    format ?? ((n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 }));
  const rightFmt = rightFormat ?? fmt;
  const hasRight = series.some((s) => s.axis === "right");

  if (isLoading && !data) {
    return (
      <div
        style={{
          width: "100%",
          height: "100%",
          backgroundColor: "var(--color-silver-800)",
          animation: "pulse 2s ease-in-out infinite",
        }}
      />
    );
  }

  const rows = (data?.rows ?? [])
    .map((r) => ({ t: Date.parse(r.t), v: r.v, v2: r.v2, v3: r.v3 }))
    .filter(
      (r) =>
        Number.isFinite(r.t) &&
        series.some((s) => {
          const val = r[s.key];
          return (
            val !== null &&
            Number.isFinite(val) &&
            (!logScale || (val as number) > 0)
          );
        })
    );

  if (rows.length === 0) {
    return (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--color-silver-400)",
          fontSize: "0.8125rem",
        }}
      >
        No data for this range
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={rows} margin={{ top: 12, right: 16, bottom: 4, left: 4 }}>
        <defs>
          {series.map((s) => (
            <linearGradient
              key={s.key}
              id={`grad-${s.key}-${s.color.replace("#", "")}`}
              x1="0"
              y1="0"
              x2="0"
              y2="1"
            >
              <stop offset="0%" stopColor={s.color} stopOpacity={0.25} />
              <stop offset="100%" stopColor={s.color} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid stroke="var(--color-silver-800)" vertical={false} />
        <XAxis
          dataKey="t"
          type="number"
          scale="time"
          domain={["dataMin", "dataMax"]}
          tickFormatter={fmtDay}
          tick={{ fill: "var(--color-silver-400)", fontSize: 11 }}
          stroke="var(--color-silver-700)"
          minTickGap={44}
          tickMargin={8}
        />
        <YAxis
          yAxisId="left"
          scale={logScale ? "log" : "auto"}
          allowDataOverflow={logScale || undefined}
          tickFormatter={compact}
          tick={{ fill: "var(--color-silver-400)", fontSize: 11 }}
          stroke="var(--color-silver-700)"
          width={54}
          domain={logScale ? [(min: number) => Math.max(1, min * 0.7), (max: number) => max * 1.3] : ["auto", "auto"]}
        />
        {hasRight && (
          <YAxis
            yAxisId="right"
            orientation="right"
            tickFormatter={(n) => rightFmt(n)}
            tick={{ fill: "var(--color-silver-400)", fontSize: 11 }}
            stroke="var(--color-silver-700)"
            width={58}
            domain={["auto", "auto"]}
          />
        )}
        <Tooltip
          cursor={{ stroke: "var(--color-silver-500)", strokeWidth: 1 }}
          content={<ChartTooltip series={series} format={fmt} rightFormat={rightFmt} />}
        />
        {series.map((s) => (
          <Area
            key={s.key}
            yAxisId={s.axis === "right" ? "right" : "left"}
            type="monotone"
            dataKey={s.key}
            name={s.label ?? s.key}
            stroke={s.color}
            strokeWidth={2}
            fill={`url(#grad-${s.key}-${s.color.replace("#", "")})`}
            dot={false}
            activeDot={{ r: 3, fill: s.color, stroke: "#0a0a0f", strokeWidth: 1 }}
            isAnimationActive={false}
            connectNulls
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}

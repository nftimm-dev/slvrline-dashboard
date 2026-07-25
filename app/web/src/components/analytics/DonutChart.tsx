"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

export interface DonutSlice {
  label: string;
  value: number;
  color: string;
}

interface DonutChartProps {
  slices: DonutSlice[];
  format?: (n: number) => string;
  height?: number;
  /** Big centered figure (e.g. the total). */
  centerValue?: string;
  centerLabel?: string;
}

interface TipProps {
  active?: boolean;
  payload?: Array<{ payload: DonutSlice; value: number }>;
  format: (n: number) => string;
  total: number;
}

function DonutTooltip({ active, payload, format, total }: TipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const s = payload[0].payload;
  const pct = total > 0 ? ((payload[0].value / total) * 100).toFixed(1) : "0.0";
  return (
    <div
      style={{
        background: "#14171c",
        border: "1px solid var(--color-silver-700)",
        borderRadius: 8,
        padding: "8px 10px",
        fontSize: 12,
        boxShadow: "0 4px 16px rgba(0,0,0,0.45)",
        minWidth: 150,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          color: "var(--color-silver-100)",
          marginBottom: 2,
        }}
      >
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: 2,
            background: s.color,
            display: "inline-block",
          }}
        />
        {s.label}
      </div>
      <div
        style={{
          color: "var(--color-silver-300)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {format(payload[0].value)}{" "}
        <span style={{ color: "var(--color-silver-400)" }}>({pct}%)</span>
      </div>
    </div>
  );
}

/** Silver-styled donut for 2–4 category splits, with an optional center figure. */
export default function DonutChart({
  slices,
  format,
  height = 240,
  centerValue,
  centerLabel,
}: DonutChartProps) {
  const fmt =
    format ??
    ((n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 }));
  const total = slices.reduce((s, x) => s + x.value, 0);

  return (
    <div style={{ position: "relative", width: "100%", height }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={slices}
            dataKey="value"
            nameKey="label"
            cx="50%"
            cy="50%"
            innerRadius="62%"
            outerRadius="88%"
            paddingAngle={1.5}
            stroke="var(--color-silver-900)"
            strokeWidth={2}
            isAnimationActive={false}
          >
            {slices.map((s, i) => (
              <Cell key={i} fill={s.color} fillOpacity={0.9} />
            ))}
          </Pie>
          <Tooltip content={<DonutTooltip format={fmt} total={total} />} />
        </PieChart>
      </ResponsiveContainer>

      {centerValue &&
        (() => {
          // Keep the figure inside the donut hole: split "12,297.5 SLVR" into a
          // number line + a smaller unit line, and cap width to the inner radius
          // so it never spills over the ring.
          const sp = centerValue.lastIndexOf(" ");
          const hasUnit = sp > 0 && /[0-9]/.test(centerValue.slice(0, sp));
          const main = hasUnit ? centerValue.slice(0, sp) : centerValue;
          const unit = hasUnit ? centerValue.slice(sp + 1) : null;
          return (
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                pointerEvents: "none",
                textAlign: "center",
              }}
            >
              <div style={{ maxWidth: height * 0.52 }}>
                <span
                  className="font-mono"
                  style={{
                    display: "block",
                    fontSize: "1.1rem",
                    fontWeight: 700,
                    color: "var(--color-silver-100)",
                    fontVariantNumeric: "tabular-nums",
                    lineHeight: 1.05,
                    whiteSpace: "nowrap",
                  }}
                >
                  {main}
                </span>
                {unit && (
                  <span
                    className="font-mono"
                    style={{
                      display: "block",
                      fontSize: "0.6875rem",
                      fontWeight: 600,
                      letterSpacing: "0.04em",
                      color: "var(--color-silver-400)",
                      marginTop: 1,
                    }}
                  >
                    {unit}
                  </span>
                )}
              </div>
          {centerLabel && (
            <span
              className="uppercase"
              style={{
                fontSize: "0.5625rem",
                letterSpacing: "0.09em",
                color: "var(--color-silver-400)",
                marginTop: 2,
              }}
            >
              {centerLabel}
            </span>
          )}
            </div>
          );
        })()}
    </div>
  );
}

/** A small inline legend row for donut/pie slices. */
export function DonutLegend({
  slices,
  format,
}: {
  slices: DonutSlice[];
  format?: (n: number) => string;
}) {
  const fmt =
    format ??
    ((n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 }));
  const total = slices.reduce((s, x) => s + x.value, 0);
  return (
    <div className="flex flex-col gap-2 mt-1">
      {slices.map((s) => {
        const pct = total > 0 ? (s.value / total) * 100 : 0;
        return (
          <div
            key={s.label}
            className="flex items-center gap-2"
            style={{ fontSize: "0.8125rem" }}
          >
            <span
              style={{
                width: 9,
                height: 9,
                borderRadius: 2,
                background: s.color,
                display: "inline-block",
                flexShrink: 0,
              }}
            />
            <span style={{ color: "var(--color-silver-300)" }}>{s.label}</span>
            <span
              className="font-mono ml-auto"
              style={{
                color: "var(--color-silver-100)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {fmt(s.value)}
            </span>
            <span
              className="font-mono"
              style={{
                color: "var(--color-silver-400)",
                fontVariantNumeric: "tabular-nums",
                minWidth: 48,
                textAlign: "right",
              }}
            >
              {pct.toFixed(1)}%
            </span>
          </div>
        );
      })}
    </div>
  );
}

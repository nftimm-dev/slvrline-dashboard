"use client";

import type { HistoryResponse } from "@/hooks/useHistory";

export interface ChartSeries {
  key: "v" | "v2" | "v3";
  color: string;
  label?: string;
}

interface Props {
  data: HistoryResponse | undefined;
  isLoading: boolean;
  series: ChartSeries[];
}

/**
 * Dependency-free, SSR-safe line/area chart rendered as inline SVG.
 * Replaces the canvas charting libs (echarts / lightweight-charts), whose
 * dynamic imports silently failed to mount in the Next 15 production bundle.
 */
export default function LineChartSvg({ data, isLoading, series }: Props) {
  const W = 1000;
  const H = 256;
  const padL = 6;
  const padR = 6;
  const padT = 16;
  const padB = 16;

  const rows = data?.rows ?? [];
  const pts = series.map((s) =>
    rows
      .map((r) => ({ t: Date.parse(r.t), y: r[s.key] }))
      .filter(
        (p): p is { t: number; y: number } =>
          p.y !== null && Number.isFinite(p.y) && Number.isFinite(p.t)
      )
  );

  const allY = pts.flat().map((p) => p.y);
  const allT = pts.flat().map((p) => p.t);

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

  if (allY.length === 0) {
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

  const minY = Math.min(...allY);
  const maxY = Math.max(...allY);
  const minT = Math.min(...allT);
  const maxT = Math.max(...allT);
  const spanY = maxY - minY || 1;
  const spanT = maxT - minT || 1;

  const sx = (t: number) => padL + ((t - minT) / spanT) * (W - padL - padR);
  const sy = (v: number) => padT + (1 - (v - minY) / spanY) * (H - padT - padB);

  const toLine = (p: { t: number; y: number }[]) =>
    p.map((q, i) => `${i ? "L" : "M"}${sx(q.t).toFixed(1)} ${sy(q.y).toFixed(1)}`).join(" ");
  const toArea = (p: { t: number; y: number }[]) =>
    p.length
      ? `${toLine(p)} L${sx(p[p.length - 1].t).toFixed(1)} ${H - padB} L${sx(p[0].t).toFixed(1)} ${H - padB} Z`
      : "";

  const grid = [0.25, 0.5, 0.75].map((f) => padT + f * (H - padT - padB));

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      style={{ width: "100%", height: "100%", display: "block" }}
    >
      {grid.map((gy, i) => (
        <line
          key={i}
          x1={padL}
          x2={W - padR}
          y1={gy}
          y2={gy}
          stroke="var(--color-silver-800)"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {series.map((s, si) =>
        pts[si].length ? (
          <g key={s.key}>
            <path d={toArea(pts[si])} fill={s.color} opacity={0.1} />
            <path
              d={toLine(pts[si])}
              fill="none"
              stroke={s.color}
              strokeWidth={2}
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          </g>
        ) : null
      )}
    </svg>
  );
}

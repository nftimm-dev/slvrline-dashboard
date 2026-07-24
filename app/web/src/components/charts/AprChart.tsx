"use client";

import { useEffect, useRef } from "react";
import type { UTCTimestamp } from "lightweight-charts";
import type { HistoryResponse } from "@/hooks/useHistory";

interface AprChartProps {
  data: HistoryResponse | undefined;
  isLoading: boolean;
}

const CHART_BG = "#111118";
const TEXT_COLOR = "#c8d0e0";
const GRID_COLOR = "#2a2a38";
const APR_COLOR = "#a8f0c8";

function buildPoints(data: HistoryResponse | undefined) {
  if (!data?.rows) return null;
  const rows = data.rows.filter((r) => r.v !== null);
  if (rows.length === 0) return null;
  const points = rows.map((r) => ({
    time: Math.floor(new Date(r.t).getTime() / 1000) as UTCTimestamp,
    value: r.v as number,
  }));
  // Sort ascending — lightweight-charts requires monotonically increasing time
  points.sort((a, b) => a.time - b.time);
  // De-duplicate: drop any point whose time is <= the previous point's time
  const deduped: typeof points = [];
  let lastTime = -Infinity;
  for (const p of points) {
    if (p.time > lastTime) {
      deduped.push(p);
      lastTime = p.time;
    }
  }
  return deduped.length > 0 ? deduped : null;
}

export default function AprChart({ data, isLoading }: AprChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chartRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const seriesRef = useRef<any>(null);
  // Keep a ref to the latest data so the init callback can apply it immediately
  const dataRef = useRef<HistoryResponse | undefined>(data);
  dataRef.current = data;

  useEffect(() => {
    if (!containerRef.current) return;

    let cleanupFn: (() => void) | undefined;

    async function init() {
      const lc = await import("lightweight-charts");
      const el = containerRef.current;
      if (!el) return;

      const chart = lc.createChart(el, {
        width: el.clientWidth,
        height: el.clientHeight,
        layout: {
          background: { type: lc.ColorType.Solid, color: CHART_BG },
          textColor: TEXT_COLOR,
          fontFamily: "'JetBrains Mono', monospace",
        },
        grid: {
          vertLines: { color: GRID_COLOR },
          horzLines: { color: GRID_COLOR },
        },
        timeScale: {
          timeVisible: true,
          borderColor: GRID_COLOR,
        },
        rightPriceScale: {
          borderColor: GRID_COLOR,
        },
        crosshair: {
          vertLine: {
            color: "#7eb8e840",
            labelBackgroundColor: "#3d6e9a",
          },
          horzLine: {
            color: "#7eb8e840",
            labelBackgroundColor: "#3d6e9a",
          },
        },
      });

      // lightweight-charts v5: use addSeries with LineSeries
      const series = chart.addSeries(lc.LineSeries, {
        color: APR_COLOR,
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: true,
        title: "APR %",
        priceFormat: {
          type: "custom",
          formatter: (v: number) =>
            v >= 1000
              ? Math.round(v).toLocaleString() + "%"
              : v.toFixed(1) + "%",
          minMove: 0.01,
        },
      });

      chartRef.current = chart;
      seriesRef.current = series;

      // If data arrived before init completed, apply it now
      const points = buildPoints(dataRef.current);
      if (points) {
        try {
          series.setData(points);
          chart.timeScale().fitContent();
        } catch {
          // ignore
        }
      }

      const ro = new ResizeObserver(() => {
        if (el) {
          chart.applyOptions({
            width: el.clientWidth,
            height: el.clientHeight,
          });
        }
      });
      ro.observe(el);

      cleanupFn = () => {
        ro.disconnect();
        chart.remove();
        chartRef.current = null;
        seriesRef.current = null;
      };
    }

    init();

    return () => cleanupFn?.();
  }, []);

  // Update data when it changes (handles the normal case: data arrives after init)
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;

    const points = buildPoints(data);
    if (!points) return;

    try {
      series.setData(points);
      chartRef.current?.timeScale().fitContent();
    } catch {
      // Ignore stale data errors
    }
  }, [data]);

  if (isLoading && !data) {
    return (
      <div
        className="w-full h-full rounded"
        style={{
          backgroundColor: "var(--color-silver-800)",
          animation: "pulse 2s ease-in-out infinite",
        }}
      />
    );
  }

  if (!data || data.rows.filter((r) => r.v !== null).length === 0) {
    return (
      <div
        className="w-full h-full flex items-center justify-center"
        style={{ color: "var(--color-silver-400)", fontSize: "0.8125rem" }}
      >
        No data for this range
      </div>
    );
  }

  return <div ref={containerRef} style={{ width: "100%", height: "100%" }} />;
}

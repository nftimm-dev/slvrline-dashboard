"use client";

import { useRef, useEffect } from "react";
import type { HistoryResponse } from "@/hooks/useHistory";

interface SupplyChartProps {
  data: HistoryResponse | undefined;
  isLoading: boolean;
}

const DARK_BG = "#111118";
const TEXT_COLOR = "#c8d0e0";
const GRID_COLOR = "#2a2a38";

export default function SupplyChart({ data, isLoading }: SupplyChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chartRef = useRef<any>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    let echartsInstance: { dispose(): void; setOption(o: unknown): void; resize(): void } | null = null;

    async function init() {
      const echarts = await import("echarts/core");
      const { LineChart } = await import("echarts/charts");
      const {
        GridComponent,
        TooltipComponent,
        LegendComponent,
      } = await import("echarts/components");
      const { CanvasRenderer } = await import("echarts/renderers");

      echarts.use([
        LineChart,
        GridComponent,
        TooltipComponent,
        LegendComponent,
        CanvasRenderer,
      ]);

      const el = containerRef.current;
      if (!el) return;

      echartsInstance = echarts.init(el, null, { renderer: "canvas" }) as unknown as {
        dispose(): void;
        setOption(o: unknown): void;
        resize(): void;
      };
      chartRef.current = echartsInstance;

      const ro = new ResizeObserver(() => echartsInstance?.resize());
      ro.observe(el);

      return () => ro.disconnect();
    }

    const cleanup = init();

    return () => {
      cleanup.then((fn) => fn?.());
      if (chartRef.current) {
        chartRef.current.dispose();
        chartRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!chartRef.current || !data?.rows) return;

    const rows = data.rows.filter((r) => r.v !== null);
    if (rows.length === 0) return;

    const xData = rows.map((r) => r.t.slice(0, 16).replace("T", " "));
    const circ = rows.map((r) => r.v ?? 0);
    const total = rows.map((r) => r.v2 ?? r.v ?? 0);

    chartRef.current.setOption({
      backgroundColor: DARK_BG,
      textStyle: { color: TEXT_COLOR, fontFamily: "Inter, sans-serif" },
      legend: {
        data: ["Circulating", "Total Emitted"],
        textStyle: { color: TEXT_COLOR },
        top: 4,
        right: 8,
        itemWidth: 12,
        itemHeight: 8,
        icon: "roundRect",
      },
      tooltip: {
        trigger: "axis",
        backgroundColor: "#1a1a24",
        borderColor: GRID_COLOR,
        textStyle: { color: TEXT_COLOR, fontSize: 12 },
        formatter: (params: { seriesName: string; value: number }[]) => {
          return params
            .map(
              (p) =>
                `${p.seriesName}: ${Math.round(p.value).toLocaleString()} SLVR`
            )
            .join("<br/>");
        },
      },
      grid: { left: 56, right: 16, top: 36, bottom: 28 },
      xAxis: {
        type: "category",
        data: xData,
        axisLine: { lineStyle: { color: GRID_COLOR } },
        axisLabel: {
          color: TEXT_COLOR,
          fontSize: 10,
          showMaxLabel: true,
          showMinLabel: true,
          interval: Math.floor(xData.length / 4),
        },
        splitLine: { show: false },
      },
      yAxis: {
        type: "value",
        axisLine: { show: false },
        splitLine: { lineStyle: { color: GRID_COLOR } },
        axisLabel: {
          color: TEXT_COLOR,
          fontSize: 10,
          formatter: (v: number) => `${(v / 1000).toFixed(0)}K`,
        },
      },
      series: [
        {
          name: "Circulating",
          type: "line",
          data: circ,
          smooth: true,
          symbol: "none",
          lineStyle: { color: "#c8b8f0", width: 2 },
          areaStyle: { color: "#c8b8f0", opacity: 0.1 },
          emphasis: { focus: "series" },
        },
        {
          name: "Total Emitted",
          type: "line",
          data: total,
          smooth: true,
          symbol: "none",
          lineStyle: { color: "#8888bb", width: 2 },
          areaStyle: { color: "#8888bb", opacity: 0.07 },
          emphasis: { focus: "series" },
        },
      ],
    });
  }, [data]);

  if (isLoading && !data) {
    return (
      <div
        className="w-full h-full"
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

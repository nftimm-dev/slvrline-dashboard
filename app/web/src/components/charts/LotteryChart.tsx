"use client";

import { useRef, useEffect } from "react";
import type { HistoryResponse } from "@/hooks/useHistory";

interface LotteryChartProps {
  data: HistoryResponse | undefined;
  isLoading: boolean;
}

const DARK_BG = "#111118";
const TEXT_COLOR = "#c8d0e0";
const GRID_COLOR = "#2a2a38";

function applyLotteryOption(
  instance: { setOption(o: unknown): void },
  data: HistoryResponse
) {
  // Use all rows where v is non-null (v = round number, 0 is a valid state)
  const rows = data.rows.filter((r) => r.v !== null);
  if (rows.length === 0) return;

  const xData = rows.map((r) => r.t.slice(0, 16).replace("T", " "));
  const rounds = rows.map((r) => r.v ?? 0); // round number (0 = inactive)

  // v2 = jackpot (ETH) — may be mostly null; only include the series if there are values
  const hasJackpot = rows.some((r) => r.v2 != null);
  const jackpot = rows.map((r) => r.v2 ?? null);
  const labelInterval = Math.max(0, Math.floor(xData.length / 4) - 1);

  const yAxes = hasJackpot
    ? [
        {
          type: "value",
          name: "Round",
          nameTextStyle: { color: TEXT_COLOR, fontSize: 9 },
          axisLine: { show: false },
          splitLine: { lineStyle: { color: GRID_COLOR } },
          axisLabel: {
            color: TEXT_COLOR,
            fontSize: 10,
            formatter: (v: number) =>
              v >= 1000 ? `${(v / 1000).toFixed(0)}K` : String(v),
          },
        },
        {
          type: "value",
          name: "ETH",
          nameTextStyle: { color: TEXT_COLOR, fontSize: 9 },
          position: "right",
          axisLine: { show: false },
          splitLine: { show: false },
          axisLabel: {
            color: TEXT_COLOR,
            fontSize: 10,
            formatter: (v: number) => v.toFixed(2),
          },
        },
      ]
    : [
        {
          type: "value",
          axisLine: { show: false },
          splitLine: { lineStyle: { color: GRID_COLOR } },
          axisLabel: {
            color: TEXT_COLOR,
            fontSize: 10,
            formatter: (v: number) =>
              v >= 1000 ? `${(v / 1000).toFixed(0)}K` : String(v),
          },
        },
      ];

  const series = [
    {
      name: "Round #",
      type: "line",
      yAxisIndex: 0,
      data: rounds,
      smooth: true,
      symbol: "none",
      lineStyle: { color: "#f0a8b8", width: 2 },
      areaStyle: { color: "#f0a8b8", opacity: 0.08 },
    },
    ...(hasJackpot
      ? [
          {
            name: "Jackpot (ETH)",
            type: "bar",
            yAxisIndex: 1,
            data: jackpot,
            itemStyle: { color: "#7eb8e8", opacity: 0.7, borderRadius: [2, 2, 0, 0] },
          },
        ]
      : []),
  ];

  instance.setOption({
    backgroundColor: DARK_BG,
    textStyle: { color: TEXT_COLOR, fontFamily: "Inter, sans-serif" },
    legend: {
      data: hasJackpot ? ["Round #", "Jackpot (ETH)"] : ["Round #"],
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
      formatter: (params: { seriesName: string; value: number | null }[]) =>
        params
          .filter((p) => p.value != null)
          .map((p) =>
            p.seriesName === "Round #"
              ? `Round: #${Math.round(p.value as number).toLocaleString()}`
              : `Jackpot: ${(p.value as number).toFixed(3)} ETH`
          )
          .join("<br/>"),
    },
    grid: { left: 56, right: hasJackpot ? 64 : 16, top: 36, bottom: 28 },
    xAxis: {
      type: "category",
      data: xData,
      axisLine: { lineStyle: { color: GRID_COLOR } },
      axisLabel: {
        color: TEXT_COLOR,
        fontSize: 10,
        interval: labelInterval,
      },
      splitLine: { show: false },
    },
    yAxis: yAxes,
    series,
  });
}

export default function LotteryChart({ data, isLoading }: LotteryChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chartRef = useRef<any>(null);
  // Keep a ref to the latest data so the init callback can apply it immediately
  const dataRef = useRef<HistoryResponse | undefined>(data);
  dataRef.current = data;

  useEffect(() => {
    if (!containerRef.current) return;

    let instance: { dispose(): void; setOption(o: unknown): void; resize(): void } | null = null;
    let ro: ResizeObserver | null = null;

    async function init() {
      const echarts = await import("echarts/core");
      const { BarChart, LineChart } = await import("echarts/charts");
      const { GridComponent, TooltipComponent, LegendComponent } = await import(
        "echarts/components"
      );
      const { CanvasRenderer } = await import("echarts/renderers");
      echarts.use([
        BarChart,
        LineChart,
        GridComponent,
        TooltipComponent,
        LegendComponent,
        CanvasRenderer,
      ]);

      const el = containerRef.current;
      if (!el) return;

      instance = echarts.init(el, null, { renderer: "canvas" }) as unknown as {
        dispose(): void;
        setOption(o: unknown): void;
        resize(): void;
      };
      chartRef.current = instance;

      // If data arrived before init completed, apply it now
      if (dataRef.current) {
        applyLotteryOption(instance, dataRef.current);
      }

      ro = new ResizeObserver(() => instance?.resize());
      ro.observe(el);
    }

    init();

    return () => {
      ro?.disconnect();
      if (chartRef.current) {
        chartRef.current.dispose();
        chartRef.current = null;
      }
    };
  }, []);

  // Update data when it changes (handles the normal case: data arrives after init)
  useEffect(() => {
    if (!chartRef.current || !data) return;
    applyLotteryOption(chartRef.current, data);
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

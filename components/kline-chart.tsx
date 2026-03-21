"use client";

import { useQuery } from "@tanstack/react-query";
import * as echarts from "echarts";
import { useEffect, useRef, useState } from "react";

type Candle = { time: string; open: number; high: number; low: number; close: number; volume: number };
type Period = "realtime" | "day" | "week" | "month";

const PERIODS: { key: Period; label: string }[] = [
  { key: "realtime", label: "实时" },
  { key: "day",      label: "日线" },
  { key: "week",     label: "周线" },
  { key: "month",    label: "月线" },
];

async function fetchKline(symbol: string, period: Period): Promise<Candle[]> {
  const res = await fetch(`/api/market/kline?symbol=${symbol}&period=${period}`);
  return res.json() as Promise<Candle[]>;
}

// 将日线数据聚合为周/月
function aggregate(candles: Candle[], by: "week" | "month"): Candle[] {
  const groups = new Map<string, Candle[]>();
  for (const c of candles) {
    const d = new Date(c.time);
    let key: string;
    if (by === "week") {
      const day = d.getDay();
      const monday = new Date(d);
      monday.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
      key = monday.toISOString().slice(0, 10);
    } else {
      key = c.time.slice(0, 7); // YYYY-MM
    }
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(c);
  }
  return Array.from(groups.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, cs]) => ({
      time:   key,
      open:   cs[0]!.open,
      high:   Math.max(...cs.map((c) => c.high)),
      low:    Math.min(...cs.map((c) => c.low)),
      close:  cs[cs.length - 1]!.close,
      volume: cs.reduce((s, c) => s + c.volume, 0),
    }));
}

function fmtVol(v: number): string {
  if (v >= 1e8) return `${(v / 1e8).toFixed(1)}亿`;
  if (v >= 1e4) return `${(v / 1e4).toFixed(0)}万`;
  return String(v);
}

function buildOption(candles: Candle[], period: Period): echarts.EChartsOption {
  const data = period === "week"
    ? aggregate(candles, "week")
    : period === "month"
      ? aggregate(candles, "month")
      : candles;

  const times  = data.map((d) => d.time);
  const vols   = data.map((d) => d.volume);
  const upColor   = "#ef4444";
  const downColor = "#22c55e";

  const volFormatter = (v: number) => fmtVol(v);

  // 成交量颜色（实时用固定色，K线用涨跌色）
  const volData = period === "realtime"
    ? vols.map((v) => ({ value: v, itemStyle: { color: "#94a3b8", opacity: 0.6 } }))
    : (() => {
        const ohlc = data.map((d) => [d.open, d.close, d.low, d.high]);
        return vols.map((v, i) => ({
          value: v,
          itemStyle: { color: (ohlc[i]![1] as number) >= (ohlc[i]![0] as number) ? upColor : downColor, opacity: 0.7 },
        }));
      })();

  if (period === "realtime") {
    // 分时折线图
    const closes = data.map((d) => d.close);
    const basePrice = closes[0] ?? 0;
    return {
      animation: false,
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "line" },
        formatter: (params: unknown) => {
          const list = params as echarts.DefaultLabelFormatterCallbackParams[];
          const p = list.find((x) => x.seriesName === "价格");
          const v = list.find((x) => x.seriesName === "成交量");
          if (!p) return "";
          const price = p.value as number;
          const color = price >= basePrice ? upColor : downColor;
          return `<div style="font-size:12px;line-height:1.8">
            <b>${p.name}</b><br/>
            价格 <span style="color:${color}">${price.toFixed(2)}</span><br/>
            ${v ? `量 ${fmtVol(v.value as number)}` : ""}
          </div>`;
        },
      },
      axisPointer: { link: [{ xAxisIndex: "all" }] },
      grid: [
        { left: 60, right: 16, top: 16, bottom: 100 },
        { left: 60, right: 16, top: "72%", bottom: 24 },
      ],
      xAxis: [
        { type: "category", data: times, gridIndex: 0, axisLabel: { show: false }, axisLine: { lineStyle: { color: "#e4e4e7" } }, boundaryGap: false },
        { type: "category", data: times, gridIndex: 1, axisLabel: { fontSize: 10, color: "#a1a1aa", formatter: (v: string) => v.slice(11, 16) }, axisLine: { lineStyle: { color: "#e4e4e7" } }, boundaryGap: false },
      ],
      yAxis: [
        { scale: true, gridIndex: 0, splitLine: { lineStyle: { color: "#f4f4f5" } }, axisLabel: { fontSize: 10, color: "#a1a1aa" } },
        { scale: true, gridIndex: 1, splitLine: { show: false }, axisLabel: { fontSize: 9, color: "#a1a1aa", formatter: volFormatter } },
      ],
      dataZoom: [
        { type: "inside", xAxisIndex: [0, 1], start: 0, end: 100 },
        { type: "slider", xAxisIndex: [0, 1], bottom: 4, height: 18, start: 0, end: 100, textStyle: { fontSize: 9 } },
      ],
      series: [
        {
          name: "价格",
          type: "line",
          xAxisIndex: 0,
          yAxisIndex: 0,
          data: closes,
          symbol: "none",
          lineStyle: { color: upColor, width: 1.5 },
          areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: "rgba(239,68,68,0.2)" },
            { offset: 1, color: "rgba(239,68,68,0)" },
          ]) },
        },
        {
          name: "成交量",
          type: "bar",
          xAxisIndex: 1,
          yAxisIndex: 1,
          data: volData,
        },
      ],
    };
  }

  // K线蜡烛图
  const ohlc = data.map((d) => [d.open, d.close, d.low, d.high]);
  return {
    animation: false,
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "cross" },
      formatter: (params: unknown) => {
        const list = params as echarts.DefaultLabelFormatterCallbackParams[];
        const k = list.find((p) => p.seriesName === "K线");
        const v = list.find((p) => p.seriesName === "成交量");
        if (!k) return "";
        const [o, c, l, h] = k.value as number[];
        const color = c >= o ? upColor : downColor;
        return `<div style="font-size:12px;line-height:1.8">
          <b>${k.name}</b><br/>
          开 <span style="color:${color}">${o}</span>　
          收 <span style="color:${color}">${c}</span><br/>
          高 <span style="color:${color}">${h}</span>　
          低 <span style="color:${color}">${l}</span><br/>
          ${v ? `量 ${fmtVol(v.value as number)}` : ""}
        </div>`;
      },
    },
    axisPointer: { link: [{ xAxisIndex: "all" }] },
    grid: [
      { left: 60, right: 16, top: 16, bottom: 100 },
      { left: 60, right: 16, top: "72%", bottom: 24 },
    ],
    xAxis: [
      { type: "category", data: times, gridIndex: 0, axisLabel: { show: false }, axisLine: { lineStyle: { color: "#e4e4e7" } } },
      { type: "category", data: times, gridIndex: 1, axisLabel: { fontSize: 10, color: "#a1a1aa" }, axisLine: { lineStyle: { color: "#e4e4e7" } } },
    ],
    yAxis: [
      { scale: true, gridIndex: 0, splitLine: { lineStyle: { color: "#f4f4f5" } }, axisLabel: { fontSize: 10, color: "#a1a1aa" } },
      { scale: true, gridIndex: 1, splitLine: { show: false }, axisLabel: { fontSize: 9, color: "#a1a1aa", formatter: volFormatter } },
    ],
    dataZoom: [
      { type: "inside", xAxisIndex: [0, 1], start: 60, end: 100 },
      { type: "slider", xAxisIndex: [0, 1], bottom: 4, height: 18, start: 60, end: 100, textStyle: { fontSize: 9 } },
    ],
    series: [
      {
        name: "K线",
        type: "candlestick",
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: ohlc,
        itemStyle: {
          color: upColor,
          color0: downColor,
          borderColor: upColor,
          borderColor0: downColor,
        },
      },
      {
        name: "成交量",
        type: "bar",
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: volData,
      },
    ],
  };
}

export default function KlineChart({
  symbol,
  height = 380,
}: {
  symbol: string;
  height?: number;
}) {
  const [period, setPeriod] = useState<Period>("day");
  const chartRef  = useRef<HTMLDivElement>(null);
  const chartInst = useRef<echarts.ECharts | null>(null);

  const { data: candles = [], isLoading } = useQuery({
    queryKey: ["kline", symbol, period],
    queryFn: () => fetchKline(symbol, period),
    staleTime: period === "realtime" ? 60_000 : 5 * 60_000,
    refetchInterval: period === "realtime" ? 60_000 : false,
  });

  // 初始化 / 销毁
  useEffect(() => {
    if (!chartRef.current) return;
    const chart = echarts.init(chartRef.current, undefined, { renderer: "canvas" });
    chartInst.current = chart;
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(chartRef.current);
    return () => { ro.disconnect(); chart.dispose(); chartInst.current = null; };
  }, []);

  // 数据更新
  useEffect(() => {
    if (!chartInst.current || candles.length === 0) return;
    chartInst.current.setOption(buildOption(candles, period), true);
  }, [candles, period]);

  return (
    <div className="flex flex-col gap-2">
      {/* 周期切换 */}
      <div className="flex gap-1">
        {PERIODS.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => setPeriod(p.key)}
            className={`rounded-md px-3 py-1 text-xs font-medium transition ${
              period === p.key
                ? "bg-zinc-900 text-white"
                : "border border-zinc-200 text-zinc-500 hover:border-zinc-400 hover:text-zinc-700"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* 图表区 */}
      <div className="relative rounded-xl border border-zinc-100 bg-white overflow-hidden" style={{ height }}>
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-zinc-400">
            加载中...
          </div>
        )}
        {!isLoading && candles.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-zinc-400">
            暂无数据
          </div>
        )}
        <div ref={chartRef} className="w-full h-full" />
      </div>
    </div>
  );
}

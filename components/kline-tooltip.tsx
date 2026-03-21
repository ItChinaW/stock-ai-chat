"use client";

import { useQuery } from "@tanstack/react-query";
import * as echarts from "echarts";
import { useEffect, useRef, useState } from "react";

type Candle = { time: string; open: number; high: number; low: number; close: number };

async function fetchKline(symbol: string): Promise<Candle[]> {
  const res = await fetch(`/api/market/kline?symbol=${symbol}&period=day`);
  return res.json() as Promise<Candle[]>;
}

export default function KlineTooltip({ symbol, children }: { symbol: string; children: React.ReactNode }) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInst = useRef<echarts.ECharts | null>(null);

  const { data: candles = [] } = useQuery({
    queryKey: ["kline", symbol, "day"],
    queryFn: () => fetchKline(symbol),
    enabled: visible,
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    if (!visible || !chartRef.current || candles.length === 0) return;
    if (!chartInst.current) {
      chartInst.current = echarts.init(chartRef.current, undefined, { renderer: "canvas" });
    }
    const upColor = "#ef4444", downColor = "#22c55e";
    const data = candles.slice(-60);
    chartInst.current.setOption({
      animation: false,
      grid: { left: 50, right: 8, top: 8, bottom: 24 },
      xAxis: { type: "category", data: data.map((d) => d.time), axisLabel: { fontSize: 9, color: "#a1a1aa" } },
      yAxis: { scale: true, splitLine: { lineStyle: { color: "#f4f4f5" } }, axisLabel: { fontSize: 9, color: "#a1a1aa" } },
      series: [{
        type: "candlestick",
        data: data.map((d) => [d.open, d.close, d.low, d.high]),
        itemStyle: { color: upColor, color0: downColor, borderColor: upColor, borderColor0: downColor },
      }],
    }, true);
    return () => { chartInst.current?.dispose(); chartInst.current = null; };
  }, [visible, candles]);

  function handleMouseEnter(e: React.MouseEvent) {
    timerRef.current = setTimeout(() => { setPos({ x: e.clientX, y: e.clientY }); setVisible(true); }, 400);
  }
  function handleMouseLeave() { if (timerRef.current) clearTimeout(timerRef.current); setVisible(false); }
  function handleMouseMove(e: React.MouseEvent) { if (visible) setPos({ x: e.clientX, y: e.clientY }); }

  const tooltipStyle: React.CSSProperties = (() => {
    const W = typeof window !== "undefined" ? window.innerWidth : 1200;
    const H = typeof window !== "undefined" ? window.innerHeight : 800;
    const tw = 340, th = 230;
    let left = pos.x + 16, top = pos.y - th / 2;
    if (left + tw > W) left = pos.x - tw - 16;
    if (top < 8) top = 8;
    if (top + th > H) top = H - th - 8;
    return { position: "fixed", left, top, zIndex: 9999, pointerEvents: "none" };
  })();

  return (
    <span onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave} onMouseMove={handleMouseMove} className="inline-block">
      {children}
      {visible && (
        <div style={tooltipStyle} className="rounded-xl border border-zinc-200 bg-white shadow-xl overflow-hidden">
          <div className="px-3 py-1.5 border-b border-zinc-100 text-xs font-medium text-zinc-600">
            {symbol} · 日K（近60日）
          </div>
          {candles.length === 0
            ? <div className="flex items-center justify-center h-[180px] w-[320px] text-xs text-zinc-400">加载中...</div>
            : <div ref={chartRef} style={{ width: 320, height: 180 }} />
          }
        </div>
      )}
    </span>
  );
}

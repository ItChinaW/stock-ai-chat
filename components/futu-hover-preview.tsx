"use client";

import * as echarts from "echarts";
import { ExternalLink, TrendingDown, TrendingUp } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * 把任意卡片包起来：hover 停留 ~400ms 后，在卡片旁弹出一张自制迷你行情卡。
 * 不内嵌外部页面（会被反爬 403），而是用我们已抓到的行情数据
 * + 项目已有的 K 线接口画一条走势图，零 403、完全可控。
 *
 * 离开卡片后延迟关闭，留时间把鼠标移到浮层上操作（移上去取消关闭）。
 */

const HOVER_DELAY_MS = 400;
const CLOSE_DELAY_MS = 300;
const PANEL_W = 320;
const PANEL_H = 260;

export type PreviewQuote = {
  name?: string;
  price?: number;
  changePercent?: number;
  extendedSession?: "pre" | "post" | "overnight";
  extendedPrice?: number;
  extendedChangePercent?: number;
  extendedStale?: boolean;
};

type Candle = { time: string; close: number };

function sessionLabel(session?: "pre" | "post" | "overnight", stale?: boolean): string {
  if (stale) return "已收市";
  if (session === "pre") return "盘前";
  if (session === "overnight") return "夜盘";
  return "盘后";
}

function toFutuTicker(code: string): string {
  let s = code.trim();
  if (s.toLowerCase().startsWith("gb_")) s = s.slice(3);
  s = s.replace(/-US$/i, "");
  return s.toUpperCase();
}

export default function FutuHoverPreview({
  code,
  quote,
  enabled = true,
  children,
}: {
  code: string;
  quote?: PreviewQuote;
  enabled?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const chartElRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const openTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const ticker = toFutuTicker(code);
  const yahooUrl = `https://finance.yahoo.com/quote/${ticker}/`;

  function computePosition() {
    const el = (wrapRef.current?.firstElementChild as HTMLElement) ?? wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const gap = 2;
    let left = r.right + gap;
    if (left + PANEL_W > window.innerWidth - 8) left = r.left - gap - PANEL_W;
    if (left < 8) left = 8;
    let top = r.top;
    if (top + PANEL_H > window.innerHeight - 8) top = window.innerHeight - 8 - PANEL_H;
    if (top < 8) top = 8;
    setPos({ left, top });
  }

  function cancelClose() {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }

  function handleEnter() {
    if (!enabled) return;
    cancelClose();
    if (openTimerRef.current) clearTimeout(openTimerRef.current);
    openTimerRef.current = setTimeout(() => {
      computePosition();
      setOpen(true);
    }, HOVER_DELAY_MS);
  }

  function scheduleClose() {
    if (openTimerRef.current) clearTimeout(openTimerRef.current);
    cancelClose();
    closeTimerRef.current = setTimeout(() => setOpen(false), CLOSE_DELAY_MS);
  }

  useEffect(() => {
    return () => {
      if (openTimerRef.current) clearTimeout(openTimerRef.current);
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, []);

  // 浮层打开后：拉日线数据画 sparkline
  useEffect(() => {
    if (!open || !chartElRef.current) return;
    let disposed = false;
    const chart = echarts.init(chartElRef.current);
    chartRef.current = chart;
    chart.showLoading({ text: "", maskColor: "rgba(255,255,255,0.6)" });

    fetch(`/api/market/kline?symbol=${encodeURIComponent(ticker)}&period=day`)
      .then((r) => r.json() as Promise<Candle[]>)
      .then((candles) => {
        if (disposed) return;
        chart.hideLoading();
        const recent = candles.slice(-60);
        const closes = recent.map((c) => c.close);
        const up = closes.length >= 2 && closes[closes.length - 1]! >= closes[0]!;
        const color = up ? "#10b981" : "#f43f5e";
        chart.setOption({
          grid: { left: 0, right: 0, top: 6, bottom: 0 },
          xAxis: { type: "category", show: false, data: recent.map((c) => c.time) },
          yAxis: { type: "value", show: false, scale: true },
          tooltip: { trigger: "axis", formatter: (p: unknown) => {
            const arr = p as { axisValue: string; data: number }[];
            const it = arr[0];
            return it ? `${it.axisValue}<br/>${it.data.toFixed(3)}` : "";
          } },
          series: [
            {
              type: "line",
              data: closes,
              showSymbol: false,
              lineStyle: { color, width: 1.5 },
              areaStyle: {
                color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                  { offset: 0, color: up ? "rgba(16,185,129,0.25)" : "rgba(244,63,94,0.25)" },
                  { offset: 1, color: "rgba(255,255,255,0)" },
                ]),
              },
            },
          ],
        });
      })
      .catch(() => {
        if (!disposed) chart.hideLoading();
      });

    return () => {
      disposed = true;
      chart.dispose();
      chartRef.current = null;
    };
  }, [open, ticker]);

  if (!enabled) return <>{children}</>;

  const price = quote?.price;
  const pct = quote?.changePercent ?? 0;
  const positive = pct >= 0;
  const extPositive = (quote?.extendedChangePercent ?? 0) >= 0;

  return (
    <div ref={wrapRef} onMouseEnter={handleEnter} onMouseLeave={scheduleClose} className="contents">
      {children}
      {open &&
        pos &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            style={{ position: "fixed", left: pos.left, top: pos.top, width: PANEL_W, height: PANEL_H, zIndex: 9999 }}
            onMouseEnter={cancelClose}
            onMouseLeave={scheduleClose}
            className="flex flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-2xl"
          >
            {/* 头部 */}
            <div className="flex items-center justify-between bg-[#6001d2] px-3 py-1.5 text-xs font-medium text-white">
              <span className="truncate">{quote?.name || ticker}</span>
              <a
                href={yahooUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-2 inline-flex shrink-0 items-center gap-1 rounded px-1 py-0.5 hover:bg-white/20"
              >
                Yahoo 详情 <ExternalLink size={12} />
              </a>
            </div>

            {/* 价格区 */}
            <div className="flex items-baseline justify-between px-3 pt-2.5">
              <div>
                <div className="text-2xl font-semibold text-zinc-800">
                  {price != null ? price.toFixed(3) : "--"}
                </div>
                <div className={`mt-0.5 flex items-center gap-1 text-sm font-medium ${positive ? "text-emerald-600" : "text-rose-600"}`}>
                  {positive ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
                  {price != null ? `${positive ? "+" : ""}${pct.toFixed(2)}%` : "--"}
                </div>
              </div>
              {quote?.extendedPrice != null && quote.extendedSession && (
                <div className="text-right text-xs">
                  <span className={`rounded px-1 py-0.5 ${quote.extendedStale ? "bg-zinc-100 text-zinc-500" : quote.extendedSession === "overnight" ? "bg-violet-100 text-violet-700" : "bg-indigo-100 text-indigo-700"}`}>
                    {sessionLabel(quote.extendedSession, quote.extendedStale)}
                  </span>
                  <div className="mt-1 text-zinc-700">{quote.extendedPrice.toFixed(3)}</div>
                  <div className={extPositive ? "text-emerald-600" : "text-rose-600"}>
                    {extPositive ? "+" : ""}{(quote.extendedChangePercent ?? 0).toFixed(2)}%
                  </div>
                </div>
              )}
            </div>

            {/* 走势图 */}
            <div className="mt-1 flex-1 px-2 pb-2">
              <div ref={chartElRef} className="h-full w-full" />
            </div>
            <div className="px-3 pb-1.5 text-[10px] text-zinc-400">近 60 日 · 数据来自 Yahoo</div>
          </div>,
          document.body
        )}
    </div>
  );
}

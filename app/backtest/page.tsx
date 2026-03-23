"use client";

import { STRATEGY_DEFS } from "@/lib/backtest-engine";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as echarts from "echarts";
import { ArrowLeft, BarChart2, Bot, FileText, Play, Send, Square, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";

type BacktestRecord = {
  id: number;
  name: string;
  symbol: string;
  strategyCode: string;
  params: string;
  startDate: string;
  endDate: string;
  initCapital: number;
  mode: string;
  totalReturn: number | null;
  totalPnl: number | null;
  annualReturn: number | null;
  maxDrawdown: number | null;
  tradeCount: number | null;
  winRate: number | null;
  sharpe: number | null;
  sortino: number | null;
  calmar: number | null;
  avgHoldDays: number | null;
  avgWin: number | null;
  avgLoss: number | null;
  profitFactor: number | null;
  equityCurve: string | null;
  trades: string | null;
  status: string;
  errorMsg: string | null;
  createdAt: string;
};

const PRESETS = [
  { label: "近1月", months: 1 },
  { label: "近3月", months: 3 },
  { label: "近半年", months: 6 },
  { label: "近1年", months: 12 },
  { label: "近2年", months: 24 },
];

function fmt(v: number | null, isPercent = false, digits = 2) {
  if (v == null) return "-";
  const n = isPercent ? v * 100 : v;
  return `${n >= 0 ? "+" : ""}${n.toFixed(digits)}${isPercent ? "%" : ""}`;
}

type CompareResult = {
  code: string; label: string;
  totalReturn: number; annualReturn: number;
  maxDrawdown: number; sharpe: number; winRate: number; tradeCount: number;
};

function CompareChart({ results, metric }: { results: CompareResult[]; metric: "annualReturn" | "maxDrawdown" | "sharpe" | "winRate" }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current || results.length === 0) return;
    const chart = echarts.init(ref.current);
    const sorted = [...results].sort((a, b) => {
      if (metric === "maxDrawdown") return a[metric] - b[metric];
      return b[metric] - a[metric];
    });
    const labels = sorted.map((r) => r.label);
    const values = sorted.map((r) => {
      const v = r[metric];
      if (metric === "annualReturn" || metric === "winRate") return +(v * 100).toFixed(2);
      if (metric === "maxDrawdown") return +(v * 100).toFixed(2);
      return +v.toFixed(3);
    });
    const isPercent = metric !== "sharpe";
    const colors = values.map((v) =>
      metric === "maxDrawdown" ? "#10b981" : v >= 0 ? "#ef4444" : "#10b981"
    );
    chart.setOption({
      animation: false,
      tooltip: { trigger: "axis", formatter: (p: unknown) => {
        const ps = p as { name: string; value: number }[];
        return `${ps[0]?.name}<br/>${values[labels.indexOf(ps[0]?.name ?? "")]}${isPercent ? "%" : ""}`;
      }},
      grid: { left: 90, right: 16, top: 12, bottom: 8 },
      xAxis: { type: "value", axisLabel: { fontSize: 10, formatter: (v: number) => `${v}${isPercent ? "%" : ""}` } },
      yAxis: { type: "category", data: labels, axisLabel: { fontSize: 10, width: 80, overflow: "truncate" } },
      series: [{ type: "bar", data: values.map((v, i) => ({ value: v, itemStyle: { color: colors[i] } })), barMaxWidth: 20 }],
    });
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(ref.current);
    return () => { ro.disconnect(); chart.dispose(); };
  }, [results, metric]);
  return <div ref={ref} className="w-full" style={{ height: Math.max(240, results.length * 22) }} />;
}

function ComparePanel({ symbol, startDate, endDate, initCapital, mode }: {
  symbol: string; startDate: string; endDate: string; initCapital: string; mode: string;
}) {
  const [open, setOpen] = useState(false);
  const [metric, setMetric] = useState<"annualReturn" | "maxDrawdown" | "sharpe" | "winRate">("annualReturn");

  const { data, isFetching, refetch } = useQuery<{ results: CompareResult[] }>({
    queryKey: ["backtest-compare", symbol, startDate, endDate, initCapital, mode],
    queryFn: async () => {
      const qs = new URLSearchParams({ symbol, startDate, endDate, initCapital, mode });
      const r = await fetch(`/api/backtest/compare?${qs}`);
      return r.json();
    },
    enabled: false,
    staleTime: 5 * 60_000,
  });

  function handleOpen() {
    setOpen(true);
    if (!data) void refetch();
  }

  const METRICS = [
    { key: "annualReturn" as const, label: "年化收益" },
    { key: "maxDrawdown" as const, label: "最大回撤" },
    { key: "sharpe" as const, label: "夏普比率" },
    { key: "winRate" as const, label: "胜率" },
  ];

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        disabled={!symbol}
        className="flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-600 hover:bg-zinc-50 disabled:opacity-40"
      >
        <BarChart2 size={13} />
        策略对比
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="flex w-full max-w-3xl flex-col gap-4 rounded-2xl bg-white p-5 shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold text-zinc-900">策略横向对比</p>
                <p className="text-xs text-zinc-400">{symbol} · {startDate} ~ {endDate} · 默认参数</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="rounded-lg p-1.5 hover:bg-zinc-100">
                <X size={16} />
              </button>
            </div>

            <div className="flex gap-2 flex-wrap">
              {METRICS.map((m) => (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => setMetric(m.key)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${metric === m.key ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"}`}
                >
                  {m.label}
                </button>
              ))}
            </div>

            {isFetching && <div className="flex h-40 items-center justify-center text-sm text-zinc-400">计算中，请稍候...</div>}

            {data?.results && !isFetching && (
              <>
                <CompareChart results={data.results} metric={metric} />
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-zinc-100 text-zinc-400">
                        <th className="py-2 text-left font-medium">策略</th>
                        <th className="py-2 text-right font-medium">年化收益</th>
                        <th className="py-2 text-right font-medium">最大回撤</th>
                        <th className="py-2 text-right font-medium">夏普</th>
                        <th className="py-2 text-right font-medium">胜率</th>
                        <th className="py-2 text-right font-medium">交易次数</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...data.results]
                        .sort((a, b) => b.annualReturn - a.annualReturn)
                        .map((r, i) => (
                          <tr key={r.code} className={`border-b border-zinc-50 ${i === 0 ? "bg-rose-50" : ""}`}>
                            <td className="py-1.5 font-medium text-zinc-700">{r.label}</td>
                            <td className={`py-1.5 text-right font-semibold ${r.annualReturn >= 0 ? "text-rose-500" : "text-emerald-600"}`}>
                              {r.annualReturn >= 0 ? "+" : ""}{(r.annualReturn * 100).toFixed(2)}%
                            </td>
                            <td className="py-1.5 text-right text-emerald-600">-{(r.maxDrawdown * 100).toFixed(2)}%</td>
                            <td className="py-1.5 text-right text-zinc-700">{r.sharpe.toFixed(2)}</td>
                            <td className="py-1.5 text-right text-zinc-700">{(r.winRate * 100).toFixed(1)}%</td>
                            <td className="py-1.5 text-right text-zinc-500">{r.tradeCount}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function EquityChart({ data, trades }: {
  data: { date: string; value: number; benchmark: number }[];
  trades: { entryDate: string; exitDate: string; entryPrice: number; exitPrice: number; pnl: number; pnlPct: number }[];
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current || data.length === 0) return;
    const chart = echarts.init(ref.current);

    // 把 trades 映射到 equity curve 的日期索引上
    const dateIndex = new Map(data.map((d, i) => [d.date.slice(0, 10), i]));
    const buyPoints: [number, number, string][] = [];
    const sellPoints: [number, number, string][] = [];
    for (const t of trades) {
      if (!t.entryDate || !t.exitDate) continue;
      const ei = dateIndex.get(t.entryDate.slice(0, 10));
      const xi = dateIndex.get(t.exitDate.slice(0, 10));
      if (ei != null) buyPoints.push([ei, data[ei]!.value, `买入 ${t.entryDate.slice(0, 10)}\n价格 ${t.entryPrice.toFixed(3)}`]);
      if (xi != null) sellPoints.push([xi, data[xi]!.value,
        `卖出 ${t.exitDate.slice(0, 10)}\n价格 ${t.exitPrice.toFixed(3)}\n盈亏 ${t.pnl >= 0 ? "+" : ""}${t.pnl.toFixed(0)}元 (${(t.pnlPct * 100).toFixed(2)}%)`]);
    }

    chart.setOption({
      animation: false,
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "cross" },
        formatter: (params: unknown) => {
          const ps = params as { seriesName: string; value: number | [number, number, string]; axisValue: string }[];
          let html = `<div style="font-size:12px"><b>${ps[0]?.axisValue ?? ""}</b>`;
          for (const p of ps) {
            if (p.seriesName === "买入点" || p.seriesName === "卖出点") {
              const raw = Array.isArray(p.value) ? (p.value[2] as string) : "";
              html += `<br/><span style="color:${p.seriesName === "买入点" ? "#ef4444" : "#10b981"}">${raw.replace(/\n/g, "<br/>")}</span>`;
            } else {
              html += `<br/>${p.seriesName}: ${typeof p.value === "number" ? p.value.toLocaleString() : ""}`;
            }
          }
          return html + "</div>";
        },
      },
      legend: { data: ["策略资产", "基准收益", "买入点", "卖出点"], top: 4, textStyle: { fontSize: 11 } },
      grid: { left: 60, right: 16, top: 36, bottom: 24 },
      xAxis: { type: "category", data: data.map((d) => d.date), axisLabel: { fontSize: 10, color: "#a1a1aa" }, boundaryGap: false },
      yAxis: { scale: true, axisLabel: { fontSize: 10, color: "#a1a1aa" } },
      series: [
        { name: "策略资产", type: "line", data: data.map((d) => d.value), symbol: "none", itemStyle: { color: "#ef4444" }, lineStyle: { color: "#ef4444", width: 2 }, areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: "rgba(239,68,68,0.15)" }, { offset: 1, color: "rgba(239,68,68,0)" }]) } },
        { name: "基准收益", type: "line", data: data.map((d) => d.benchmark), symbol: "none", itemStyle: { color: "#94a3b8" }, lineStyle: { color: "#94a3b8", width: 1.5, type: "dashed" } },
        {
          name: "买入点", type: "scatter", symbol: "triangle", symbolSize: 10,
          itemStyle: { color: "#ef4444" },
          data: buyPoints,
          tooltip: { show: true },
        },
        {
          name: "卖出点", type: "scatter", symbol: "triangle", symbolSize: 10, symbolRotate: 180,
          itemStyle: { color: "#10b981" },
          data: sellPoints,
          tooltip: { show: true },
        },
      ],
    });
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(ref.current);
    return () => { ro.disconnect(); chart.dispose(); };
  }, [data, trades]);
  return <div ref={ref} className="w-full h-64" />;
}

function fmtMoney(v: number | null) {
  if (v == null) return "-";
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)} 元`;
}

type LiveSignal = {
  signal: "buy" | "sell" | "hold";
  inPosition: boolean;
  entryPrice: number | null;
  entryDate: string | null;
  currentPrice: number;
  unrealizedPnlPct: number | null;
  stopLoss: number | null;
};
type RecentTrade = { entryDate: string; exitDate: string; entryPrice: number; exitPrice: number; pnl: number; pnlPct: number };

function SignalPanel({ record }: { record: BacktestRecord }) {
  const params = JSON.parse(record.params) as Record<string, number>;
  const { data, isLoading } = useQuery({
    queryKey: ["backtest-signal", record.symbol, record.strategyCode, record.params],
    queryFn: async () => {
      const qs = new URLSearchParams({
        symbol: record.symbol,
        strategyCode: record.strategyCode,
        params: record.params,
        initCapital: String(record.initCapital),
        mode: record.mode,
      });
      const res = await fetch(`/api/backtest/signal?${qs}`);
      return res.json() as Promise<{ liveSignal: LiveSignal; recentTrades: RecentTrade[] }>;
    },
    staleTime: 5 * 60_000,
    enabled: record.status === "done",
  });

  const sig = data?.liveSignal;
  const trades = (data?.recentTrades ?? []).filter(t => t.entryDate && t.exitDate && t.entryPrice != null && t.exitPrice != null);

  const sigConfig = {
    buy:  { label: "买入信号", bg: "bg-rose-50", border: "border-rose-200", text: "text-rose-600", dot: "bg-rose-500" },
    sell: { label: "卖出信号", bg: "bg-emerald-50", border: "border-emerald-200", text: "text-emerald-600", dot: "bg-emerald-500" },
    hold: { label: "持有观望", bg: "bg-zinc-50", border: "border-zinc-200", text: "text-zinc-600", dot: "bg-zinc-400" },
  };
  const cfg = sigConfig[sig?.signal ?? "hold"];

  return (
    <div className="rounded-xl border border-zinc-100 bg-white p-4">
      <p className="text-sm font-semibold text-zinc-700 mb-4">实战信号 · 今日</p>

      {isLoading && <div className="text-sm text-zinc-400 py-4 text-center">计算中...</div>}

      {sig && (
        <div className="flex flex-col gap-4">
          {/* 当前信号 */}
          <div className={`flex items-center gap-3 rounded-xl border p-4 ${cfg.bg} ${cfg.border}`}>
            <span className={`h-3 w-3 rounded-full ${cfg.dot} shrink-0`} />
            <div className="flex-1">
              <p className={`text-base font-bold ${cfg.text}`}>{cfg.label}</p>
              <p className="text-xs text-zinc-500 mt-0.5">
                当前价 {sig.currentPrice.toFixed(3)}
                {sig.inPosition && sig.entryPrice && (
                  <> · 持仓成本 {sig.entryPrice.toFixed(3)}
                  {sig.unrealizedPnlPct != null && (
                    <span className={sig.unrealizedPnlPct >= 0 ? " text-rose-500" : " text-emerald-600"}>
                      {" "}({sig.unrealizedPnlPct >= 0 ? "+" : ""}{(sig.unrealizedPnlPct * 100).toFixed(2)}%)
                    </span>
                  )}</>
                )}
              </p>
            </div>
            {sig.inPosition && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">持仓中</span>
            )}
          </div>

          {/* 止损位 */}
          {sig.inPosition && sig.stopLoss && (
            <div className="flex items-center justify-between rounded-lg bg-zinc-50 px-4 py-2.5 text-sm">
              <span className="text-zinc-500">策略止损位</span>
              <span className="font-semibold text-rose-500">{sig.stopLoss.toFixed(3)}</span>
            </div>
          )}

          {/* 如何使用说明 */}
          <div className="rounded-xl bg-blue-50 border border-blue-100 p-3 text-xs text-blue-700 leading-relaxed">
            <p className="font-medium mb-1">如何使用这个信号？</p>
            {sig.signal === "buy" && <p>策略今日触发买入条件。结合回测胜率 {record.winRate != null ? `${(record.winRate * 100).toFixed(0)}%` : "-"} 和平均持有 {record.avgHoldDays?.toFixed(0) ?? "-"} 天，可考虑按策略建仓，止损设在 {sig.stopLoss?.toFixed(3) ?? "ATR×2"} 附近。</p>}
            {sig.signal === "sell" && <p>策略今日触发卖出条件。若你当前持有该票，可参考此信号考虑减仓或止盈。回测显示该策略平均盈利 {record.avgWin != null ? `${record.avgWin.toFixed(0)}元` : "-"}。</p>}
            {sig.signal === "hold" && sig.inPosition && <p>策略当前无新信号，持仓继续持有。注意止损位 {sig.stopLoss?.toFixed(3) ?? "-"}，跌破时策略会触发卖出。</p>}
            {sig.signal === "hold" && !sig.inPosition && <p>策略当前无买入信号，建议观望等待。该策略历史交易 {record.tradeCount ?? 0} 次，胜率 {record.winRate != null ? `${(record.winRate * 100).toFixed(0)}%` : "-"}，耐心等待信号出现。</p>}
          </div>

          {/* 最近交易记录 */}
          {trades.length > 0 && (
            <div>
              <p className="text-xs font-medium text-zinc-400 mb-2">最近交易记录</p>
              <div className="flex flex-col gap-1">
                {trades.map((t, i) => (
                  <div key={i} className="flex items-center justify-between rounded-lg bg-zinc-50 px-3 py-2 text-xs">
                    <div className="text-zinc-500">
                      <span>{t.entryDate.slice(0, 10)}</span>
                      <span className="mx-1 text-zinc-300">→</span>
                      <span>{t.exitDate.slice(0, 10)}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-zinc-400">{t.entryPrice.toFixed(3)} → {t.exitPrice.toFixed(3)}</span>
                      <span className={`font-semibold ${t.pnl >= 0 ? "text-rose-500" : "text-emerald-600"}`}>
                        {t.pnl >= 0 ? "+" : ""}{t.pnl.toFixed(0)}元
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ResultPanel({ record }: { record: BacktestRecord }) {
  const curve = record.equityCurve
    ? (JSON.parse(record.equityCurve) as { date: string; value: number; benchmark: number }[])
    : [];
  const trades = record.trades
    ? (JSON.parse(record.trades) as { entryDate: string; exitDate: string; entryPrice: number; exitPrice: number; pnl: number; pnlPct: number }[]).filter(t => t.entryDate && t.exitDate && t.entryPrice != null && t.exitPrice != null)
    : [];

  const pnlColor = (v: number | null, reverse = false) => {
    if (v == null) return "text-zinc-800";
    const pos = reverse ? v <= 0 : v >= 0;
    return pos ? "text-rose-500" : "text-emerald-600";
  };

  return (
    <div className="flex flex-col gap-5">
      {/* 顶部4格核心指标 */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "累计收益率", value: fmt(record.totalReturn, true), cls: pnlColor(record.totalReturn) },
          { label: "年化收益率", value: fmt(record.annualReturn, true), cls: pnlColor(record.annualReturn) },
          { label: "最大回撤", value: record.maxDrawdown != null ? `-${(record.maxDrawdown * 100).toFixed(2)}%` : "-", cls: "text-emerald-600" },
          { label: "交易次数", value: String(record.tradeCount ?? "-"), cls: "text-zinc-800" },
        ].map((item) => (
          <div key={item.label} className="rounded-xl bg-zinc-50 p-3 text-center">
            <p className="text-xs text-zinc-400 mb-1">{item.label}</p>
            <p className={`text-xl font-bold ${item.cls}`}>{item.value}</p>
          </div>
        ))}
      </div>

      {/* 权益曲线 */}
      {curve.length > 0 && (
        <div className="rounded-xl border border-zinc-100 bg-white p-3">
          <p className="text-xs text-zinc-500 mb-2">资产走势对比</p>
          <EquityChart data={curve} trades={trades} />
        </div>
      )}

      {/* 绩效指标两栏 */}
      <div className="rounded-xl border border-zinc-100 bg-white p-4">
        <p className="text-sm font-semibold text-zinc-700 mb-4">绩效指标</p>
        <div className="grid grid-cols-1 gap-0 sm:grid-cols-2 sm:divide-x divide-zinc-100">
          {/* 左：收益风险 */}
          <div className="flex flex-col gap-3 pr-0 sm:pr-6">
            <p className="text-xs font-medium text-zinc-400 uppercase tracking-wide">收益风险指标</p>
            {[
              { label: "总收益", value: fmtMoney(record.totalPnl), cls: pnlColor(record.totalPnl) },
              { label: "夏普比率", value: record.sharpe?.toFixed(2) ?? "-", cls: "text-zinc-800" },
              { label: "索提诺比率", value: record.sortino?.toFixed(2) ?? "-", cls: "text-zinc-800" },
              { label: "卡玛比率", value: record.calmar?.toFixed(2) ?? "-", cls: "text-zinc-800" },
              { label: "胜率", value: fmt(record.winRate, true), cls: pnlColor(record.winRate) },
            ].map((row) => (
              <div key={row.label} className="flex items-center justify-between text-sm">
                <span className="text-zinc-500">{row.label}</span>
                <span className={`font-semibold ${row.cls}`}>{row.value}</span>
              </div>
            ))}
          </div>
          {/* 右：交易统计 */}
          <div className="flex flex-col gap-3 pl-0 sm:pl-6 mt-4 sm:mt-0">
            <p className="text-xs font-medium text-zinc-400 uppercase tracking-wide">交易统计</p>
            {[
              { label: "平均持有天数", value: record.avgHoldDays != null ? `${record.avgHoldDays.toFixed(1)} 天` : "-", cls: "text-zinc-800" },
              { label: "平均盈利", value: fmtMoney(record.avgWin), cls: pnlColor(record.avgWin) },
              { label: "平均亏损", value: fmtMoney(record.avgLoss), cls: pnlColor(record.avgLoss, true) },
              { label: "盈亏比", value: record.profitFactor != null ? (record.profitFactor === Infinity ? "∞" : record.profitFactor.toFixed(2)) : "-", cls: "text-zinc-800" },
              { label: "初始资金", value: `¥${record.initCapital.toLocaleString()}`, cls: "text-zinc-800" },
            ].map((row) => (
              <div key={row.label} className="flex items-center justify-between text-sm">
                <span className="text-zinc-500">{row.label}</span>
                <span className={`font-semibold ${row.cls}`}>{row.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

const MODELS = [
  { id: "deepseek-chat", label: "DeepSeek" },
  { id: "qwen-plus", label: "通义千问" },
  { id: "glm-4-flash", label: "GLM-4 Flash" },
];

function BacktestAiModal({
  open, onClose, backtestContext, symbol,
}: {
  open: boolean;
  onClose: () => void;
  backtestContext: string;
  symbol: string;
}) {
  const [messages, setMessages] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [showCtx, setShowCtx] = useState(false);
  const [ctxText, setCtxText] = useState("");
  const [model, setModel] = useState(() =>
    typeof window !== "undefined" ? (localStorage.getItem("preferred-model") ?? "deepseek-chat") : "deepseek-chat"
  );
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const userScrolledUp = useRef(false);
  const ctxKey = `ctx:${symbol}`;

  // 每次打开时重置，重新触发自动分析（包含最新上下文）
  useEffect(() => {
    if (open) {
      setMessages([]);
      setCtxText(typeof window !== "undefined" ? (localStorage.getItem(ctxKey) ?? "") : "");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // 打开时自动发一条分析请求
  useEffect(() => {
    if (open && messages.length === 0 && backtestContext) {
      void sendMsg("基于以上策略的历史买卖点规律，结合当前价格和策略参数，预测一下：下一个买入触发条件是什么？下一个卖出触发条件是什么？价格到哪里我该买，到哪里我该卖，给我具体的价格区间和操作指令，不要泛泛而谈。");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, messages.length, backtestContext]);

  useEffect(() => {
    if (!open) return;
    const el = scrollRef.current;
    if (!el) return;
    const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (!userScrolledUp.current || isAtBottom) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  async function sendMsg(text: string) {
    if (!text.trim() || loading) return;
    const userMsg = { role: "user" as const, content: text };
    const next = [...messages, userMsg];
    setMessages([...next, { role: "assistant", content: "" }]);
    setInput("");
    userScrolledUp.current = false;
    setLoading(true);
    const abort = new AbortController();
    abortRef.current = abort;
    // 只在第一条消息时传完整回测上下文，后续追问只传对话历史节省 token
    const isFirstMsg = messages.length === 0;
    // 历史消息最多保留最近 10 条，避免 token 随对话线性增长
    const trimmedNext = next.slice(-10);
    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: abort.signal,
        body: JSON.stringify({
          messages: trimmedNext,
          model,
          context: isFirstMsg ? { code: "回测分析", backtestContext } : { code: "回测分析" },
        }),
      });
      if (!res.ok || !res.body) throw new Error("请求失败");
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (payload === "[DONE]") break;
          try {
            const parsed = JSON.parse(payload) as { text?: string };
            if (parsed.text) {
              setMessages(prev => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last?.role === "assistant") updated[updated.length - 1] = { ...last, content: last.content + parsed.text };
                return updated;
              });
            }
          } catch { /* ignore */ }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setMessages(prev => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last?.role === "assistant" && last.content === "") updated[updated.length - 1] = { ...last, content: "请求失败" };
          return updated;
        });
      }
    } finally {
      abortRef.current = null;
      setLoading(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center" onClick={onClose}>
      <div className="flex h-[85vh] w-full max-w-2xl flex-col rounded-2xl bg-white shadow-2xl sm:h-[680px]" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3">
          <div className="flex items-center gap-2">
            <Bot size={16} className="text-zinc-500" />
            <span className="font-semibold text-zinc-800 text-sm">AI 回测分析</span>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setShowCtx(v => !v)}
              className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition ${ctxText ? "border-blue-200 bg-blue-50 text-blue-600" : "border-zinc-200 text-zinc-500 hover:border-zinc-400"}`}>
              <FileText size={11} />
              {ctxText ? "背景已设置" : "投资背景"}
            </button>
            <select value={model} onChange={e => { setModel(e.target.value); localStorage.setItem("preferred-model", e.target.value); }}
              className="rounded-md border border-zinc-200 px-2 py-1 text-xs outline-none">
              {MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
            <button type="button" onClick={onClose} className="rounded-md p-1 text-zinc-400 hover:text-zinc-700"><X size={16} /></button>
          </div>
        </div>

        {/* 投资背景编辑区 */}
        {showCtx && (
          <div className="border-b border-zinc-100 bg-zinc-50 px-4 py-3">
            <p className="text-xs text-zinc-500 mb-2">告诉 AI 你的投资背景，分析时会结合这些信息</p>
            <textarea value={ctxText} onChange={e => setCtxText(e.target.value)} rows={3}
              placeholder={"例如：我计划持有1年，每月定投1万，目标攒够买车首付20万，最多接受10%亏损"}
              className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-xs outline-none focus:border-zinc-400 resize-none mb-2" />
            <div className="flex gap-2">
              <button type="button" onClick={() => {
                if (ctxText.trim()) localStorage.setItem(ctxKey, ctxText.trim());
                else localStorage.removeItem(ctxKey);
                setShowCtx(false);
                // 重新触发分析
                setMessages([]);
              }} className="rounded-lg bg-zinc-900 px-3 py-1.5 text-xs text-white hover:bg-zinc-700">
                保存并重新分析
              </button>
              <button type="button" onClick={() => { localStorage.removeItem(ctxKey); setCtxText(""); setShowCtx(false); }}
                className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs text-zinc-500 hover:bg-zinc-100">
                清除
              </button>
            </div>
          </div>
        )}

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3"
          onScroll={() => {
            const el = scrollRef.current;
            if (!el) return;
            userScrolledUp.current = el.scrollHeight - el.scrollTop - el.clientHeight >= 80;
          }}>
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              {m.role === "user" ? (
                <div className="max-w-[85%] rounded-2xl bg-zinc-900 px-3 py-2 text-sm text-white">{m.content}</div>
              ) : (
                <div className="max-w-[90%] rounded-2xl bg-zinc-100 px-4 py-3 text-sm text-zinc-800">
                  {m.content === "" && loading ? <span className="text-zinc-400">思考中...</span> : (
                    <ReactMarkdown components={{
                      p: ({ children }) => <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>,
                      strong: ({ children }) => <strong className="font-semibold text-zinc-900">{children}</strong>,
                      ul: ({ children }) => <ul className="mb-2 ml-4 list-disc space-y-1">{children}</ul>,
                      ol: ({ children }) => <ol className="mb-2 ml-4 list-decimal space-y-1">{children}</ol>,
                      li: ({ children }) => <li className="leading-relaxed">{children}</li>,
                      code: ({ children }) => <code className="rounded bg-zinc-200 px-1 py-0.5 text-xs font-mono">{children}</code>,
                    }}>{m.content}</ReactMarkdown>
                  )}
                </div>
              )}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        <p className="px-4 py-1.5 text-center text-xs text-zinc-400">AI 仅供参考，不构成投资建议</p>

        <div className="flex gap-2 border-t border-zinc-100 px-4 py-3">
          <input value={input} onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && !e.shiftKey && void sendMsg(input)}
            placeholder="继续追问..."
            className="flex-1 rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400" />
          {loading ? (
            <button type="button" onClick={() => abortRef.current?.abort()}
              className="rounded-lg bg-zinc-200 px-3 py-2 text-zinc-700 hover:bg-zinc-300">
              <Square size={16} />
            </button>
          ) : (
            <button type="button" onClick={() => void sendMsg(input)} disabled={!input.trim()}
              className="rounded-lg bg-zinc-900 px-3 py-2 text-white hover:bg-zinc-700 disabled:opacity-40">
              <Send size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function BacktestPage() {
  const qc = useQueryClient();
  const today = new Date().toISOString().slice(0, 10);
  const oneYearAgo = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);

  const [symbol, setSymbol] = useState("");
  const [symbolFocus, setSymbolFocus] = useState(false);
  const [strategyCode, setStrategyCode] = useState("ma_cross");
  const [startDate, setStartDate] = useState(oneYearAgo);
  const [endDate, setEndDate] = useState(today);
  const [initCapital, setInitCapital] = useState("100000");
  const [mode, setMode] = useState<"simple" | "compound">("compound");
  const [params, setParams] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [aiOpen, setAiOpen] = useState(false);

  const strategy = STRATEGY_DEFS.find((s) => s.code === strategyCode) ?? STRATEGY_DEFS[0]!;

  // 切换策略时重置参数
  useEffect(() => {
    const defaults: Record<string, string> = {};
    strategy.params.forEach((p) => { defaults[p.key] = String(p.default); });
    setParams(defaults);
  }, [strategyCode]);

  function applyPreset(months: number) {
    const end = new Date();
    const start = new Date();
    start.setMonth(start.getMonth() - months);
    setStartDate(start.toISOString().slice(0, 10));
    setEndDate(end.toISOString().slice(0, 10));
  }

  const { data: list = [], isLoading } = useQuery<BacktestRecord[]>({
    queryKey: ["backtests"],
    queryFn: async () => { const r = await fetch("/api/backtest"); return r.json(); },
    refetchInterval: (query) => {
      const data = query.state.data as BacktestRecord[] | undefined;
      return data?.some((r) => r.status === "pending" || r.status === "running") ? 2000 : false;
    },
  });

  const { data: watchlist = [] } = useQuery<{ code: string; name: string }[]>({
    queryKey: ["watchlist"],
    queryFn: async () => { const r = await fetch("/api/watchlist"); return r.json(); },
  });

  const watchlistFiltered = (Array.isArray(watchlist) ? watchlist : []).filter(w => {
    if (!symbol.trim()) return true;
    const q = symbol.trim().toLowerCase();
    return (w.code ?? "").toLowerCase().includes(q) || (w.name ?? "").toLowerCase().includes(q);
  });

  const selected = list.find((r) => r.id === selectedId) ?? list[0] ?? null;

  // 获取当前实时价格，供 AI context 使用
  const { data: signalData } = useQuery({
    queryKey: ["backtest-signal", selected?.symbol, selected?.strategyCode, selected?.params],
    queryFn: async () => {
      const qs = new URLSearchParams({
        symbol: selected!.symbol,
        strategyCode: selected!.strategyCode,
        params: selected!.params,
        initCapital: String(selected!.initCapital),
        mode: selected!.mode,
      });
      const res = await fetch(`/api/backtest/signal?${qs}`);
      return res.json() as Promise<{ liveSignal: { signal: string; inPosition: boolean; currentPrice: number; entryPrice: number | null; stopLoss: number | null }; recentTrades: unknown[] }>;
    },
    staleTime: 5 * 60_000,
    enabled: !!selected && selected.status === "done",
  });

  // 切换查看历史记录时，回填左侧输入框
  useEffect(() => {
    if (!selected) return;
    setSymbol(selected.symbol);
    setStrategyCode(selected.strategyCode);
    setStartDate(selected.startDate);
    setEndDate(selected.endDate);
    setInitCapital(String(selected.initCapital));
    setMode(selected.mode as "simple" | "compound");
    const p: Record<string, string> = {};
    try { Object.entries(JSON.parse(selected.params) as Record<string, number>).forEach(([k, v]) => { p[k] = String(v); }); } catch { /* ignore */ }
    setParams(p);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id]);

  async function handleSubmit() {
    if (!symbol.trim()) return;
    setSubmitting(true);
    const numParams: Record<string, number> = { atrPeriod: 14, atrMult: 2 };
    Object.entries(params).forEach(([k, v]) => { numParams[k] = Number(v); });

    // 查股票名称
    let stockName = symbol.trim();
    try {
      // 先用 quotes 接口查名称（支持A股+美股+ETF）
      const qr = await fetch(`/api/market/quotes?symbols=${encodeURIComponent(symbol.trim())}`);
      const qd = await qr.json() as Record<string, { name?: string }>;
      const qname = qd[symbol.trim().toUpperCase()]?.name;
      if (qname) {
        stockName = qname;
      } else {
        // fallback: suggest接口
        const r = await fetch(`/api/market/suggest?key=${encodeURIComponent(symbol.trim())}`);
        const t = await r.text();
        const m = t.match(/"([^"]+)"/);
        if (m) {
          const parts = m[1].split(",");
          if (parts[4]) stockName = parts[4];
        }
      }
    } catch { /* ignore */ }

    const res = await fetch("/api/backtest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: `${stockName}`, symbol: symbol.trim(), strategyCode, params: numParams, startDate, endDate, initCapital: Number(initCapital), mode }),
    });
    const record = await res.json() as BacktestRecord;
    setSubmitting(false);
    void qc.invalidateQueries({ queryKey: ["backtests"] });
    setSelectedId(record.id);
  }

  async function handleDelete(id: number) {
    await fetch(`/api/backtest/${id}`, { method: "DELETE" });
    void qc.invalidateQueries({ queryKey: ["backtests"] });
    if (selectedId === id) setSelectedId(null);
  }

  const backtestContext = selected && selected.status === "done" ? (() => {
    const trades = selected.trades ? (JSON.parse(selected.trades) as { entryDate: string; exitDate: string; entryPrice: number; exitPrice: number; pnl: number; pnlPct: number }[]) : [];
    const recentTrades = trades.slice(-5);
    const strategyDef = STRATEGY_DEFS.find(s => s.code === selected.strategyCode);
    const parsedParams = JSON.parse(selected.params) as Record<string, number>;
    const paramStr = strategyDef?.params.map(p => `${p.label}=${parsedParams[p.key] ?? p.default}`).join(", ") ?? selected.params;
    const sig = signalData?.liveSignal;
    const userCtx = typeof window !== "undefined" ? (localStorage.getItem(`ctx:${selected.symbol}`) ?? localStorage.getItem("ctx:global") ?? "") : "";

    return `${userCtx ? `【用户投资背景】\n${userCtx}\n\n` : ""}【股票】${selected.name || selected.symbol}（${selected.symbol}）
【策略】${strategyDef?.label ?? selected.strategyCode}
【策略参数】${paramStr}
【回测周期】${selected.startDate} ~ ${selected.endDate}
【回测模式】${selected.mode === "compound" ? "复利" : "单利"}，初始资金 ¥${selected.initCapital.toLocaleString()}

【当前实时数据】
当前价格：${sig ? sig.currentPrice.toFixed(3) : "获取中"}
当前信号：${sig ? (sig.signal === "buy" ? "买入信号" : sig.signal === "sell" ? "卖出信号" : "持有观望") : "-"}
是否持仓：${sig ? (sig.inPosition ? `是，成本价 ${sig.entryPrice?.toFixed(3) ?? "-"}` : "否") : "-"}
策略止损位：${sig?.stopLoss ? sig.stopLoss.toFixed(3) : "-"}

【回测绩效】
累计收益率：${fmt(selected.totalReturn, true)}，年化：${fmt(selected.annualReturn, true)}
最大回撤：${selected.maxDrawdown != null ? `-${(selected.maxDrawdown * 100).toFixed(2)}%` : "-"}
胜率：${fmt(selected.winRate, true)}，盈亏比：${selected.profitFactor != null ? (selected.profitFactor === Infinity ? "∞" : selected.profitFactor.toFixed(2)) : "-"}
夏普：${selected.sharpe?.toFixed(2) ?? "-"}，平均持有：${selected.avgHoldDays?.toFixed(1) ?? "-"}天
共交易 ${selected.tradeCount ?? 0} 次，平均盈利 ${selected.avgWin?.toFixed(0) ?? "-"}元，平均亏损 ${selected.avgLoss?.toFixed(0) ?? "-"}元

【最近 ${recentTrades.length} 笔交易】
${recentTrades.map((t, i) => `${i + 1}. 买入 ${t.entryDate.slice(0, 10)} @ ${t.entryPrice.toFixed(3)}，卖出 ${t.exitDate.slice(0, 10)} @ ${t.exitPrice.toFixed(3)}，盈亏 ${t.pnl >= 0 ? "+" : ""}${t.pnl.toFixed(0)}元（${(t.pnlPct * 100).toFixed(2)}%）`).join("\n") || "暂无交易记录"}`.trim();
  })() : "";

  return (
    <div className="min-h-screen bg-zinc-50">
      <div className="mx-auto max-w-7xl px-4 py-6">
        <div className="mb-6 flex items-center gap-3">
          <Link href="/" className="rounded-lg border border-zinc-200 p-1.5 text-zinc-500 hover:bg-zinc-100">
            <ArrowLeft size={16} />
          </Link>
          <div>
            <h1 className="text-xl font-bold text-zinc-900">回测广场</h1>
            <p className="text-xs text-zinc-400">基于历史数据验证交易策略</p>
          </div>
        </div>

        <div className="flex flex-col gap-6 md:flex-row">
        {/* 左侧配置面板 */}
        <div className="w-full md:w-72 shrink-0 flex flex-col gap-4">
          {/* 股票 */}
          <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
            <p className="mb-2 text-sm font-medium text-zinc-700">股票代码/名称</p>
            <div className="relative">
              <input value={symbol} onChange={(e) => setSymbol(e.target.value)}
                onFocus={() => setSymbolFocus(true)}
                onBlur={() => setTimeout(() => setSymbolFocus(false), 150)}
                placeholder="例如：600519 或 贵州茅台"
                className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400" />
              {symbolFocus && watchlistFiltered.length > 0 && (
                <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-48 overflow-y-auto rounded-xl border border-zinc-200 bg-white shadow-lg">
                  {watchlistFiltered.map(w => (
                    <button key={w.code} type="button"
                      onMouseDown={() => { setSymbol(w.code); setSymbolFocus(false); }}
                      className="flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-zinc-50">
                      <span className="font-medium text-zinc-800">{w.name}</span>
                      <span className="text-xs text-zinc-400">{w.code}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* 周期 */}
          <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
            <p className="mb-2 text-sm font-medium text-zinc-700">周期选择</p>
            <div className="flex flex-wrap gap-1.5 mb-3">
              {PRESETS.map((p) => (
                <button key={p.label} type="button" onClick={() => applyPreset(p.months)}
                  className="rounded-md border border-zinc-200 px-2.5 py-1 text-xs text-zinc-600 hover:border-zinc-400 hover:text-zinc-800">
                  {p.label}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                <p className="text-xs text-zinc-400 mb-1">开始日期</p>
                <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
                  className="w-full rounded-lg border border-zinc-200 px-2 py-1.5 text-xs outline-none focus:border-zinc-400" />
              </div>
              <div className="flex-1">
                <p className="text-xs text-zinc-400 mb-1">结束日期</p>
                <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
                  className="w-full rounded-lg border border-zinc-200 px-2 py-1.5 text-xs outline-none focus:border-zinc-400" />
              </div>
            </div>
          </div>

          {/* 策略 */}
          <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
            <p className="mb-2 text-sm font-medium text-zinc-700">策略编辑</p>
            <p className="text-xs text-zinc-400 mb-1.5">选择策略</p>
            <select value={strategyCode} onChange={(e) => setStrategyCode(e.target.value)}
              className="w-full rounded-lg border border-zinc-200 px-2 py-1.5 text-sm outline-none focus:border-zinc-400 mb-1">
              {STRATEGY_DEFS.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
            </select>
            {strategy.desc && <p className="mb-3 text-xs text-zinc-400 leading-relaxed">{strategy.desc}</p>}
            <p className="text-xs text-zinc-400 mb-2">策略参数</p>
            <div className="flex flex-col gap-2">
              {strategy.params.map((p) => (
                <div key={p.key}>
                  <p className="text-xs text-zinc-500 mb-0.5">{p.label}</p>
                  <input type="number" value={params[p.key] ?? p.default}
                    onChange={(e) => setParams((prev) => ({ ...prev, [p.key]: e.target.value }))}
                    className="w-full rounded-lg border border-zinc-200 px-2 py-1.5 text-sm outline-none focus:border-zinc-400" />
                </div>
              ))}
            </div>
            <p className="text-xs text-zinc-400 mt-3 mb-1.5">初始资金（元）</p>
            <input type="number" value={initCapital} onChange={(e) => setInitCapital(e.target.value)}
              className="w-full rounded-lg border border-zinc-200 px-2 py-1.5 text-sm outline-none focus:border-zinc-400 mb-3" />
            <p className="text-xs text-zinc-400 mb-1.5">回测模式</p>
            <div className="flex flex-col gap-2">
              {(["simple", "compound"] as const).map((m) => (
                <label key={m} className={`flex cursor-pointer gap-2 rounded-xl border p-3 text-sm transition ${mode === m ? "border-zinc-900 bg-zinc-50" : "border-zinc-200"}`}>
                  <input type="radio" name="mode" value={m} checked={mode === m} onChange={() => setMode(m)} className="mt-0.5" />
                  <div>
                    <p className="font-medium text-zinc-800">{m === "simple" ? "单利模式" : "复利模式"}</p>
                    <p className="text-xs text-zinc-400 mt-0.5">{m === "simple" ? "固定仓位，每次交易使用相同资金" : "动态仓位，收益再投入，复利增长"}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div className="flex gap-2">
            <button type="button" onClick={() => void handleSubmit()} disabled={submitting || !symbol.trim()}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-zinc-900 py-3 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-40">
              <Play size={15} />
              {submitting ? "提交中..." : "执行回测"}
            </button>
            <ComparePanel symbol={symbol.trim()} startDate={startDate} endDate={endDate} initCapital={initCapital} mode={mode} />
          </div>
        </div>

        {/* 右侧结果 */}
        <div className="flex-1 min-w-0 flex flex-col gap-4">
          {/* 结果详情 */}
          {selected && (
            <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <p className="text-sm font-semibold text-zinc-800">回测结果</p>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${selected.status === "done" ? "bg-emerald-100 text-emerald-700" : selected.status === "error" ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-700"}`}>
                  {selected.status === "done" ? `回测完成 · ${selected.name || selected.symbol}${selected.name && selected.name !== selected.symbol ? ` (${selected.symbol})` : ""}` : selected.status === "error" ? "回测失败" : "回测中..."}
                </span>
              </div>

              {selected.status === "running" || selected.status === "pending" ? (
                <div className="flex items-center justify-center h-32 text-sm text-zinc-400">计算中，请稍候...</div>
              ) : selected.status === "error" ? (
                <div className="rounded-xl bg-rose-50 p-4 text-sm text-rose-600">{selected.errorMsg}</div>
              ) : (
                <>
                  <ResultPanel record={selected} />
                  <SignalPanel record={selected} />
                </>
              )}
            </div>
          )}

          {!selected && !isLoading && (
            <div className="flex flex-1 items-center justify-center rounded-2xl border border-dashed border-zinc-200 bg-white p-12 text-sm text-zinc-400">
              配置左侧参数后点击「执行回测」
            </div>
          )}
        </div>
      </div>
    </div>

      {/* 悬浮 AI 按钮 */}
      {selected && selected.status === "done" && (
        <button
          type="button"
          onClick={() => setAiOpen(true)}
          className="fixed top-6 right-6 z-40 flex items-center gap-2 rounded-full bg-zinc-900 px-4 py-2 text-sm text-white shadow-lg hover:bg-zinc-700"
        >
          <Bot size={15} />
          AI 分析
        </button>
      )}

      <BacktestAiModal open={aiOpen} onClose={() => setAiOpen(false)} backtestContext={backtestContext} symbol={selected?.symbol ?? ""} />
    </div>
  );
}

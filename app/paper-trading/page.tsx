"use client";

import { STRATEGY_DEFS } from "@/lib/backtest-engine";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as echarts from "echarts";
import { ArrowLeft, Plus, TrendingDown, TrendingUp, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type PaperTrade = {
  id: number;
  symbol: string;
  name: string;
  strategyCode: string;
  initCapital: number;
  startDate: string;
  currentValue: number | null;
  totalPnl: number | null;
  totalReturn: number | null;
  inPosition: boolean;
  entryPrice: number | null;
  tradeCount: number;
  trades: string;
  status: string;
  createdAt: string;
};

type DetailData = PaperTrade & {
  equityCurve?: { date: string; value: number; benchmark: number }[];
};

type Trade = { entryDate: string; exitDate: string; entryPrice: number; exitPrice: number; pnl: number; pnlPct: number };

function fmt(v: number | null | undefined, pct = false) {
  if (v == null) return "-";
  const s = pct ? `${(v * 100).toFixed(2)}%` : v.toFixed(2);
  return (v >= 0 ? "+" : "") + s;
}

// ── 权益曲线图（含买卖点）────────────────────────────────────
function EquityChart({
  data,
  trades,
}: {
  data: { date: string; value: number; benchmark: number }[];
  trades: Trade[];
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current || data.length === 0) return;
    const chart = echarts.init(ref.current);
    const dateIndex = new Map(data.map((d, i) => [d.date.slice(0, 10), i]));
    const buyPoints: [number, number, string][] = [];
    const sellPoints: [number, number, string][] = [];
    for (const t of trades) {
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
        { name: "买入点", type: "scatter", symbol: "triangle", symbolSize: 10, itemStyle: { color: "#ef4444" }, data: buyPoints },
        { name: "卖出点", type: "scatter", symbol: "triangle", symbolSize: 10, symbolRotate: 180, itemStyle: { color: "#10b981" }, data: sellPoints },
      ],
    });
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(ref.current);
    return () => { ro.disconnect(); chart.dispose(); };
  }, [data, trades]);
  return <div ref={ref} className="w-full h-56" />;
}

// ── 新建弹窗 ──────────────────────────────────────────────────
function NewTradeModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [symbol, setSymbol] = useState("");
  const [strategyCode, setStrategyCode] = useState(STRATEGY_DEFS[0]!.code);
  const [capital, setCapital] = useState("10000");
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 3);
    return d.toISOString().slice(0, 10);
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleCreate() {
    if (!symbol.trim()) { setError("请输入股票代码"); return; }
    const cap = parseFloat(capital);
    if (!cap || cap <= 0) { setError("请输入有效金额"); return; }
    setLoading(true); setError("");
    try {
      let name = "";
      try {
        const sr = await fetch(`/api/market/suggest?key=${encodeURIComponent(symbol.trim())}`);
        const st = await sr.text();
        const sm = st.match(/"([^"]+)"/);
        if (sm) { const parts = sm[1].split(","); name = parts[4] ?? ""; }
      } catch { /* ignore */ }
      const res = await fetch("/api/paper-trading", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol: symbol.trim().toUpperCase(), name, strategyCode, initCapital: cap, startDate }),
      });
      if (!res.ok) throw new Error("创建失败");
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "创建失败");
    } finally { setLoading(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3">
          <span className="font-semibold text-zinc-800">新建模拟交易</span>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-zinc-400 hover:text-zinc-700"><X size={18} /></button>
        </div>
        <div className="flex flex-col gap-4 p-4">
          <div>
            <label className="mb-1 block text-xs text-zinc-500">股票代码</label>
            <input value={symbol} onChange={e => setSymbol(e.target.value)} placeholder="如 511130、AAPL"
              className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-zinc-500">交易策略</label>
            <select value={strategyCode} onChange={e => setStrategyCode(e.target.value)}
              className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400">
              {STRATEGY_DEFS.map(s => <option key={s.code} value={s.code}>{s.label}</option>)}
            </select>
            <p className="mt-1 text-xs text-zinc-400">
              {STRATEGY_DEFS.find(s => s.code === strategyCode)?.params.map(p => `${p.label} ${p.default}`).join(" · ")}
            </p>
          </div>
          <div>
            <label className="mb-1 block text-xs text-zinc-500">买入金额（元）</label>
            <input type="number" value={capital} onChange={e => setCapital(e.target.value)}
              className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-zinc-500">开始日期</label>
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
              className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400" />
          </div>
          {error && <p className="text-sm text-rose-600">{error}</p>}
          <button type="button" onClick={() => void handleCreate()} disabled={loading}
            className="rounded-lg bg-zinc-900 py-2.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50">
            {loading ? "创建中..." : "开始模拟"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 详情弹窗 ──────────────────────────────────────────────────
function DetailModal({ trade, onClose }: { trade: PaperTrade; onClose: () => void }) {
  const strategyDef = STRATEGY_DEFS.find(s => s.code === trade.strategyCode);
  const [resolvedName, setResolvedName] = useState(trade.name || "");

  // 如果 name 为空，查新浪 suggest 补全
  useEffect(() => {
    if (resolvedName) return;
    fetch(`/api/market/suggest?key=${encodeURIComponent(trade.symbol)}`)
      .then(r => r.text())
      .then(t => {
        const m = t.match(/"([^"]+)"/);
        if (m) { const parts = m[1].split(","); setResolvedName(parts[4] ?? trade.symbol); }
      })
      .catch(() => setResolvedName(trade.symbol));
  }, [trade.symbol, resolvedName]);

  // 可编辑参数，初始值用策略默认值
  const [customParams, setCustomParams] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    strategyDef?.params.forEach(p => { init[p.key] = String(p.default); });
    return init;
  });

  // 构建 query string
  const paramQuery = strategyDef?.params
    .map(p => `${p.key}=${customParams[p.key] ?? p.default}`)
    .join("&") ?? "";

  const { data: detail, isLoading, refetch } = useQuery({
    queryKey: ["paper-trade-detail", trade.id, paramQuery],
    queryFn: async () => {
      const res = await fetch(`/api/paper-trading/${trade.id}?${paramQuery}`);
      return res.json() as Promise<DetailData>;
    },
    refetchInterval: 60_000,
  });

  const d = detail ?? trade;
  const trades: Trade[] = d.trades ? (JSON.parse(d.trades) as Trade[]) : [];
  const equityCurve = detail?.equityCurve ?? [];
  const pnl = d.totalPnl ?? 0;
  const ret = d.totalReturn ?? 0;

  function handleParamChange(key: string, val: string) {
    setCustomParams(prev => ({ ...prev, [key]: val }));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="flex h-[90vh] w-full max-w-2xl flex-col rounded-2xl bg-white shadow-2xl" onClick={e => e.stopPropagation()}>
        {/* 标题 */}
        <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3">
          <div>
            <span className="text-lg font-bold text-zinc-900">{resolvedName || d.symbol}</span>
            <span className="ml-2 text-sm text-zinc-400">{d.symbol}</span>
            <span className="ml-2 text-xs text-zinc-400">{strategyDef?.label}</span>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-zinc-400 hover:text-zinc-700"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* 权益曲线图 */}
          <div className="border-b border-zinc-100 px-4 pt-3 pb-1">
            {isLoading ? (
              <div className="flex h-56 items-center justify-center text-sm text-zinc-400">加载图表中...</div>
            ) : equityCurve.length > 0 ? (
              <EquityChart data={equityCurve} trades={trades} />
            ) : (
              <div className="flex h-56 items-center justify-center text-sm text-zinc-400">暂无图表数据</div>
            )}
          </div>

          <div className="space-y-4 p-4">
            {/* 盈亏概览 */}
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-xl bg-zinc-50 p-3 text-center">
                <p className="text-xs text-zinc-400 mb-1">初始资金</p>
                <p className="font-semibold text-zinc-800">¥{d.initCapital.toLocaleString()}</p>
              </div>
              <div className="rounded-xl bg-zinc-50 p-3 text-center">
                <p className="text-xs text-zinc-400 mb-1">当前市值</p>
                <p className="font-semibold text-zinc-800">¥{(d.currentValue ?? d.initCapital).toFixed(2)}</p>
              </div>
              <div className={`rounded-xl p-3 text-center ${pnl >= 0 ? "bg-emerald-50" : "bg-rose-50"}`}>
                <p className="text-xs text-zinc-400 mb-1">总盈亏</p>
                <p className={`font-semibold ${pnl >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                  {fmt(pnl)} ({fmt(ret, true)})
                </p>
              </div>
            </div>

            {/* 当前状态 */}
            <div className="rounded-xl border border-zinc-100 p-3">
              <p className="text-xs font-medium text-zinc-500 mb-2">当前状态</p>
              <div className="flex items-center gap-3 flex-wrap">
                <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${d.inPosition ? "bg-emerald-100 text-emerald-700" : "bg-zinc-100 text-zinc-600"}`}>
                  {d.inPosition ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
                  {d.inPosition ? "持仓中" : "空仓"}
                </span>
                {d.inPosition && d.entryPrice && (
                  <span className="text-xs text-zinc-500">成本价 ¥{d.entryPrice.toFixed(3)}</span>
                )}
                <span className="text-xs text-zinc-400">共交易 {d.tradeCount} 次</span>
                <span className="text-xs text-zinc-400">开始 {d.startDate}</span>
              </div>
            </div>

            {/* 策略参数（可编辑） */}
            {strategyDef && (
              <div className="rounded-xl border border-zinc-100 p-3">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-medium text-zinc-500">策略参数（可调整）</p>
                  <button type="button" onClick={() => void refetch()}
                    className="text-xs text-zinc-400 hover:text-zinc-700 underline">重新计算</button>
                </div>
                <div className="flex flex-wrap gap-3">
                  {strategyDef.params.map(p => (
                    <div key={p.key} className="flex items-center gap-1.5">
                      <span className="text-xs text-zinc-500">{p.label}</span>
                      <input
                        type="number"
                        value={customParams[p.key] ?? p.default}
                        onChange={e => handleParamChange(p.key, e.target.value)}
                        className="w-16 rounded-md border border-zinc-200 px-2 py-1 text-xs text-center outline-none focus:border-zinc-400"
                      />
                    </div>
                  ))}
                </div>
                <p className="mt-1.5 text-xs text-zinc-400">修改参数后点击"重新计算"更新图表</p>
              </div>
            )}

            {/* 交易记录 */}
            <div>
              <p className="text-xs font-medium text-zinc-500 mb-2">交易记录（{trades.length} 笔）</p>
              {trades.length === 0 ? (
                <p className="text-sm text-zinc-400 text-center py-4">暂无已完成交易</p>
              ) : (
                <div className="rounded-xl border border-zinc-100 overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-zinc-100 text-zinc-400">
                        <th className="px-3 py-2 text-left">买入日期</th>
                        <th className="px-3 py-2 text-left">卖出日期</th>
                        <th className="px-3 py-2 text-right">买入价</th>
                        <th className="px-3 py-2 text-right">卖出价</th>
                        <th className="px-3 py-2 text-right">盈亏</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...trades].reverse().map((t, i) => (
                        <tr key={i} className="border-b border-zinc-50 last:border-0">
                          <td className="px-3 py-2 text-zinc-600">{t.entryDate.slice(0, 10)}</td>
                          <td className="px-3 py-2 text-zinc-600">{t.exitDate.slice(0, 10)}</td>
                          <td className="px-3 py-2 text-right text-zinc-700">{t.entryPrice.toFixed(3)}</td>
                          <td className="px-3 py-2 text-right text-zinc-700">{t.exitPrice.toFixed(3)}</td>
                          <td className={`px-3 py-2 text-right font-medium ${t.pnl >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                            {t.pnl >= 0 ? "+" : ""}{t.pnl.toFixed(0)}
                            <span className="ml-1 opacity-70">({(t.pnlPct * 100).toFixed(1)}%)</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── 主页面 ────────────────────────────────────────────────────
export default function PaperTradingPage() {
  const queryClient = useQueryClient();
  const [showNew, setShowNew] = useState(false);
  const [selected, setSelected] = useState<PaperTrade | null>(null);
  const [nameMap, setNameMap] = useState<Record<string, string>>({});

  const { data: trades = [], isLoading } = useQuery({
    queryKey: ["paper-trades"],
    queryFn: async () => {
      const res = await fetch("/api/paper-trading");
      const list = await res.json() as PaperTrade[];
      // 并发刷新每个 trade 的最新状态
      const refreshed = await Promise.all(
        list.map(async (t) => {
          try {
            const r = await fetch(`/api/paper-trading/${t.id}`);
            if (r.ok) return await r.json() as PaperTrade;
          } catch { /* ignore */ }
          return t;
        })
      );
      return refreshed;
    },
  });

  // 对 name 为空的 trade 批量补全名称
  useEffect(() => {
    const missing = trades.filter(t => !t.name && !nameMap[t.symbol]);
    if (missing.length === 0) return;
    missing.forEach(t => {
      fetch(`/api/market/suggest?key=${encodeURIComponent(t.symbol)}`)
        .then(r => r.text())
        .then(text => {
          const m = text.match(/"([^"]+)"/);
          if (m) { const parts = m[1].split(","); const n = parts[4] ?? ""; if (n) setNameMap(prev => ({ ...prev, [t.symbol]: n })); }
        })
        .catch(() => {});
    });
  }, [trades, nameMap]);

  async function handleDelete(id: number, e: React.MouseEvent) {
    e.stopPropagation();
    await fetch(`/api/paper-trading/${id}`, { method: "DELETE" });
    void queryClient.invalidateQueries({ queryKey: ["paper-trades"] });
  }

  return (
    <div className="min-h-screen bg-zinc-50">
      <div className="mx-auto max-w-4xl px-4 py-6">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="rounded-lg border border-zinc-200 p-1.5 text-zinc-500 hover:bg-zinc-100">
              <ArrowLeft size={16} />
            </Link>
            <div>
              <h1 className="text-xl font-bold text-zinc-900">模拟交易</h1>
              <p className="text-xs text-zinc-400">策略实盘模拟，不涉及真实资金</p>
            </div>
          </div>
          <button type="button" onClick={() => setShowNew(true)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700">
            <Plus size={15} />
            新建模拟
          </button>
        </div>

        {isLoading && <p className="text-center text-sm text-zinc-400 py-12">加载中...</p>}

        {!isLoading && trades.length === 0 && (
          <div className="flex flex-col items-center gap-3 py-20 text-zinc-400">
            <p className="text-sm">还没有模拟交易</p>
            <button type="button" onClick={() => setShowNew(true)}
              className="rounded-lg border border-zinc-200 px-4 py-2 text-sm hover:bg-zinc-50">
              新建第一个
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {trades.map(trade => {
            const pnl = trade.totalPnl ?? 0;
            const ret = trade.totalReturn ?? 0;
            const strategyDef = STRATEGY_DEFS.find(s => s.code === trade.strategyCode);
            return (
              <div key={trade.id} onClick={() => setSelected(trade)}
                className="cursor-pointer rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm hover:border-zinc-300 hover:shadow-md transition">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <p className="font-semibold text-zinc-800">{trade.name || nameMap[trade.symbol] || trade.symbol}</p>
                    <p className="text-xs text-zinc-400">{trade.symbol} · {strategyDef?.label ?? trade.strategyCode}</p>
                  </div>
                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${trade.inPosition ? "bg-emerald-100 text-emerald-700" : "bg-zinc-100 text-zinc-500"}`}>
                    {trade.inPosition ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
                    {trade.inPosition ? "持仓中" : "空仓"}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2 mb-3">
                  <div>
                    <p className="text-xs text-zinc-400">初始资金</p>
                    <p className="text-sm font-medium text-zinc-700">¥{trade.initCapital.toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-xs text-zinc-400">当前市值</p>
                    <p className="text-sm font-medium text-zinc-700">¥{(trade.currentValue ?? trade.initCapital).toFixed(0)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-zinc-400">总盈亏</p>
                    <p className={`text-sm font-medium ${pnl >= 0 ? "text-emerald-600" : "text-rose-600"}`}>{fmt(pnl)}</p>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className={`text-sm font-semibold ${ret >= 0 ? "text-emerald-600" : "text-rose-600"}`}>{fmt(ret, true)}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-zinc-400">{trade.tradeCount} 笔交易</span>
                    <button type="button" onClick={e => void handleDelete(trade.id, e)}
                      className="rounded-md p-1 text-zinc-300 hover:text-rose-500">
                      <X size={14} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {showNew && (
        <NewTradeModal
          onClose={() => setShowNew(false)}
          onCreated={() => {
            setShowNew(false);
            void queryClient.invalidateQueries({ queryKey: ["paper-trades"] });
          }}
        />
      )}

      {selected && <DetailModal trade={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

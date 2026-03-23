"use client";

import { STRATEGY_DEFS } from "@/lib/backtest-engine";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as echarts from "echarts";
import { BarChart2, Bot, FileText, Home, Play, RefreshCw, Send, Square, Trash2, TrendingDown, TrendingUp, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";

const DEFAULT_SYMBOLS = ["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT"];
const INTERVALS = [
  { value: "15m", label: "15分钟" }, { value: "1h", label: "1小时" },
  { value: "4h", label: "4小时" }, { value: "1d", label: "日线" },
];
const PRESETS = [
  { label: "近1月", months: 1 }, { label: "近3月", months: 3 },
  { label: "近半年", months: 6 }, { label: "近1年", months: 12 },
];
const MODELS = [
  { id: "deepseek-chat", label: "DeepSeek" },
  { id: "qwen-plus", label: "通义千问" },
  { id: "glm-4-flash", label: "GLM-4 Flash" },
];

type Ticker = { price: number; change: number; changePct: number };
type Trade = { id: number; side: string; price: number; qty: number; quoteQty: number; pnl: number | null; pnlPct: number | null; createdAt: string };
type Bot = { id: number; symbol: string; strategyCode: string; params: string; interval: string; quoteQty: number; status: string; inPosition: boolean; entryPrice: number | null; entryDate: string | null; lastChecked: string | null; createdAt: string; trades: Trade[] };
type Balance = { asset: string; free: number; locked: number };
type BacktestRecord = { id: number; name: string; symbol: string; strategyCode: string; params: string; startDate: string; endDate: string; initCapital: number; mode: string; totalReturn: number | null; totalPnl: number | null; annualReturn: number | null; maxDrawdown: number | null; tradeCount: number | null; winRate: number | null; sharpe: number | null; sortino: number | null; calmar: number | null; avgHoldDays: number | null; avgWin: number | null; avgLoss: number | null; profitFactor: number | null; equityCurve: string | null; trades: string | null; status: string; errorMsg: string | null; createdAt: string };

function fmt(v: number | null, isPercent = false, digits = 2) {
  if (v == null) return "-";
  const n = isPercent ? v * 100 : v;
  return `${n >= 0 ? "+" : ""}${n.toFixed(digits)}${isPercent ? "%" : ""}`;
}
function fmtN(v: number, digits = 2) { return v.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits }); }
function fmtPct(v: number) { return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`; }

// ── 权益曲线图 ─────────────────────────────────────────────
function EquityChart({ data, trades }: { data: { date: string; value: number; benchmark: number }[]; trades: { entryDate: string; exitDate: string; entryPrice: number; exitPrice: number; pnl: number; pnlPct: number }[] }) {
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
      if (ei != null) buyPoints.push([ei, data[ei]!.value, `买入 ${t.entryDate.slice(0, 10)}\n价格 ${t.entryPrice.toFixed(4)}`]);
      if (xi != null) sellPoints.push([xi, data[xi]!.value, `卖出 ${t.exitDate.slice(0, 10)}\n价格 ${t.exitPrice.toFixed(4)}\n盈亏 ${t.pnl >= 0 ? "+" : ""}${t.pnl.toFixed(2)} (${(t.pnlPct * 100).toFixed(2)}%)`]);
    }
    chart.setOption({
      animation: false,
      tooltip: { trigger: "axis", axisPointer: { type: "cross" }, formatter: (params: unknown) => {
        const ps = params as { seriesName: string; value: number | [number, number, string]; axisValue: string }[];
        let html = `<div style="font-size:12px"><b>${ps[0]?.axisValue ?? ""}</b>`;
        for (const p of ps) {
          if (p.seriesName === "买入点" || p.seriesName === "卖出点") {
            const raw = Array.isArray(p.value) ? (p.value[2] as string) : "";
            html += `<br/><span style="color:${p.seriesName === "买入点" ? "#ef4444" : "#10b981"}">${raw.replace(/\n/g, "<br/>")}</span>`;
          } else { html += `<br/>${p.seriesName}: ${typeof p.value === "number" ? p.value.toLocaleString() : ""}`; }
        }
        return html + "</div>";
      }},
      legend: { data: ["策略资产", "基准收益", "买入点", "卖出点"], top: 4, textStyle: { fontSize: 11 } },
      grid: { left: 60, right: 16, top: 36, bottom: 24 },
      xAxis: { type: "category", data: data.map(d => d.date), axisLabel: { fontSize: 10, color: "#a1a1aa" }, boundaryGap: false },
      yAxis: { scale: true, axisLabel: { fontSize: 10, color: "#a1a1aa" } },
      series: [
        { name: "策略资产", type: "line", data: data.map(d => d.value), symbol: "none", itemStyle: { color: "#ef4444" }, lineStyle: { color: "#ef4444", width: 2 }, areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: "rgba(239,68,68,0.15)" }, { offset: 1, color: "rgba(239,68,68,0)" }]) } },
        { name: "基准收益", type: "line", data: data.map(d => d.benchmark), symbol: "none", itemStyle: { color: "#94a3b8" }, lineStyle: { color: "#94a3b8", width: 1.5, type: "dashed" } },
        { name: "买入点", type: "scatter", symbol: "triangle", symbolSize: 10, itemStyle: { color: "#ef4444" }, data: buyPoints },
        { name: "卖出点", type: "scatter", symbol: "triangle", symbolSize: 10, symbolRotate: 180, itemStyle: { color: "#10b981" }, data: sellPoints },
      ],
    });
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(ref.current);
    return () => { ro.disconnect(); chart.dispose(); };
  }, [data, trades]);
  return <div ref={ref} className="w-full h-64" />;
}

// ── AI 分析弹窗 ────────────────────────────────────────────
function AiModal({ open, onClose, context, symbol }: { open: boolean; onClose: () => void; context: string; symbol: string }) {
  const [messages, setMessages] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [model, setModel] = useState("deepseek-chat");
  const [showCtx, setShowCtx] = useState(false);
  const [ctxText, setCtxText] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) { setMessages([]); setCtxText(typeof window !== "undefined" ? (localStorage.getItem(`ctx:${symbol}`) ?? "") : ""); }
  }, [open, symbol]);

  useEffect(() => {
    if (open && messages.length === 0 && context) {
      void sendMsg("基于以上策略的历史买卖点规律，结合当前价格，预测下一个买入和卖出触发条件，给出具体价格区间和操作指令。");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, messages.length, context]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  async function sendMsg(text: string) {
    if (!text.trim() || loading) return;
    const userMsg = { role: "user" as const, content: text };
    const next = [...messages, userMsg];
    setMessages([...next, { role: "assistant", content: "" }]);
    setInput(""); setLoading(true);
    const abort = new AbortController(); abortRef.current = abort;
    const isFirst = messages.length === 0;
    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: abort.signal,
        body: JSON.stringify({ messages: next.slice(-10), model, context: isFirst ? { code: symbol, backtestContext: context } : { code: symbol } }),
      });
      if (!res.ok || !res.body) throw new Error("请求失败");
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = "";
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n"); buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim(); if (payload === "[DONE]") break;
          try { const p = JSON.parse(payload) as { text?: string }; if (p.text) setMessages(prev => { const u = [...prev]; const last = u[u.length - 1]; if (last?.role === "assistant") u[u.length - 1] = { ...last, content: last.content + p.text }; return u; }); } catch { /* ignore */ }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") setMessages(prev => { const u = [...prev]; const last = u[u.length - 1]; if (last?.role === "assistant" && last.content === "") u[u.length - 1] = { ...last, content: "请求失败" }; return u; });
    } finally { abortRef.current = null; setLoading(false); }
  }

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center" onClick={onClose}>
      <div className="flex h-[85vh] w-full max-w-2xl flex-col rounded-2xl bg-white shadow-2xl sm:h-[680px]" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3">
          <div className="flex items-center gap-2"><Bot size={16} className="text-zinc-500" /><span className="font-semibold text-zinc-800 text-sm">AI 回测分析 · {symbol}</span></div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setShowCtx(v => !v)} className="inline-flex items-center gap-1 rounded-md border border-zinc-200 px-2 py-1 text-xs text-zinc-500 hover:border-zinc-400"><FileText size={11} />背景</button>
            <select value={model} onChange={e => setModel(e.target.value)} className="rounded-md border border-zinc-200 px-2 py-1 text-xs outline-none">
              {MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
            <button type="button" onClick={onClose}><X size={16} className="text-zinc-400" /></button>
          </div>
        </div>
        {showCtx && (
          <div className="border-b border-zinc-100 bg-zinc-50 px-4 py-3">
            <textarea value={ctxText} onChange={e => setCtxText(e.target.value)} rows={2} placeholder="投资背景、风险偏好..." className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-xs outline-none resize-none mb-2" />
            <button type="button" onClick={() => { if (ctxText.trim()) localStorage.setItem(`ctx:${symbol}`, ctxText); else localStorage.removeItem(`ctx:${symbol}`); setShowCtx(false); setMessages([]); }} className="rounded-lg bg-zinc-900 px-3 py-1.5 text-xs text-white">保存并重新分析</button>
          </div>
        )}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              {m.role === "user" ? (
                <div className="max-w-[85%] rounded-2xl bg-zinc-900 px-3 py-2 text-sm text-white">{m.content}</div>
              ) : (
                <div className="max-w-[90%] rounded-2xl bg-zinc-100 px-4 py-3 text-sm text-zinc-800">
                  {m.content === "" && loading ? <span className="text-zinc-400">思考中...</span> : (
                    <ReactMarkdown components={{ p: ({ children }) => <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>, strong: ({ children }) => <strong className="font-semibold">{children}</strong>, ul: ({ children }) => <ul className="mb-2 ml-4 list-disc">{children}</ul>, li: ({ children }) => <li>{children}</li> }}>{m.content}</ReactMarkdown>
                  )}
                </div>
              )}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
        <p className="px-4 py-1 text-center text-xs text-zinc-400">AI 仅供参考，不构成投资建议</p>
        <div className="flex gap-2 border-t border-zinc-100 px-4 py-3">
          <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === "Enter" && !e.shiftKey && void sendMsg(input)} placeholder="继续追问..." className="flex-1 rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400" />
          {loading ? <button type="button" onClick={() => abortRef.current?.abort()} className="rounded-lg bg-zinc-200 px-3 py-2 text-zinc-700"><Square size={16} /></button>
            : <button type="button" onClick={() => void sendMsg(input)} disabled={!input.trim()} className="rounded-lg bg-zinc-900 px-3 py-2 text-white disabled:opacity-40"><Send size={16} /></button>}
        </div>
      </div>
    </div>
  );
}

// ── 回测广场 Tab ───────────────────────────────────────────
function BacktestTab() {
  const qc = useQueryClient();
  const today = new Date().toISOString().slice(0, 10);
  const oneYearAgo = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [strategyCode, setStrategyCode] = useState("ma_cross");
  const [startDate, setStartDate] = useState(oneYearAgo);
  const [endDate, setEndDate] = useState(today);
  const [initCapital, setInitCapital] = useState("10000");
  const [mode, setMode] = useState<"simple" | "compound">("compound");
  const [params, setParams] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [aiOpen, setAiOpen] = useState(false);

  const strategy = STRATEGY_DEFS.find(s => s.code === strategyCode) ?? STRATEGY_DEFS[0]!;

  useEffect(() => {
    const d: Record<string, string> = {};
    strategy.params.forEach(p => { d[p.key] = String(p.default); });
    setParams(d);
  }, [strategyCode]);

  const { data: list = [] } = useQuery<BacktestRecord[]>({
    queryKey: ["crypto-backtests"],
    queryFn: async () => { const r = await fetch("/api/crypto/backtest"); return r.json(); },
    refetchInterval: q => (q.state.data as BacktestRecord[] | undefined)?.some(r => r.status === "pending" || r.status === "running") ? 2000 : false,
  });

  const selected = list.find(r => r.id === selectedId) ?? list[0] ?? null;

  const { data: signalData } = useQuery({
    queryKey: ["crypto-signal", selected?.symbol, selected?.strategyCode, selected?.params],
    queryFn: async () => {
      const qs = new URLSearchParams({ symbol: selected!.symbol, strategyCode: selected!.strategyCode, params: selected!.params, initCapital: String(selected!.initCapital), mode: selected!.mode });
      const res = await fetch(`/api/crypto/backtest/signal?${qs}`);
      return res.json() as Promise<{ liveSignal: { signal: string; inPosition: boolean; currentPrice: number; entryPrice: number | null; stopLoss: number | null }; recentTrades: unknown[] }>;
    },
    staleTime: 5 * 60_000,
    enabled: !!selected && selected.status === "done",
  });

  useEffect(() => {
    if (!selected) return;
    setSymbol(selected.symbol); setStrategyCode(selected.strategyCode);
    setStartDate(selected.startDate); setEndDate(selected.endDate);
    setInitCapital(String(selected.initCapital)); setMode(selected.mode as "simple" | "compound");
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
    const res = await fetch("/api/crypto/backtest", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol: symbol.trim().toUpperCase(), strategyCode, params: numParams, startDate, endDate, initCapital: Number(initCapital), mode }),
    });
    const record = await res.json() as BacktestRecord;
    setSubmitting(false);
    void qc.invalidateQueries({ queryKey: ["crypto-backtests"] });
    setSelectedId(record.id);
  }

  async function handleDelete(id: number) {
    await fetch(`/api/backtest/${id}`, { method: "DELETE" });
    void qc.invalidateQueries({ queryKey: ["crypto-backtests"] });
    if (selectedId === id) setSelectedId(null);
  }

  const curve = selected?.equityCurve ? JSON.parse(selected.equityCurve) as { date: string; value: number; benchmark: number }[] : [];
  const trades = selected?.trades ? JSON.parse(selected.trades) as { entryDate: string; exitDate: string; entryPrice: number; exitPrice: number; pnl: number; pnlPct: number }[] : [];
  const sig = signalData?.liveSignal;

  const backtestContext = selected && selected.status === "done" ? (() => {
    const stratDef = STRATEGY_DEFS.find(s => s.code === selected.strategyCode);
    const parsedParams = JSON.parse(selected.params) as Record<string, number>;
    const paramStr = stratDef?.params.map(p => `${p.label}=${parsedParams[p.key] ?? p.default}`).join(", ") ?? "";
    const recent = trades.slice(-5);
    return `【交易对】${selected.symbol}
【策略】${stratDef?.label ?? selected.strategyCode}，参数：${paramStr}
【回测周期】${selected.startDate} ~ ${selected.endDate}，初始资金 $${selected.initCapital.toLocaleString()}
【当前价格】${sig ? sig.currentPrice.toFixed(4) : "获取中"}，信号：${sig ? (sig.signal === "buy" ? "买入" : sig.signal === "sell" ? "卖出" : "观望") : "-"}
【回测绩效】收益率 ${fmt(selected.totalReturn, true)}，年化 ${fmt(selected.annualReturn, true)}，最大回撤 ${selected.maxDrawdown != null ? `-${(selected.maxDrawdown * 100).toFixed(2)}%` : "-"}，胜率 ${fmt(selected.winRate, true)}，夏普 ${selected.sharpe?.toFixed(2) ?? "-"}
【最近交易】${recent.map((t, i) => `${i + 1}. 买 ${t.entryDate.slice(0, 10)}@${t.entryPrice.toFixed(4)} 卖 ${t.exitDate.slice(0, 10)}@${t.exitPrice.toFixed(4)} 盈亏${t.pnl >= 0 ? "+" : ""}${t.pnl.toFixed(2)}`).join("; ") || "暂无"}`.trim();
  })() : "";

  return (
    <div className="flex flex-col gap-6 md:flex-row">
      {/* 左侧配置 */}
      <div className="w-full md:w-64 shrink-0 flex flex-col gap-3">
        <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm flex flex-col gap-3">
          <div>
            <p className="mb-1 text-xs text-zinc-500">交易对</p>
            <select value={symbol} onChange={e => setSymbol(e.target.value)} className="w-full rounded-lg border border-zinc-200 px-2 py-1.5 text-sm outline-none">
              {DEFAULT_SYMBOLS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <p className="mb-1 text-xs text-zinc-500">周期快选</p>
            <div className="flex flex-wrap gap-1">
              {PRESETS.map(p => (
                <button key={p.label} type="button" onClick={() => { const e = new Date(); const s = new Date(); s.setMonth(s.getMonth() - p.months); setStartDate(s.toISOString().slice(0, 10)); setEndDate(e.toISOString().slice(0, 10)); }}
                  className="rounded-md border border-zinc-200 px-2 py-0.5 text-xs text-zinc-600 hover:border-zinc-400">{p.label}</button>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <div className="flex-1"><p className="text-xs text-zinc-400 mb-1">开始</p><input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="w-full rounded-lg border border-zinc-200 px-2 py-1.5 text-xs outline-none" /></div>
            <div className="flex-1"><p className="text-xs text-zinc-400 mb-1">结束</p><input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="w-full rounded-lg border border-zinc-200 px-2 py-1.5 text-xs outline-none" /></div>
          </div>
          <div>
            <p className="mb-1 text-xs text-zinc-500">策略</p>
            <select value={strategyCode} onChange={e => setStrategyCode(e.target.value)} className="w-full rounded-lg border border-zinc-200 px-2 py-1.5 text-sm outline-none">
              {STRATEGY_DEFS.map(s => <option key={s.code} value={s.code}>{s.label}</option>)}
            </select>
            {strategy.desc && <p className="mt-1.5 text-xs text-zinc-400 leading-relaxed">{strategy.desc}</p>}
          </div>
          {strategy.params.map(p => (
            <div key={p.key}>
              <p className="text-xs text-zinc-500 mb-0.5">{p.label}</p>
              <input type="number" value={params[p.key] ?? p.default} onChange={e => setParams(prev => ({ ...prev, [p.key]: e.target.value }))} className="w-full rounded-lg border border-zinc-200 px-2 py-1.5 text-sm outline-none" />
            </div>
          ))}
          <div>
            <p className="mb-1 text-xs text-zinc-500">初始资金（USDT）</p>
            <input type="number" value={initCapital} onChange={e => setInitCapital(e.target.value)} className="w-full rounded-lg border border-zinc-200 px-2 py-1.5 text-sm outline-none" />
          </div>
          <div className="flex gap-2">
            {(["simple", "compound"] as const).map(m => (
              <label key={m} className={`flex-1 cursor-pointer rounded-xl border p-2 text-xs text-center transition ${mode === m ? "border-zinc-900 bg-zinc-50 font-medium" : "border-zinc-200 text-zinc-500"}`}>
                <input type="radio" name="bt-mode" value={m} checked={mode === m} onChange={() => setMode(m)} className="sr-only" />
                {m === "simple" ? "单利" : "复利"}
              </label>
            ))}
          </div>
          <button type="button" onClick={() => void handleSubmit()} disabled={submitting || !symbol.trim()}
            className="flex items-center justify-center gap-2 rounded-xl bg-zinc-900 py-2.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-40">
            <Play size={14} />{submitting ? "提交中..." : "执行回测"}
          </button>
        </div>

        {/* 历史记录 */}
        {list.length > 0 && (
          <div className="rounded-2xl border border-zinc-200 bg-white p-3 shadow-sm">
            <p className="text-xs text-zinc-400 mb-2">历史记录</p>
            <div className="flex flex-col gap-1">
              {list.slice(0, 8).map(r => (
                <div key={r.id} onClick={() => setSelectedId(r.id)}
                  className={`flex items-center justify-between rounded-lg px-2.5 py-1.5 cursor-pointer text-xs transition ${selectedId === r.id || (!selectedId && r.id === list[0]?.id) ? "bg-zinc-900 text-white" : "hover:bg-zinc-50 text-zinc-700"}`}>
                  <span className="truncate">{r.symbol}</span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {r.status === "done" && r.totalReturn != null && (
                      <span className={r.totalReturn >= 0 ? "text-emerald-400" : "text-rose-400"}>{fmt(r.totalReturn, true)}</span>
                    )}
                    {(r.status === "pending" || r.status === "running") && <span className="text-amber-400">计算中</span>}
                    <button type="button" onClick={e => { e.stopPropagation(); void handleDelete(r.id); }} className="opacity-50 hover:opacity-100"><X size={12} /></button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 右侧结果 */}
      <div className="flex-1 min-w-0 flex flex-col gap-4">
        {selected ? (
          <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm font-semibold text-zinc-800">{selected.symbol} · {STRATEGY_DEFS.find(s => s.code === selected.strategyCode)?.label}</p>
              <div className="flex items-center gap-2">
                {selected.status === "done" && (
                  <button type="button" onClick={() => setAiOpen(true)} className="flex items-center gap-1.5 rounded-lg bg-zinc-900 px-3 py-1.5 text-xs text-white hover:bg-zinc-700">
                    <Bot size={12} /> AI 分析
                  </button>
                )}
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${selected.status === "done" ? "bg-emerald-100 text-emerald-700" : selected.status === "error" ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-700"}`}>
                  {selected.status === "done" ? "完成" : selected.status === "error" ? "失败" : "计算中..."}
                </span>
              </div>
            </div>
            {selected.status === "running" || selected.status === "pending" ? (
              <div className="flex items-center justify-center h-32 text-sm text-zinc-400">计算中，请稍候...</div>
            ) : selected.status === "error" ? (
              <div className="rounded-xl bg-rose-50 p-4 text-sm text-rose-600">{selected.errorMsg}</div>
            ) : (
              <div className="flex flex-col gap-4">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {[
                    { label: "累计收益率", value: fmt(selected.totalReturn, true), cls: selected.totalReturn != null && selected.totalReturn >= 0 ? "text-emerald-600" : "text-rose-500" },
                    { label: "年化收益率", value: fmt(selected.annualReturn, true), cls: selected.annualReturn != null && selected.annualReturn >= 0 ? "text-emerald-600" : "text-rose-500" },
                    { label: "最大回撤", value: selected.maxDrawdown != null ? `-${(selected.maxDrawdown * 100).toFixed(2)}%` : "-", cls: "text-rose-500" },
                    { label: "胜率", value: fmt(selected.winRate, true), cls: "text-zinc-800" },
                  ].map(item => (
                    <div key={item.label} className="rounded-xl bg-zinc-50 p-3 text-center">
                      <p className="text-xs text-zinc-400 mb-1">{item.label}</p>
                      <p className={`text-xl font-bold ${item.cls}`}>{item.value}</p>
                    </div>
                  ))}
                </div>
                {curve.length > 0 && (
                  <div className="rounded-xl border border-zinc-100 p-3">
                    <p className="text-xs text-zinc-500 mb-2">资产走势</p>
                    <EquityChart data={curve} trades={trades} />
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3 text-sm">
                  {[
                    { label: "夏普比率", value: selected.sharpe?.toFixed(2) ?? "-" },
                    { label: "交易次数", value: String(selected.tradeCount ?? "-") },
                    { label: "平均持有", value: selected.avgHoldDays != null ? `${selected.avgHoldDays.toFixed(1)}天` : "-" },
                    { label: "盈亏比", value: selected.profitFactor != null ? (selected.profitFactor === Infinity ? "∞" : selected.profitFactor.toFixed(2)) : "-" },
                  ].map(item => (
                    <div key={item.label} className="flex justify-between rounded-lg bg-zinc-50 px-3 py-2">
                      <span className="text-zinc-500">{item.label}</span>
                      <span className="font-semibold text-zinc-800">{item.value}</span>
                    </div>
                  ))}
                </div>
                {/* 实时信号 */}
                {sig && (
                  <div className={`rounded-xl border p-3 ${sig.signal === "buy" ? "bg-emerald-50 border-emerald-200" : sig.signal === "sell" ? "bg-rose-50 border-rose-200" : "bg-zinc-50 border-zinc-200"}`}>
                    <div className="flex items-center justify-between">
                      <span className={`font-semibold text-sm ${sig.signal === "buy" ? "text-emerald-700" : sig.signal === "sell" ? "text-rose-600" : "text-zinc-600"}`}>
                        {sig.signal === "buy" ? "📈 买入信号" : sig.signal === "sell" ? "📉 卖出信号" : "⏸ 持有观望"}
                      </span>
                      <span className="text-xs text-zinc-500">当前价 ${fmtN(sig.currentPrice, 4)}</span>
                    </div>
                    {sig.inPosition && sig.entryPrice && (
                      <p className="text-xs text-zinc-500 mt-1">持仓成本 ${fmtN(sig.entryPrice, 4)} · 止损 ${sig.stopLoss ? fmtN(sig.stopLoss, 4) : "-"}</p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center rounded-2xl border border-dashed border-zinc-200 bg-white p-12 text-sm text-zinc-400">
            配置左侧参数后点击「执行回测」
          </div>
        )}
      </div>

      <AiModal open={aiOpen} onClose={() => setAiOpen(false)} context={backtestContext} symbol={selected?.symbol ?? ""} />
    </div>
  );
}

// ── 新建机器人弹窗 ─────────────────────────────────────────
function NewBotModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [strategyCode, setStrategyCode] = useState("ma_cross");
  const [interval, setInterval_] = useState("1d");
  const [quoteQty, setQuoteQty] = useState("100");
  const [params, setParams] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  const strategy = STRATEGY_DEFS.find(s => s.code === strategyCode) ?? STRATEGY_DEFS[0]!;

  useEffect(() => {
    const d: Record<string, string> = {};
    strategy.params.forEach(p => { d[p.key] = String(p.default); });
    setParams(d);
  }, [strategyCode]);

  async function handleCreate() {
    setLoading(true);
    const numParams: Record<string, number> = {};
    Object.entries(params).forEach(([k, v]) => { numParams[k] = Number(v); });
    await fetch("/api/crypto/bots", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol: symbol.toUpperCase(), strategyCode, params: numParams, interval, quoteQty: Number(quoteQty) }),
    });
    setLoading(false);
    onCreated();
    onClose();
  }

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <p className="font-semibold text-zinc-800">新建机器人</p>
          <button type="button" onClick={onClose}><X size={16} className="text-zinc-400" /></button>
        </div>
        <div className="flex flex-col gap-3">
          <div>
            <p className="text-xs text-zinc-500 mb-1">交易对</p>
            <select value={symbol} onChange={e => setSymbol(e.target.value)} className="w-full rounded-lg border border-zinc-200 px-2 py-2 text-sm outline-none">
              {DEFAULT_SYMBOLS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <p className="text-xs text-zinc-500 mb-1">策略</p>
            <select value={strategyCode} onChange={e => setStrategyCode(e.target.value)} className="w-full rounded-lg border border-zinc-200 px-2 py-2 text-sm outline-none">
              {STRATEGY_DEFS.map(s => <option key={s.code} value={s.code}>{s.label}</option>)}
            </select>
            {strategy.desc && <p className="mt-1.5 text-xs text-zinc-400 leading-relaxed">{strategy.desc}</p>}
          </div>
          <div>
            <p className="text-xs text-zinc-500 mb-1">K线周期</p>
            <select value={interval} onChange={e => setInterval_(e.target.value)} className="w-full rounded-lg border border-zinc-200 px-2 py-2 text-sm outline-none">
              {INTERVALS.map(i => <option key={i.value} value={i.value}>{i.label}</option>)}
            </select>
          </div>
          {strategy.params.map(p => (
            <div key={p.key}>
              <p className="text-xs text-zinc-500 mb-0.5">{p.label}</p>
              <input type="number" value={params[p.key] ?? p.default} onChange={e => setParams(prev => ({ ...prev, [p.key]: e.target.value }))} className="w-full rounded-lg border border-zinc-200 px-2 py-1.5 text-sm outline-none" />
            </div>
          ))}
          <div>
            <p className="text-xs text-zinc-500 mb-1">每次买入金额（USDT）</p>
            <input type="number" value={quoteQty} onChange={e => setQuoteQty(e.target.value)} className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none" />
          </div>
          <button type="button" onClick={() => void handleCreate()} disabled={loading || !symbol.trim()}
            className="rounded-xl bg-zinc-900 py-2.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-40">
            {loading ? "创建中..." : "创建"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 主页面 ─────────────────────────────────────────────────
export default function CryptoPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<"bots" | "backtest">("bots");
  const [newBotOpen, setNewBotOpen] = useState(false);
  const [expandedBot, setExpandedBot] = useState<number | null>(null);
  const [checking, setChecking] = useState<number | null>(null);

  const { data: tickers = {} } = useQuery<Record<string, { price: number; change: number; changePct: number }>>({
    queryKey: ["crypto-tickers"],
    queryFn: async () => {
      const r = await fetch(`/api/crypto/ticker?symbols=${DEFAULT_SYMBOLS.join(",")}`);
      return r.json();
    },
    refetchInterval: 30_000,
  });

  const { data: account } = useQuery<{ balances: Balance[] }>({
    queryKey: ["crypto-account"],
    queryFn: async () => { const r = await fetch("/api/crypto/account"); return r.json(); },
    staleTime: 60_000,
  });

  const { data: bots = [], refetch: refetchBots } = useQuery<Bot[]>({
    queryKey: ["crypto-bots"],
    queryFn: async () => { const r = await fetch("/api/crypto/bots"); return r.json(); },
    refetchInterval: 30_000,
  });

  async function toggleBot(bot: Bot) {
    const action = bot.status === "running" ? "stop" : "start";
    await fetch(`/api/crypto/bots/${bot.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
    void refetchBots();
  }

  async function checkBot(bot: Bot) {
    setChecking(bot.id);
    await fetch(`/api/crypto/bots/${bot.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "check" }) });
    setChecking(null);
    void refetchBots();
  }

  async function deleteBot(id: number) {
    await fetch(`/api/crypto/bots/${id}`, { method: "DELETE" });
    void qc.invalidateQueries({ queryKey: ["crypto-bots"] });
  }

  const usdt = account?.balances?.find(b => b.asset === "USDT");

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-4 md:flex-row md:gap-6 md:py-6">
      {/* 主内容区 */}
      <div className="flex-1 min-w-0 flex flex-col gap-4">
        {/* Tab 切换 */}
        <div className="flex gap-1 rounded-xl bg-zinc-100 p-1 w-fit">
          {([["bots", "行情 & 机器人"], ["backtest", "回测广场"]] as const).map(([key, label]) => (
            <button key={key} type="button" onClick={() => setTab(key)}
              className={`rounded-lg px-4 py-1.5 text-sm font-medium transition ${tab === key ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-700"}`}>
              {label}
            </button>
          ))}
        </div>

        {tab === "bots" && (
          <div className="flex flex-col gap-4">
            {/* 行情看板 */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              {DEFAULT_SYMBOLS.map(sym => {
                const t = tickers[sym];
                const up = t && t.changePct >= 0;
                return (
                  <div key={sym} className="rounded-2xl border border-zinc-200 bg-white p-3 shadow-sm">
                    <p className="text-xs text-zinc-400 mb-1">{sym.replace("USDT", "")}</p>
                    <p className="text-base font-bold text-zinc-900">{t ? `$${fmtN(t.price, t.price > 100 ? 2 : 4)}` : "-"}</p>
                    {t && <p className={`text-xs font-medium mt-0.5 ${up ? "text-emerald-600" : "text-rose-500"}`}>{fmtPct(t.changePct)}</p>}
                  </div>
                );
              })}
            </div>

            {/* 机器人列表 */}
            <div className="rounded-2xl border border-zinc-200 bg-white shadow-sm">
              <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-100">
                <p className="font-semibold text-zinc-800 text-sm">自动交易机器人</p>
                <button type="button" onClick={() => setNewBotOpen(true)}
                  className="flex items-center gap-1.5 rounded-lg bg-zinc-900 px-3 py-1.5 text-xs text-white hover:bg-zinc-700">
                  <Bot size={12} /> 新建
                </button>
              </div>
              {bots.length === 0 ? (
                <div className="flex items-center justify-center py-12 text-sm text-zinc-400">暂无机器人，点击「新建」创建</div>
              ) : (
                <div className="divide-y divide-zinc-100">
                  {bots.map(bot => {
                    const running = bot.status === "running";
                    const ticker = tickers[bot.symbol];
                    const pnlPct = bot.inPosition && bot.entryPrice && ticker ? (ticker.price - bot.entryPrice) / bot.entryPrice * 100 : null;
                    return (
                      <div key={bot.id} className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className={`h-2 w-2 rounded-full shrink-0 ${running ? "bg-emerald-500" : "bg-zinc-300"}`} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-sm text-zinc-800">{bot.symbol}</span>
                              <span className="text-xs text-zinc-400">{STRATEGY_DEFS.find(s => s.code === bot.strategyCode)?.label ?? bot.strategyCode}</span>
                              <span className="text-xs text-zinc-400">{bot.interval}</span>
                            </div>
                            <div className="flex items-center gap-3 mt-0.5 text-xs text-zinc-500">
                              {bot.inPosition ? (
                                <>
                                  <span className="text-emerald-600 font-medium">持仓中</span>
                                  {bot.entryPrice && <span>成本 ${fmtN(bot.entryPrice, 4)}</span>}
                                  {pnlPct != null && <span className={pnlPct >= 0 ? "text-emerald-600" : "text-rose-500"}>{fmtPct(pnlPct)}</span>}
                                </>
                              ) : <span>空仓</span>}
                              {bot.lastChecked && <span>检查 {new Date(bot.lastChecked).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>}
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button type="button" onClick={() => void checkBot(bot)} disabled={checking === bot.id}
                              className="rounded-lg border border-zinc-200 px-2 py-1 text-xs text-zinc-600 hover:border-zinc-400 disabled:opacity-40">
                              {checking === bot.id ? "检查中" : "检查"}
                            </button>
                            <button type="button" onClick={() => void toggleBot(bot)}
                              className={`rounded-lg px-2 py-1 text-xs font-medium ${running ? "bg-rose-50 text-rose-600 hover:bg-rose-100" : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"}`}>
                              {running ? <><Square size={10} className="inline mr-0.5" />停止</> : <><Play size={10} className="inline mr-0.5" />启动</>}
                            </button>
                            <button type="button" onClick={() => setExpandedBot(expandedBot === bot.id ? null : bot.id)}
                              className="rounded-lg border border-zinc-200 px-2 py-1 text-xs text-zinc-500 hover:border-zinc-400">
                              {expandedBot === bot.id ? "收起" : "记录"}
                            </button>
                            <button type="button" onClick={() => void deleteBot(bot.id)}
                              className="rounded-lg border border-zinc-200 p-1 text-zinc-400 hover:border-rose-300 hover:text-rose-500">
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </div>
                        {/* 交易记录展开 */}
                        {expandedBot === bot.id && bot.trades.length > 0 && (
                          <div className="mt-3 rounded-xl bg-zinc-50 p-3">
                            <p className="text-xs text-zinc-400 mb-2">最近交易记录</p>
                            <div className="flex flex-col gap-1">
                              {bot.trades.map(t => (
                                <div key={t.id} className="flex items-center justify-between text-xs">
                                  <span className={`font-medium w-8 ${t.side === "BUY" ? "text-emerald-600" : "text-rose-500"}`}>{t.side === "BUY" ? "买" : "卖"}</span>
                                  <span className="text-zinc-600">${fmtN(t.price, 4)}</span>
                                  <span className="text-zinc-500">{fmtN(t.qty, 4)}</span>
                                  <span className="text-zinc-500">${fmtN(t.quoteQty, 2)}</span>
                                  {t.pnl != null && <span className={t.pnl >= 0 ? "text-emerald-600" : "text-rose-500"}>{fmt(t.pnl)} ({fmt(t.pnlPct, true)})</span>}
                                  <span className="text-zinc-400">{new Date(t.createdAt).toLocaleDateString("zh-CN")}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {expandedBot === bot.id && bot.trades.length === 0 && (
                          <div className="mt-2 text-xs text-zinc-400 pl-5">暂无交易记录</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {tab === "backtest" && <BacktestTab />}
      </div>

      {/* 右侧工具栏 */}
      <aside className="w-full md:w-56 shrink-0 flex flex-col gap-3">
        {/* 账户余额 */}
        <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium text-zinc-400 uppercase tracking-wide mb-3">账户余额</p>
          {usdt ? (
            <div>
              <p className="text-2xl font-bold text-zinc-900">${fmtN(usdt.free + usdt.locked)}</p>
              <p className="text-xs text-zinc-400 mt-0.5">可用 ${fmtN(usdt.free)} · 冻结 ${fmtN(usdt.locked)}</p>
            </div>
          ) : (
            <p className="text-sm text-zinc-400">加载中...</p>
          )}
          {account?.balances?.filter(b => b.asset !== "USDT" && b.free + b.locked > 0).slice(0, 5).map(b => (
            <div key={b.asset} className="flex justify-between text-xs mt-2 text-zinc-600">
              <span>{b.asset}</span>
              <span>{fmtN(b.free + b.locked, 4)}</span>
            </div>
          ))}
        </div>

        {/* 工具入口 */}
        <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium text-zinc-400 uppercase tracking-wide mb-3">工具入口</p>
          <div className="flex flex-col gap-1">
            <Link href="/">
              <div className="flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-zinc-50 transition cursor-pointer">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-zinc-100">
                  <Home size={15} className="text-zinc-600" />
                </div>
                <div>
                  <p className="text-sm font-medium text-zinc-800">回股票</p>
                  <p className="text-xs text-zinc-400">A股持仓管理</p>
                </div>
              </div>
            </Link>
            <Link href="/backtest">
              <div className="flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-zinc-50 transition cursor-pointer">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-zinc-100">
                  <BarChart2 size={15} className="text-zinc-600" />
                </div>
                <div>
                  <p className="text-sm font-medium text-zinc-800">A股回测</p>
                  <p className="text-xs text-zinc-400">股票策略回测</p>
                </div>
              </div>
            </Link>
          </div>
        </div>
      </aside>

      <NewBotModal open={newBotOpen} onClose={() => setNewBotOpen(false)} onCreated={() => void refetchBots()} />
    </div>
  );
}

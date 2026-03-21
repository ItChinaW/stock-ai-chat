"use client";

import { STRATEGY_DEFS } from "@/lib/backtest-engine";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Plus, TrendingDown, TrendingUp, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

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

type Trade = { entryDate: string; exitDate: string; entryPrice: number; exitPrice: number; pnl: number; pnlPct: number };

function fmt(v: number | null | undefined, pct = false) {
  if (v == null) return "-";
  const s = pct ? `${(v * 100).toFixed(2)}%` : v.toFixed(2);
  return (v >= 0 ? "+" : "") + s;
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
    setLoading(true);
    setError("");
    try {
      // 查股票名称
      let name = "";
      try {
        const sr = await fetch(`https://suggest3.sinajs.cn/suggest/type=11,12,13,14,15&key=${encodeURIComponent(symbol.trim())}`);
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
    } finally {
      setLoading(false);
    }
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
            <input value={symbol} onChange={e => setSymbol(e.target.value)}
              placeholder="如 511130、AAPL"
              className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-zinc-500">交易策略（不可修改）</label>
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
  const { data: detail, isLoading } = useQuery({
    queryKey: ["paper-trade-detail", trade.id],
    queryFn: async () => {
      const res = await fetch(`/api/paper-trading/${trade.id}`);
      return res.json() as Promise<PaperTrade>;
    },
    refetchInterval: 60_000,
  });

  const d = detail ?? trade;
  const trades: Trade[] = d.trades ? (JSON.parse(d.trades) as Trade[]) : [];
  const strategyDef = STRATEGY_DEFS.find(s => s.code === d.strategyCode);
  const pnl = d.totalPnl ?? 0;
  const ret = d.totalReturn ?? 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="flex h-[85vh] w-full max-w-2xl flex-col rounded-2xl bg-white shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3">
          <div>
            <span className="font-semibold text-zinc-800">{d.name || d.symbol}</span>
            <span className="ml-2 text-xs text-zinc-400">{d.symbol}</span>
            <span className="ml-2 text-xs text-zinc-400">{strategyDef?.label}</span>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-zinc-400 hover:text-zinc-700"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {isLoading && <p className="text-sm text-zinc-400 text-center py-8">加载中...</p>}

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

          {/* 策略参数 */}
          <div className="rounded-xl border border-zinc-100 p-3">
            <p className="text-xs font-medium text-zinc-500 mb-1">策略参数（固定）</p>
            <p className="text-xs text-zinc-600">
              {strategyDef?.params.map(p => `${p.label} ${p.default}`).join(" · ") ?? "-"}
            </p>
          </div>

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
  );
}

// ── 主页面 ────────────────────────────────────────────────────
export default function PaperTradingPage() {
  const queryClient = useQueryClient();
  const [showNew, setShowNew] = useState(false);
  const [selected, setSelected] = useState<PaperTrade | null>(null);

  const { data: trades = [], isLoading } = useQuery({
    queryKey: ["paper-trades"],
    queryFn: async () => {
      const res = await fetch("/api/paper-trading");
      return res.json() as Promise<PaperTrade[]>;
    },
  });

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
                    <p className="font-semibold text-zinc-800">{trade.name || trade.symbol}</p>
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
                    <p className={`text-sm font-medium ${pnl >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                      {fmt(pnl)}
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <span className={`text-sm font-semibold ${ret >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                    {fmt(ret, true)}
                  </span>
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

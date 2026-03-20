"use client";

import { useQuery } from "@tanstack/react-query";
import { BarChart2 } from "lucide-react";

type TradeLog = {
  id: number;
  code: string;
  aiSuggestion: string;
  userAction: string;
  pnlAfterAction: number | null;
  strategy: { id: number; name: string } | null;
};

async function fetchLogs(code: string): Promise<TradeLog[]> {
  const res = await fetch(`/api/trade-logs?code=${code}`);
  return res.json() as Promise<TradeLog[]>;
}

function calcStats(logs: TradeLog[]) {
  const byStrategy: Record<string, { executed: number; won: number; totalPnl: number }> = {};

  for (const log of logs) {
    if (log.userAction !== "executed") continue;
    const key = log.strategy?.name ?? "无策略";
    if (!byStrategy[key]) byStrategy[key] = { executed: 0, won: 0, totalPnl: 0 };
    byStrategy[key].executed++;
    const pnl = log.pnlAfterAction ?? 0;
    byStrategy[key].totalPnl += pnl;
    if (pnl > 0) byStrategy[key].won++;
  }

  return Object.entries(byStrategy).map(([name, s]) => ({
    name,
    executed: s.executed,
    winRate: s.executed > 0 ? ((s.won / s.executed) * 100).toFixed(0) : "0",
    avgPnl: s.executed > 0 ? (s.totalPnl / s.executed).toFixed(2) : "0",
  }));
}

export default function WinRateSidebar({ code }: { code: string }) {
  const { data: logs = [], isLoading } = useQuery({
    queryKey: ["trade-logs", code],
    queryFn: () => fetchLogs(code),
    enabled: !!code,
  });

  const stats = calcStats(logs);
  const executedCount = logs.filter((l) => l.userAction === "executed").length;
  const ignoredCount = logs.filter((l) => l.userAction === "ignored").length;

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <BarChart2 size={16} className="text-zinc-500" />
        <span className="font-semibold text-zinc-800">{code} · 策略胜率</span>
      </div>

      {isLoading && <p className="text-sm text-zinc-400">加载中...</p>}

      {!isLoading && logs.length === 0 && (
        <p className="text-sm text-zinc-400">暂无交易记录，与 AI 对话后记录执行情况</p>
      )}

      {!isLoading && logs.length > 0 && (
        <>
          <div className="mb-3 flex gap-4 text-xs text-zinc-500">
            <span>已执行 <strong className="text-emerald-600">{executedCount}</strong> 次</span>
            <span>未执行 <strong className="text-zinc-400">{ignoredCount}</strong> 次</span>
          </div>

          <div className="flex flex-col gap-2">
            {stats.map((s) => (
              <div key={s.name} className="rounded-lg bg-zinc-50 p-3">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-sm font-medium text-zinc-700">{s.name}</span>
                  <span className={`text-sm font-semibold ${Number(s.winRate) >= 50 ? "text-emerald-600" : "text-rose-600"}`}>
                    胜率 {s.winRate}%
                  </span>
                </div>
                <div className="flex gap-4 text-xs text-zinc-400">
                  <span>执行 {s.executed} 次</span>
                  <span>平均盈亏 <span className={Number(s.avgPnl) >= 0 ? "text-emerald-600" : "text-rose-600"}>
                    {Number(s.avgPnl) >= 0 ? "+" : ""}{s.avgPnl}
                  </span></span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

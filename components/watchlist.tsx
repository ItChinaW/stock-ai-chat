"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Trash2, TrendingDown, TrendingUp } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import FutuHoverPreview from "./futu-hover-preview";

// 是否美股（含 ETF）：非 A股、非纯数字代码即视为美股，启用富途 hover 预览
function isUSStock(code: string): boolean {
  const s = code.trim();
  if (/^\d{6}$/.test(s)) return false; // A股
  if (/^(sh|sz|bj)/i.test(s)) return false;
  return true;
}

type WatchItem = { id: number; code: string; name: string };
type Quote = {
  price: number; changePercent: number; previousClose: number; name?: string;
  extendedSession?: "pre" | "post" | "overnight"; extendedPrice?: number; extendedChangePercent?: number;
  extendedStale?: boolean;
};

// 延长时段中文标签
function sessionLabel(session: Quote["extendedSession"], stale?: boolean): string {
  if (stale) return "已收市";
  if (session === "pre") return "盘前";
  if (session === "overnight") return "夜盘";
  return "盘后";
}

async function fetchWatchlist(): Promise<WatchItem[]> {
  const res = await fetch("/api/watchlist");
  return res.json() as Promise<WatchItem[]>;
}

async function fetchQuotes(symbols: string[]): Promise<Record<string, Quote>> {
  if (!symbols.length) return {};
  const res = await fetch(`/api/market/quotes?symbols=${symbols.join(",")}`);
  return res.json() as Promise<Record<string, Quote>>;
}

export default function Watchlist({
  onSelect,
}: {
  onSelect: (code: string, quote?: Quote) => void;
}) {
  const queryClient = useQueryClient();
  const [input, setInput] = useState("");

  const { data: items = [] } = useQuery({ queryKey: ["watchlist"], queryFn: fetchWatchlist });

  const symbols = items.map((i) => i.code);
  const { data: quotes = {}, isFetching: quotesFetching } = useQuery({
    queryKey: ["watchlist-quotes", symbols],
    queryFn: () => fetchQuotes(symbols),
    enabled: symbols.length > 0,
    refetchInterval: 60_000,
  });

  // 行情加载后把名称回写到 DB（name 为空时才更新）
  const syncedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const item of items) {
      const name = quotes[item.code]?.name;
      if (name && !item.name && !syncedRef.current.has(item.code)) {
        syncedRef.current.add(item.code);
        fetch("/api/watchlist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: item.code, name }),
        }).then(() => queryClient.invalidateQueries({ queryKey: ["watchlist"] })).catch(() => null);
      }
    }
  }, [quotes, items, queryClient]);

  const addMutation = useMutation({
    mutationFn: async (code: string) => {
      await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["watchlist"] }),
  });

  const removeMutation = useMutation({
    mutationFn: async (code: string) => {
      await fetch(`/api/watchlist/${code}`, { method: "DELETE" });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["watchlist"] }),
  });

  function handleAdd() {
    const code = input.trim().toUpperCase();
    if (!code) return;
    addMutation.mutate(code);
    setInput("");
  }

  return (
    <div className="flex flex-col gap-3">
      {/* 搜索添加 */}
      <div className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          placeholder="输入代码添加自选（如 159941、AAPL）"
          className="flex-1 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-400"
        />
        <button
          type="button"
          onClick={handleAdd}
          className="inline-flex items-center gap-1 rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700"
        >
          <Plus size={15} />
          添加
        </button>
      </div>

      {/* 自选卡片列表 */}
      <div className="grid grid-cols-2 gap-2">
        {items.map((item) => {
          const q = quotes[item.code];
          const positive = (q?.changePercent ?? 0) >= 0;
          return (
            <FutuHoverPreview key={item.code} code={item.code} quote={q} enabled={isUSStock(item.code)}>
            <div
              role="button"
              tabIndex={0}
              onClick={() => onSelect(item.code, q)}
              onKeyDown={(e) => e.key === "Enter" && onSelect(item.code, q)}
              className="flex w-full items-center justify-between rounded-xl border border-zinc-100 bg-white p-3 text-left shadow-sm transition hover:border-zinc-300 hover:shadow-md cursor-pointer"
            >
              <div>
                <p className="font-semibold text-zinc-800">{quotes[item.code]?.name || item.name || item.code}</p>
                <p className="text-xs text-zinc-400">{item.code}</p>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <p className="font-medium text-zinc-700">{q ? q.price.toFixed(3) : "--"}</p>
                  <p className={`flex items-center gap-0.5 text-xs font-medium ${positive ? "text-emerald-600" : "text-rose-600"}`}>
                    {positive ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
                    {q ? `${positive ? "+" : ""}${q.changePercent.toFixed(2)}%` : "--"}
                  </p>
                  {q?.extendedPrice != null && q.extendedSession && (
                    <p className="mt-0.5 flex items-center justify-end gap-1 text-[10px] text-zinc-500">
                      <span className={`rounded px-1 ${q.extendedStale ? "bg-zinc-200 text-zinc-600" : q.extendedSession === "overnight" ? "bg-violet-100 text-violet-700" : "bg-indigo-100 text-indigo-700"}`}>
                        {sessionLabel(q.extendedSession, q.extendedStale)}
                      </span>
                      <span className="text-zinc-600">{q.extendedPrice.toFixed(3)}</span>
                      <span className={(q.extendedChangePercent ?? 0) >= 0 ? "text-emerald-600" : "text-rose-600"}>
                        {(q.extendedChangePercent ?? 0) >= 0 ? "+" : ""}{(q.extendedChangePercent ?? 0).toFixed(2)}%
                      </span>
                      {quotesFetching && <Loader2 size={10} className="animate-spin text-zinc-400" />}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); removeMutation.mutate(item.code); }}
                  className="rounded-md p-1 text-zinc-300 hover:text-rose-500"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
            </FutuHoverPreview>
          );
        })}
      </div>

      {items.length === 0 && (
        <p className="text-center text-sm text-zinc-400 py-4">暂无自选，输入代码添加</p>
      )}
    </div>
  );
}

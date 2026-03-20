"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleDollarSign, Eye, Pencil, Plus, Save, Trash2, Wallet, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

type Position = {
  id: number;
  code: string;
  name: string;
  costPrice: number;
  amount: number;
};

type Row = {
  id: number | null;
  code: string;
  name: string;
  costPrice: number;
  amount: number;
  isEditing: boolean;
  localKey: string;
};

type Quote = {
  symbol: string;
  name?: string;
  price: number;
  previousClose: number;
};

async function fetchPositions(): Promise<Position[]> {
  const response = await fetch("/api/positions");
  if (!response.ok) throw new Error("Failed to fetch positions");
  return response.json() as Promise<Position[]>;
}

async function fetchQuotes(symbols: string[]): Promise<Record<string, Quote>> {
  if (symbols.length === 0) return {};
  const response = await fetch(`/api/market/quotes?symbols=${symbols.join(",")}`);
  if (!response.ok) throw new Error("Failed to fetch quotes");
  return response.json() as Promise<Record<string, Quote>>;
}

function numberInput(value: string, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toRow(item: Position): Row {
  return {
    id: item.id,
    code: item.code,
    name: item.name ?? "",
    costPrice: item.costPrice,
    amount: item.amount,
    isEditing: false,
    localKey: `id-${item.id}`,
  };
}

export default function PortfolioDashboard({
  onSelectStock,
}: {
  onSelectStock?: (code: string, quote?: { price: number }) => void;
}) {
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<Row[]>([]);

  const positionsQuery = useQuery({ queryKey: ["positions"], queryFn: fetchPositions });

  const symbols = useMemo(
    () => Array.from(new Set(rows.map((r) => r.code.trim().toUpperCase()).filter(Boolean))),
    [rows],
  );

  const quotesQuery = useQuery({
    queryKey: ["quotes", symbols],
    queryFn: () => fetchQuotes(symbols),
    enabled: symbols.length > 0,
    refetchInterval: 60_000,
  });

  useEffect(() => {
    if (positionsQuery.data) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRows(positionsQuery.data.map(toRow));
    }
  }, [positionsQuery.data]);

  // 行情加载后把名称回写到持仓 DB
  const syncedNamesRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const quoteMap = quotesQuery.data ?? {};
    for (const row of rows) {
      if (row.id && !row.name && !syncedNamesRef.current.has(row.code)) {
        const name = quoteMap[row.code]?.name;
        if (name) {
          syncedNamesRef.current.add(row.code);
          fetch(`/api/positions/${row.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code: row.code, costPrice: row.costPrice, amount: row.amount, name }),
          }).then(() => queryClient.invalidateQueries({ queryKey: ["positions"] })).catch(() => null);
        }
      }
    }
  }, [quotesQuery.data, rows, queryClient]);

  const totals = useMemo(() => {
    const quoteMap = quotesQuery.data ?? {};
    return rows.reduce(
      (acc, row) => {
        const symbol = row.code.trim().toUpperCase();
        const currentPrice = quoteMap[symbol]?.price ?? row.costPrice;
        const previousClose = quoteMap[symbol]?.previousClose ?? currentPrice;
        acc.totalAssets += currentPrice * row.amount;
        acc.totalPnl += (currentPrice - row.costPrice) * row.amount;
        acc.dayPnl += (currentPrice - previousClose) * row.amount;
        return acc;
      },
      { totalAssets: 0, totalPnl: 0, dayPnl: 0 },
    );
  }, [rows, quotesQuery.data]);

  const saveMutation = useMutation({
    mutationFn: async (row: Row) => {
      const payload = { code: row.code.trim().toUpperCase(), costPrice: row.costPrice, amount: row.amount };
      const response = await fetch(row.id ? `/api/positions/${row.id}` : "/api/positions", {
        method: row.id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error("Save failed");
      return response.json() as Promise<Position>;
    },
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["positions"] }); },
  });

  const deleteMutation = useMutation({
    mutationFn: async (row: Row) => {
      if (!row.id) return;
      const response = await fetch(`/api/positions/${row.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Delete failed");
    },
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["positions"] }); },
  });

  function updateRow(index: number, key: keyof Row, value: string | number | boolean) {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, [key]: value } : row)));
  }

  function addRow() {
    const key = `new-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setRows((prev) => [...prev, { id: null, code: "", name: "", costPrice: 0, amount: 0, isEditing: true, localKey: key }]);
  }

  async function removeRow(index: number) {
    const target = rows[index];
    if (!target) return;
    if (!target.id) { setRows((prev) => prev.filter((_, i) => i !== index)); return; }
    await deleteMutation.mutateAsync(target);
  }

  async function saveRow(index: number) {
    const target = rows[index];
    if (!target || !target.code.trim() || target.amount <= 0) return;
    await saveMutation.mutateAsync(target);
    updateRow(index, "isEditing", false);
  }

  function editRow(index: number) { updateRow(index, "isEditing", true); }

  function cancelEdit(index: number) {
    const target = rows[index];
    if (!target) return;
    if (!target.id) { setRows((prev) => prev.filter((_, i) => i !== index)); return; }
    const original = positionsQuery.data?.find((item) => item.id === target.id);
    if (original) setRows((prev) => prev.map((row, i) => (i === index ? toRow(original) : row)));
  }

  const summaryCards = [
    { title: "总资产", value: totals.totalAssets, icon: Wallet, tone: "text-zinc-800" },
    { title: "总盈亏", value: totals.totalPnl, icon: CircleDollarSign, tone: totals.totalPnl >= 0 ? "text-emerald-600" : "text-rose-600" },
    { title: "当日盈亏", value: totals.dayPnl, icon: CircleDollarSign, tone: totals.dayPnl >= 0 ? "text-emerald-600" : "text-rose-600" },
  ];

  return (
    <section className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-4 md:gap-6 md:py-6">
      {/* 汇总卡片：移动端横向三列 */}
      <div className="grid grid-cols-3 gap-3 md:gap-4">
        {summaryCards.map((card) => (
          <article key={card.title} className="rounded-2xl border border-zinc-200 bg-white p-3 shadow-sm md:p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs text-zinc-500 md:text-sm">{card.title}</span>
              <card.icon className="hidden text-zinc-400 md:block" size={18} />
            </div>
            <p className={`text-base font-semibold md:text-2xl ${card.tone}`}>
              {card.value >= 0 ? "+" : ""}
              {card.value.toFixed(2)}
            </p>
          </article>
        ))}
      </div>

      {/* 持仓列表 */}
      <article className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-zinc-800 md:text-lg">持仓编辑</h2>
          <button
            type="button"
            onClick={addRow}
            className="inline-flex items-center gap-1 rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-zinc-700"
          >
            <Plus size={16} />
            添加持仓
          </button>
        </div>

        {/* 桌面端表格 */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full min-w-[780px] text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-zinc-500">
                <th className="pb-2 w-28">代码</th>
                <th className="pb-2 w-28">成本价</th>
                <th className="pb-2 w-24">数量</th>
                <th className="pb-2 w-20">现价</th>
                <th className="pb-2 w-24">浮动盈亏</th>
                <th className="pb-2 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const symbol = row.code.trim().toUpperCase();
                const price = quotesQuery.data?.[symbol]?.price ?? row.costPrice;
                const rowPnl = (price - row.costPrice) * row.amount;
                return (
                  <tr key={row.localKey} className="border-b border-zinc-100">
                    <td className="py-2 pr-2">
                      {row.isEditing ? (
                        <input value={row.code} onChange={(e) => updateRow(index, "code", e.target.value)}
                          className="w-full rounded-md border border-zinc-200 px-2 py-1 outline-none focus:border-zinc-400"
                          placeholder="AAPL / 159941 / 600519.SS" />
                      ) : (
                        <button type="button"
                          onClick={() => onSelectStock?.(symbol, quotesQuery.data?.[symbol])}
                          className="text-left font-medium text-zinc-800 underline-offset-2 hover:underline">
                          <span className="block">{symbol || "-"}</span>
                          {row.name && <span className="block text-xs font-normal text-zinc-400">{row.name}</span>}
                        </button>
                      )}
                    </td>
                    <td className="py-2 pr-2">
                      {row.isEditing ? (
                        <input type="number" value={row.costPrice} onChange={(e) => updateRow(index, "costPrice", numberInput(e.target.value))}
                          className="w-full rounded-md border border-zinc-200 px-2 py-1 outline-none focus:border-zinc-400" />
                      ) : (
                        <span className="text-zinc-700">{row.costPrice}</span>
                      )}
                    </td>
                    <td className="py-2 pr-2">
                      {row.isEditing ? (
                        <input type="number" value={row.amount} onChange={(e) => updateRow(index, "amount", numberInput(e.target.value))}
                          className="w-full rounded-md border border-zinc-200 px-2 py-1 outline-none focus:border-zinc-400" />
                      ) : (
                        <span className="text-zinc-700">{row.amount}</span>
                      )}
                    </td>
                    <td className="py-2 pr-2 font-medium text-zinc-700">{price.toFixed(2)}</td>
                    <td className={`py-2 pr-2 font-medium ${rowPnl >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                      {rowPnl >= 0 ? "+" : ""}{rowPnl.toFixed(2)}
                    </td>
                    <td className="py-2">
                      <div className="flex justify-end gap-2 whitespace-nowrap">
                        {row.isEditing ? (
                          <>
                            <button type="button" onClick={() => void saveRow(index)}
                              className="inline-flex items-center gap-1 rounded-md border border-zinc-200 px-2 py-1 text-zinc-700 hover:bg-zinc-100">
                              <Save size={14} />保存
                            </button>
                            <button type="button" onClick={() => cancelEdit(index)}
                              className="inline-flex items-center gap-1 rounded-md border border-zinc-200 px-2 py-1 text-zinc-700 hover:bg-zinc-100">
                              <X size={14} />取消
                            </button>
                          </>
                        ) : (
                          <>
                            {row.id && (
                              <Link href={`/positions/${row.id}`}
                                className="inline-flex items-center gap-1 rounded-md border border-zinc-200 px-2 py-1 text-zinc-700 hover:bg-zinc-100">
                                <Eye size={14} />详情
                              </Link>
                            )}
                            <button type="button" onClick={() => editRow(index)}
                              className="inline-flex items-center gap-1 rounded-md border border-zinc-200 px-2 py-1 text-zinc-700 hover:bg-zinc-100">
                              <Pencil size={14} />编辑
                            </button>
                          </>
                        )}
                        <button type="button" onClick={() => void removeRow(index)}
                          className="inline-flex items-center gap-1 rounded-md border border-rose-200 px-2 py-1 text-rose-700 hover:bg-rose-50">
                          <Trash2 size={14} />删除
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* 移动端卡片列表 */}
        <div className="flex flex-col gap-3 md:hidden">
          {rows.map((row, index) => {
            const symbol = row.code.trim().toUpperCase();
            const price = quotesQuery.data?.[symbol]?.price ?? row.costPrice;
            const rowPnl = (price - row.costPrice) * row.amount;
            return (
              <div key={row.localKey} className="rounded-xl border border-zinc-100 bg-zinc-50 p-3">
                {row.isEditing ? (
                  <div className="flex flex-col gap-2">
                    <input value={row.code} onChange={(e) => updateRow(index, "code", e.target.value)}
                      className="w-full rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm outline-none focus:border-zinc-400"
                      placeholder="代码：AAPL / 159941 / 600519.SS" />
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="mb-0.5 block text-xs text-zinc-500">成本价</label>
                        <input type="number" value={row.costPrice} onChange={(e) => updateRow(index, "costPrice", numberInput(e.target.value))}
                          className="w-full rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm outline-none focus:border-zinc-400" />
                      </div>
                      <div>
                        <label className="mb-0.5 block text-xs text-zinc-500">数量</label>
                        <input type="number" value={row.amount} onChange={(e) => updateRow(index, "amount", numberInput(e.target.value))}
                          className="w-full rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm outline-none focus:border-zinc-400" />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => void saveRow(index)}
                        className="flex-1 inline-flex items-center justify-center gap-1 rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100">
                        <Save size={14} />保存
                      </button>
                      <button type="button" onClick={() => cancelEdit(index)}
                        className="flex-1 inline-flex items-center justify-center gap-1 rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100">
                        <X size={14} />取消
                      </button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <div className="mb-2 flex items-center justify-between">
                      <button type="button"
                        onClick={() => onSelectStock?.(symbol, quotesQuery.data?.[symbol])}
                        className="text-left text-base font-semibold text-zinc-800 underline-offset-2 hover:underline">
                        <span className="block">{symbol || "-"}</span>
                        {row.name && <span className="block text-xs font-normal text-zinc-400">{row.name}</span>}
                      </button>
                      <span className={`text-base font-semibold ${rowPnl >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                        {rowPnl >= 0 ? "+" : ""}{rowPnl.toFixed(2)}
                      </span>
                    </div>
                    <div className="mb-3 grid grid-cols-3 gap-1 text-xs text-zinc-500">
                      <div><span className="block">成本价</span><span className="text-sm font-medium text-zinc-700">{row.costPrice}</span></div>
                      <div><span className="block">数量</span><span className="text-sm font-medium text-zinc-700">{row.amount}</span></div>
                      <div><span className="block">现价</span><span className="text-sm font-medium text-zinc-700">{price.toFixed(2)}</span></div>
                    </div>
                    <div className="flex gap-2">
                      {row.id && (
                        <Link href={`/positions/${row.id}`}
                          className="flex-1 inline-flex items-center justify-center gap-1 rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-xs text-zinc-700 hover:bg-zinc-100">
                          <Eye size={13} />详情
                        </Link>
                      )}
                      <button type="button" onClick={() => editRow(index)}
                        className="flex-1 inline-flex items-center justify-center gap-1 rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-xs text-zinc-700 hover:bg-zinc-100">
                        <Pencil size={13} />编辑
                      </button>
                      <button type="button" onClick={() => void removeRow(index)}
                        className="flex-1 inline-flex items-center justify-center gap-1 rounded-md border border-rose-200 bg-white px-2 py-1.5 text-xs text-rose-700 hover:bg-rose-50">
                        <Trash2 size={13} />删除
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {positionsQuery.isLoading && <p className="mt-3 text-sm text-zinc-500">正在加载持仓...</p>}
        {positionsQuery.isError && <p className="mt-3 text-sm text-rose-600">持仓加载失败</p>}
      </article>
    </section>
  );
}

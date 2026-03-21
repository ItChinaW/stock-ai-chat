"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleDollarSign, Eye, Pencil, Plus, Save, Trash2, Upload, Wallet, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import KlineTooltip from "./kline-tooltip";

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
  costPrice: number;   // 持久化值（用于计算）
  amount: number;      // 持久化值（用于计算）
  costPriceInput: string; // 编辑中间态
  amountInput: string;    // 编辑中间态
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
    costPriceInput: String(item.costPrice),
    amountInput: String(item.amount),
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
  const [showImport, setShowImport] = useState(false);

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
    setRows((prev) => [...prev, { id: null, code: "", name: "", costPrice: 0, amount: 0, costPriceInput: "", amountInput: "", isEditing: true, localKey: key }]);
  }

  async function removeRow(index: number) {
    const target = rows[index];
    if (!target) return;
    if (!target.id) { setRows((prev) => prev.filter((_, i) => i !== index)); return; }
    await deleteMutation.mutateAsync(target);
  }

  async function saveRow(index: number) {
    const target = rows[index];
    if (!target || !target.code.trim()) return;
    const costPrice = Number(target.costPriceInput);
    const amount = Number(target.amountInput);
    if (!Number.isFinite(costPrice) || !Number.isFinite(amount) || amount <= 0) return;
    await saveMutation.mutateAsync({ ...target, costPrice, amount });
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
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setShowImport(true)}
              className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 px-3 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
            >
              <Upload size={15} />
              导入持仓
            </button>
            <button
              type="button"
              onClick={addRow}
              className="inline-flex items-center gap-1 rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-zinc-700"
            >
              <Plus size={16} />
              添加持仓
            </button>
          </div>
        </div>

        {/* 桌面端表格 */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full min-w-[780px] text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-zinc-500">
                <th className="pb-2 w-32">代码</th>
                <th className="pb-2 w-28">成本价</th>
                <th className="pb-2 w-24">数量</th>
                <th className="pb-2 w-20">现价</th>
                <th className="pb-2 w-36">浮动盈亏</th>
                <th className="pb-2 w-28">总盈亏</th>
                <th className="pb-2 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const symbol = row.code.trim().toUpperCase();
                const price = quotesQuery.data?.[symbol]?.price ?? row.costPrice;
                const previousClose = quotesQuery.data?.[symbol]?.previousClose ?? price;
                const dayPnl = (price - previousClose) * row.amount;
                const dayPct = previousClose !== 0 ? ((price - previousClose) / previousClose) * 100 : 0;
                const totalPnl = (price - row.costPrice) * row.amount;
                const totalPct = row.costPrice !== 0 ? ((price - row.costPrice) / row.costPrice) * 100 : 0;
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
                          className="text-left underline-offset-2 hover:underline">
                          <KlineTooltip symbol={symbol}>
                            {row.name && <span className="block font-medium text-zinc-800 truncate max-w-[120px]">{row.name}</span>}
                            <span className="block text-xs text-zinc-400">{symbol || "-"}</span>
                          </KlineTooltip>
                        </button>
                      )}
                    </td>
                    <td className="py-2 pr-2">
                      {row.isEditing ? (
                        <input type="text" inputMode="decimal" value={row.costPriceInput}
                          onChange={(e) => updateRow(index, "costPriceInput", e.target.value)}
                          className="w-full rounded-md border border-zinc-200 px-2 py-1 outline-none focus:border-zinc-400" />
                      ) : (
                        <span className="text-zinc-700">{row.costPrice}</span>
                      )}
                    </td>
                    <td className="py-2 pr-2">
                      {row.isEditing ? (
                        <input type="text" inputMode="numeric" value={row.amountInput}
                          onChange={(e) => updateRow(index, "amountInput", e.target.value)}
                          className="w-full rounded-md border border-zinc-200 px-2 py-1 outline-none focus:border-zinc-400" />
                      ) : (
                        <span className="text-zinc-700">{row.amount}</span>
                      )}
                    </td>
                    <td className="py-2 pr-2 font-medium text-zinc-700">{price.toFixed(2)}</td>
                    <td className={`py-2 pr-2 font-medium ${dayPnl >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                      <span>{dayPnl >= 0 ? "+" : ""}{dayPnl.toFixed(2)}</span>
                      <span className="ml-1 text-xs opacity-75">({dayPct >= 0 ? "+" : ""}{dayPct.toFixed(2)}%)</span>
                    </td>
                    <td className={`py-2 pr-2 font-medium ${totalPnl >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                      <span>{totalPnl >= 0 ? "+" : ""}{totalPnl.toFixed(2)}</span>
                      <span className="ml-1 text-xs opacity-75">({totalPct >= 0 ? "+" : ""}{totalPct.toFixed(2)}%)</span>
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
            const previousClose = quotesQuery.data?.[symbol]?.previousClose ?? price;
            const dayPnl = (price - previousClose) * row.amount;
            const dayPct = previousClose !== 0 ? ((price - previousClose) / previousClose) * 100 : 0;
            const totalPnl = (price - row.costPrice) * row.amount;
            const totalPct = row.costPrice !== 0 ? ((price - row.costPrice) / row.costPrice) * 100 : 0;
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
                        <input type="text" inputMode="decimal" value={row.costPriceInput}
                          onChange={(e) => updateRow(index, "costPriceInput", e.target.value)}
                          className="w-full rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm outline-none focus:border-zinc-400" />
                      </div>
                      <div>
                        <label className="mb-0.5 block text-xs text-zinc-500">数量</label>
                        <input type="text" inputMode="numeric" value={row.amountInput}
                          onChange={(e) => updateRow(index, "amountInput", e.target.value)}
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
                        className="text-left underline-offset-2 hover:underline">
                        <KlineTooltip symbol={symbol}>
                          {row.name && <span className="block text-base font-semibold text-zinc-800">{row.name}</span>}
                          <span className="block text-xs text-zinc-400">{symbol || "-"}</span>
                        </KlineTooltip>
                      </button>
                      <span className={`text-base font-semibold ${dayPnl >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                        {dayPnl >= 0 ? "+" : ""}{dayPnl.toFixed(2)}
                        <span className="ml-1 text-xs opacity-75">({dayPct >= 0 ? "+" : ""}{dayPct.toFixed(2)}%)</span>
                      </span>
                    </div>
                    <div className="mb-3 grid grid-cols-4 gap-1 text-xs text-zinc-500">
                      <div><span className="block">成本价</span><span className="text-sm font-medium text-zinc-700">{row.costPrice}</span></div>
                      <div><span className="block">数量</span><span className="text-sm font-medium text-zinc-700">{row.amount}</span></div>
                      <div><span className="block">现价</span><span className="text-sm font-medium text-zinc-700">{price.toFixed(2)}</span></div>
                      <div>
                        <span className="block">总盈亏</span>
                        <span className={`text-sm font-medium ${totalPnl >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                          {totalPnl >= 0 ? "+" : ""}{totalPnl.toFixed(2)}
                          <span className="block text-xs opacity-75">({totalPct >= 0 ? "+" : ""}{totalPct.toFixed(2)}%)</span>
                        </span>
                      </div>
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

      {showImport && (
        <ImportModal
          onClose={() => setShowImport(false)}
          onImported={() => {
            setShowImport(false);
            void queryClient.invalidateQueries({ queryKey: ["positions"] });
          }}
        />
      )}
    </section>
  );
}

// ── 导入持仓弹窗 ──────────────────────────────────────────────
type ImportedPosition = { name: string; code: string; costPrice: number; amount: number };

function ImportModal({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const [step, setStep] = useState<"upload" | "preview" | "saving">("upload");
  const [preview, setPreview] = useState<string | null>(null);
  const [mimeType, setMimeType] = useState("image/jpeg");
  const [base64, setBase64] = useState("");
  const [recognizing, setRecognizing] = useState(false);
  const [error, setError] = useState("");
  const [positions, setPositions] = useState<ImportedPosition[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  function handleFile(file: File) {
    setMimeType(file.type || "image/jpeg");
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      setPreview(dataUrl);
      // 提取 base64 部分
      setBase64(dataUrl.split(",")[1] ?? "");
    };
    reader.readAsDataURL(file);
  }

  async function recognize() {
    if (!base64) return;
    setRecognizing(true);
    setError("");
    try {
      const res = await fetch("/api/positions/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: base64, mimeType }),
      });
      const data = (await res.json()) as { positions?: ImportedPosition[]; message?: string };
      if (!res.ok) throw new Error(data.message ?? "识别失败");
      setPositions(data.positions ?? []);
      setStep("preview");
    } catch (err) {
      setError(err instanceof Error ? err.message : "识别失败");
    } finally {
      setRecognizing(false);
    }
  }

  async function saveAll() {
    setStep("saving");
    for (const p of positions) {
      if (!p.code && !p.name) continue;
      await fetch("/api/positions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: p.code || p.name, name: p.name, costPrice: p.costPrice, amount: p.amount }),
      });
    }
    onImported();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="flex w-full max-w-md flex-col rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3">
          <span className="font-semibold text-zinc-800">导入持仓截图</span>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-zinc-400 hover:text-zinc-700">
            <X size={18} />
          </button>
        </div>

        <div className="p-4">
          {step === "upload" && (
            <div className="flex flex-col gap-4">
              {/* 拖拽/点击上传区 */}
              <div
                className="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-zinc-200 p-8 cursor-pointer hover:border-zinc-400 transition"
                onClick={() => fileRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
              >
                <Upload size={28} className="text-zinc-400" />
                <p className="text-sm text-zinc-500">点击或拖拽上传持仓截图</p>
                <p className="text-xs text-zinc-400">支持同花顺、东方财富等 App 截图</p>
              </div>
              <input ref={fileRef} type="file" accept="image/*" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />

              {preview && (
                <div className="flex flex-col gap-3">
                  <img src={preview} alt="预览" className="max-h-64 w-full rounded-xl object-contain border border-zinc-100" />
                  {error && <p className="text-sm text-rose-600">{error}</p>}
                  <button type="button" onClick={() => void recognize()} disabled={recognizing}
                    className="rounded-lg bg-zinc-900 py-2.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50">
                    {recognizing ? "AI 识别中..." : "开始识别"}
                  </button>
                </div>
              )}
            </div>
          )}

          {step === "preview" && (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-zinc-500">识别到以下持仓，确认后导入：</p>
              <div className="max-h-64 overflow-y-auto rounded-xl border border-zinc-100">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-100 text-left text-xs text-zinc-400">
                      <th className="px-3 py-2">名称</th>
                      <th className="px-3 py-2">代码</th>
                      <th className="px-3 py-2">成本价</th>
                      <th className="px-3 py-2">数量</th>
                    </tr>
                  </thead>
                  <tbody>
                    {positions.map((p, i) => (
                      <tr key={i} className="border-b border-zinc-50">
                        <td className="px-3 py-2 text-zinc-800">{p.name}</td>
                        <td className="px-3 py-2 text-zinc-500">{p.code || "-"}</td>
                        <td className="px-3 py-2 text-zinc-700">{p.costPrice}</td>
                        <td className="px-3 py-2 text-zinc-700">{p.amount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={() => setStep("upload")}
                  className="flex-1 rounded-lg border border-zinc-200 py-2.5 text-sm text-zinc-600 hover:bg-zinc-50">
                  重新上传
                </button>
                <button type="button" onClick={() => void saveAll()}
                  className="flex-1 rounded-lg bg-zinc-900 py-2.5 text-sm font-medium text-white hover:bg-zinc-700">
                  确认导入
                </button>
              </div>
            </div>
          )}

          {step === "saving" && (
            <div className="flex flex-col items-center gap-3 py-8">
              <p className="text-sm text-zinc-500">正在保存持仓数据...</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

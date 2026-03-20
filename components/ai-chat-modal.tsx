"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Pencil, Plus, Send, Settings, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";

type Message = { role: "user" | "assistant"; content: string };
type Strategy = { id: number; name: string; description: string };
type Position = { id: number; code: string; name: string; costPrice: number; amount: number };

const MODELS = [
  { id: "deepseek-chat", label: "DeepSeek" },
  { id: "qwen-plus", label: "通义千问" },
  { id: "gpt-4o-mini", label: "GPT-4o Mini" },
  { id: "gpt-4o", label: "GPT-4o" },
];

async function fetchStrategies(): Promise<Strategy[]> {
  const res = await fetch("/api/strategies");
  return res.json() as Promise<Strategy[]>;
}

async function fetchPositions(): Promise<Position[]> {
  const res = await fetch("/api/positions");
  return res.json() as Promise<Position[]>;
}

async function fetchHistory(code: string): Promise<Message[]> {
  const res = await fetch(`/api/chat-sessions/${encodeURIComponent(code)}`);
  return res.json() as Promise<Message[]>;
}

// ── 策略管理弹窗 ──────────────────────────────────────────────
function StrategyManager({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data: strategies = [] } = useQuery({ queryKey: ["strategies"], queryFn: fetchStrategies });
  const [editId, setEditId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [adding, setAdding] = useState(false);

  const saveMutation = useMutation({
    mutationFn: async ({ id, name, description }: { id: number; name: string; description: string }) => {
      await fetch(`/api/strategies/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description }),
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["strategies"] });
      setEditId(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await fetch(`/api/strategies/${id}`, { method: "DELETE" });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["strategies"] }),
  });

  const addMutation = useMutation({
    mutationFn: async ({ name, description }: { name: string; description: string }) => {
      await fetch("/api/strategies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description }),
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["strategies"] });
      setNewName("");
      setNewDesc("");
      setAdding(false);
    },
  });

  function startEdit(s: Strategy) {
    setEditId(s.id);
    setEditName(s.name);
    setEditDesc(s.description);
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
      <div className="flex w-full max-w-md flex-col rounded-2xl bg-white shadow-2xl max-h-[80vh]">
        <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3">
          <span className="font-semibold text-zinc-800">策略管理</span>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-zinc-400 hover:text-zinc-700">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {strategies.map((s) => (
            <div key={s.id} className="rounded-xl border border-zinc-100 bg-zinc-50 p-3">
              {editId === s.id ? (
                <div className="flex flex-col gap-2">
                  <input value={editName} onChange={(e) => setEditName(e.target.value)}
                    className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm outline-none focus:border-zinc-400"
                    placeholder="策略名称" />
                  <textarea value={editDesc} onChange={(e) => setEditDesc(e.target.value)}
                    rows={3}
                    className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm outline-none focus:border-zinc-400 resize-none"
                    placeholder="策略内容描述" />
                  <div className="flex gap-2">
                    <button type="button"
                      onClick={() => saveMutation.mutate({ id: s.id, name: editName, description: editDesc })}
                      className="flex-1 rounded-md bg-zinc-900 py-1.5 text-xs text-white hover:bg-zinc-700">
                      保存
                    </button>
                    <button type="button" onClick={() => setEditId(null)}
                      className="flex-1 rounded-md border border-zinc-200 py-1.5 text-xs text-zinc-600 hover:bg-zinc-50">
                      取消
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-zinc-800">{s.name}</p>
                    <p className="mt-0.5 text-xs text-zinc-500 line-clamp-2">{s.description}</p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <button type="button" onClick={() => startEdit(s)}
                      className="rounded-md p-1.5 text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100">
                      <Pencil size={13} />
                    </button>
                    <button type="button" onClick={() => deleteMutation.mutate(s.id)}
                      className="rounded-md p-1.5 text-zinc-400 hover:text-rose-500 hover:bg-rose-50">
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}

          {/* 新增表单 */}
          {adding ? (
            <div className="rounded-xl border border-zinc-200 p-3 flex flex-col gap-2">
              <input value={newName} onChange={(e) => setNewName(e.target.value)}
                className="rounded-md border border-zinc-200 px-2 py-1.5 text-sm outline-none focus:border-zinc-400"
                placeholder="策略名称" />
              <textarea value={newDesc} onChange={(e) => setNewDesc(e.target.value)}
                rows={3}
                className="rounded-md border border-zinc-200 px-2 py-1.5 text-sm outline-none focus:border-zinc-400 resize-none"
                placeholder="策略内容描述（AI 会参考此内容给出建议）" />
              <div className="flex gap-2">
                <button type="button"
                  onClick={() => addMutation.mutate({ name: newName, description: newDesc })}
                  disabled={!newName.trim()}
                  className="flex-1 rounded-md bg-zinc-900 py-1.5 text-xs text-white hover:bg-zinc-700 disabled:opacity-40">
                  添加
                </button>
                <button type="button" onClick={() => setAdding(false)}
                  className="flex-1 rounded-md border border-zinc-200 py-1.5 text-xs text-zinc-600 hover:bg-zinc-50">
                  取消
                </button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => setAdding(true)}
              className="flex w-full items-center justify-center gap-1 rounded-xl border border-dashed border-zinc-300 py-2.5 text-sm text-zinc-500 hover:border-zinc-400 hover:text-zinc-700">
              <Plus size={15} />
              添加策略
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── 主聊天弹窗 ────────────────────────────────────────────────
export default function AiChatModal({
  code,
  currentPrice,
  open,
  onClose,
}: {
  code: string;
  currentPrice?: number;
  open: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [model, setModel] = useState(() => {
    if (typeof window === "undefined") return "deepseek-chat";
    return localStorage.getItem("preferred-model") ?? "deepseek-chat";
  });

  function handleModelChange(m: string) {
    setModel(m);
    localStorage.setItem("preferred-model", m);
  }

  const [strategyId, setStrategyId] = useState<number | null>(() => {
    if (typeof window === "undefined") return null;
    const saved = localStorage.getItem(`strategy:${code}`);
    return saved ? Number(saved) : null;
  });

  // 策略变更时持久化到 localStorage
  function handleStrategyChange(id: number | null) {
    setStrategyId(id);
    if (id === null) localStorage.removeItem(`strategy:${code}`);
    else localStorage.setItem(`strategy:${code}`, String(id));
  }  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showStrategyManager, setShowStrategyManager] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const initializedRef = useRef<string | null>(null);

  const { data: strategies = [] } = useQuery({ queryKey: ["strategies"], queryFn: fetchStrategies });
  const { data: positions = [] } = useQuery({ queryKey: ["positions"], queryFn: fetchPositions });
  const { data: history, isSuccess: historyLoaded } = useQuery({
    queryKey: ["chat-history", code],
    queryFn: () => fetchHistory(code),
    enabled: open,
    staleTime: Infinity,
  });

  // 策略列表加载后，若无记录则默认选第一个
  useEffect(() => {
    if (strategies.length > 0 && strategyId === null) {
      handleStrategyChange(strategies[0]!.id);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strategies]);

  // 切换 code 时从 localStorage 恢复，没有则选第一个
  useEffect(() => {
    const saved = localStorage.getItem(`strategy:${code}`);
    if (saved) {
      setStrategyId(Number(saved));
    } else if (strategies.length > 0) {
      handleStrategyChange(strategies[0]!.id);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  // 只在首次加载或切换 code 时同步历史
  useEffect(() => {
    if (historyLoaded && initializedRef.current !== code) {
      initializedRef.current = code;
      setMessages(history ?? []);
    }
  }, [historyLoaded, history, code]);

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, open]);

  // ESC 关闭
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  const position = positions.find((p) => p.code === code);
  const watchItem = useQuery({
    queryKey: ["watchlist"],
    queryFn: async () => {
      const res = await fetch("/api/watchlist");
      return res.json() as Promise<{ code: string; name: string }[]>;
    },
  }).data?.find((w) => w.code === code);

  const stockName = position?.name || watchItem?.name || "";
  const selectedStrategy = strategies.find((s) => s.id === strategyId);

  async function persistMessage(role: string, content: string) {
    await fetch(`/api/chat-sessions/${encodeURIComponent(code)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role, content }),
    });
  }

  async function send() {
    const text = input.trim();
    if (!text || loading) return;
    const userMsg: Message = { role: "user", content: text };
    const next = [...messages, userMsg];
    setMessages([...next, { role: "assistant", content: "" }]);
    setInput("");
    setLoading(true);
    void persistMessage("user", text);

    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: next,
          model,
          context: {
            code,
            currentPrice,
            costPrice: position?.costPrice,
            amount: position?.amount,
            strategy: selectedStrategy?.name,
            strategyDescription: selectedStrategy?.description,
          },
        }),
      });

      if (!res.ok || !res.body) throw new Error("请求失败");

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let fullReply = "";

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
            const parsed = JSON.parse(payload) as { text?: string; error?: string };
            if (parsed.error) throw new Error(parsed.error);
            if (parsed.text) {
              fullReply += parsed.text;
              setMessages((prev) => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last?.role === "assistant") {
                  updated[updated.length - 1] = { ...last, content: last.content + parsed.text };
                }
                return updated;
              });
            }
          } catch { /* ignore */ }
        }
      }

      if (fullReply) {
        void persistMessage("assistant", fullReply);
        void queryClient.invalidateQueries({ queryKey: ["chat-history", code] });
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "请求失败";
      setMessages((prev) => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last?.role === "assistant" && last.content === "") {
          updated[updated.length - 1] = { ...last, content: errMsg };
        }
        return updated;
      });
    } finally {
      setLoading(false);
    }
  }

  async function handleClear() {
    await fetch(`/api/chat-sessions/${encodeURIComponent(code)}`, { method: "DELETE" });
    initializedRef.current = null;
    setMessages([]);
    void queryClient.invalidateQueries({ queryKey: ["chat-history", code] });
  }

  async function saveLog(userAction: "executed" | "ignored") {
    const lastAi = [...messages].reverse().find((m) => m.role === "assistant");
    if (!lastAi) return;
    setSaving(true);
    await fetch("/api/trade-logs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, aiSuggestion: lastAi.content, userAction, strategyId: strategyId ?? undefined }),
    });
    setSaving(false);
    alert(userAction === "executed" ? "已记录：按策略执行" : "已记录：未按策略执行");
  }

  if (!open) return null;

  return (
    <>
      {showStrategyManager && <StrategyManager onClose={() => setShowStrategyManager(false)} />}

      <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center" onClick={onClose}>
        <div className="flex h-[90vh] w-full max-w-lg flex-col rounded-2xl bg-white shadow-2xl sm:h-[600px]" onClick={(e) => e.stopPropagation()}>
          {/* Header */}
          <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3">
            <div className="flex items-center gap-2 flex-wrap">
              <Bot size={18} className="text-zinc-600" />
              {stockName
                ? <><span className="font-semibold text-zinc-800">{stockName}</span><span className="text-xs text-zinc-400">{code}</span></>
                : <span className="font-semibold text-zinc-800">{code}</span>
              }
              {currentPrice && <span className="text-xs text-zinc-500">现价 {currentPrice.toFixed(3)}</span>}
              {position && (
                <span className="text-xs text-zinc-400">成本 {position.costPrice} × {position.amount} 股</span>
              )}
            </div>
            <button type="button" onClick={onClose} className="rounded-md p-1 text-zinc-400 hover:text-zinc-700">
              <X size={18} />
            </button>
          </div>

          {/* 模型 & 策略 */}
          <div className="flex flex-wrap items-center gap-2 border-b border-zinc-100 px-4 py-2">
            <select value={model} onChange={(e) => handleModelChange(e.target.value)}
              className="rounded-md border border-zinc-200 px-2 py-1 text-xs outline-none">
              {MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>

            <select value={strategyId ?? ""} onChange={(e) => handleStrategyChange(e.target.value ? Number(e.target.value) : null)}
              className="rounded-md border border-zinc-200 px-2 py-1 text-xs outline-none">
              <option value="">无策略</option>
              {strategies.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>

            {/* 管理策略入口 */}
            <button type="button" onClick={() => setShowStrategyManager(true)}
              className="inline-flex items-center gap-1 rounded-md border border-zinc-200 px-2 py-1 text-xs text-zinc-500 hover:border-zinc-400 hover:text-zinc-700">
              <Settings size={12} />
              管理策略
            </button>

            {messages.length > 0 && (
              <button type="button" onClick={() => void handleClear()}
                className="ml-auto text-xs text-zinc-400 hover:text-zinc-600">
                清空对话
              </button>
            )}
          </div>

          {/* 当前策略预览 */}
          {selectedStrategy && (
            <div className="border-b border-zinc-100 bg-zinc-50 px-4 py-1.5">
              <p className="text-xs text-zinc-500 line-clamp-1">
                <span className="font-medium text-zinc-700">{selectedStrategy.name}：</span>
                {selectedStrategy.description}
              </p>
            </div>
          )}

          {/* 消息区 */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full gap-2 text-zinc-400">
                <Bot size={32} />
                <p className="text-sm">问我关于 {code} 的任何问题</p>
                <div className="flex flex-wrap justify-center gap-2 mt-2">
                  {["当前走势如何？", "是否应该加仓？", "止损位在哪里？"].map((q) => (
                    <button key={q} type="button" onClick={() => setInput(q)}
                      className="rounded-full border border-zinc-200 px-3 py-1 text-xs hover:bg-zinc-50">
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                {m.role === "user" ? (
                  <div className="max-w-[85%] rounded-2xl bg-zinc-900 px-3 py-2 text-sm text-white">
                    {m.content}
                  </div>
                ) : (
                  <div className="max-w-[90%] rounded-2xl bg-zinc-100 px-4 py-3 text-sm text-zinc-800">
                    {m.content === "" && loading ? (
                      <span className="text-zinc-400">思考中...</span>
                    ) : (
                      <ReactMarkdown components={{
                        p: ({ children }) => <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>,
                        strong: ({ children }) => <strong className="font-semibold text-zinc-900">{children}</strong>,
                        ul: ({ children }) => <ul className="mb-2 ml-4 list-disc space-y-1">{children}</ul>,
                        ol: ({ children }) => <ol className="mb-2 ml-4 list-decimal space-y-1">{children}</ol>,
                        li: ({ children }) => <li className="leading-relaxed">{children}</li>,
                        h1: ({ children }) => <h1 className="mb-2 text-base font-bold">{children}</h1>,
                        h2: ({ children }) => <h2 className="mb-1 text-sm font-bold">{children}</h2>,
                        h3: ({ children }) => <h3 className="mb-1 text-sm font-semibold">{children}</h3>,
                        code: ({ children }) => <code className="rounded bg-zinc-200 px-1 py-0.5 text-xs font-mono">{children}</code>,
                        hr: () => <hr className="my-2 border-zinc-200" />,
                      }}>
                        {m.content}
                      </ReactMarkdown>
                    )}
                  </div>
                )}
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          {/* 记录操作 */}
          {messages.some((m) => m.role === "assistant" && m.content) && (
            <div className="flex gap-2 border-t border-zinc-100 px-4 py-2">
              <span className="text-xs text-zinc-400 self-center shrink-0">记录：</span>
              <button type="button" disabled={saving} onClick={() => void saveLog("executed")}
                className="rounded-md border border-emerald-200 px-2 py-1 text-xs text-emerald-700 hover:bg-emerald-50 disabled:opacity-50">
                ✓ 已执行
              </button>
              <button type="button" disabled={saving} onClick={() => void saveLog("ignored")}
                className="rounded-md border border-zinc-200 px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-50 disabled:opacity-50">
                ✗ 未执行
              </button>
            </div>
          )}

          {/* 输入框 */}
          <div className="flex gap-2 border-t border-zinc-100 px-4 py-3">
            <input value={input} onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && void send()}
              placeholder="输入问题..."
              className="flex-1 rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400" />
            <button type="button" onClick={() => void send()} disabled={loading || !input.trim()}
              className="rounded-lg bg-zinc-900 px-3 py-2 text-white hover:bg-zinc-700 disabled:opacity-40">
              <Send size={16} />
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

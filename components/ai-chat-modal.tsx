"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Send, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";

type Message = { role: "user" | "assistant"; content: string };
type Strategy = { id: number; name: string; description: string };
type Position = { id: number; code: string; name: string; costPrice: number; amount: number };

const MODELS = [
  { id: "deepseek-chat", label: "DeepSeek" },
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
  const [model, setModel] = useState("deepseek-chat");
  const [strategyId, setStrategyId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const initializedRef = useRef<string | null>(null); // 记录已初始化的 code

  const { data: strategies = [] } = useQuery({ queryKey: ["strategies"], queryFn: fetchStrategies });
  const { data: positions = [] } = useQuery({ queryKey: ["positions"], queryFn: fetchPositions });
  const { data: history, isSuccess: historyLoaded } = useQuery({
    queryKey: ["chat-history", code],
    queryFn: () => fetchHistory(code),
    enabled: open,
    staleTime: Infinity, // 不自动重新请求，手动控制
  });

  // 只在首次加载或切换 code 时同步历史到 state
  useEffect(() => {
    if (historyLoaded && initializedRef.current !== code) {
      initializedRef.current = code;
      setMessages(history ?? []);
    }
  }, [historyLoaded, history, code]);

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, open]);

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

    // 持久化用户消息
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
          } catch { /* ignore chunk parse errors */ }
        }
      }

      // 流结束后持久化完整 AI 回复
      if (fullReply) {
        void persistMessage("assistant", fullReply);
        // 让 React Query 缓存失效，下次打开时重新从 DB 加载
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
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="flex h-[90vh] w-full max-w-lg flex-col rounded-2xl bg-white shadow-2xl sm:h-[600px]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3">
          <div className="flex items-center gap-2 flex-wrap">
            <Bot size={18} className="text-zinc-600" />
            <span className="font-semibold text-zinc-800">{code}</span>
            {stockName && <span className="text-xs text-zinc-500">{stockName}</span>}
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
          <select value={model} onChange={(e) => setModel(e.target.value)}
            className="rounded-md border border-zinc-200 px-2 py-1 text-xs outline-none">
            {MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
          <select value={strategyId ?? ""} onChange={(e) => setStrategyId(e.target.value ? Number(e.target.value) : null)}
            className="rounded-md border border-zinc-200 px-2 py-1 text-xs outline-none">
            <option value="">选择策略（可选）</option>
            {strategies.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          {messages.length > 0 && (
            <button type="button" onClick={() => void handleClear()}
              className="ml-auto text-xs text-zinc-400 hover:text-zinc-600">
              清空对话
            </button>
          )}
        </div>

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
  );
}

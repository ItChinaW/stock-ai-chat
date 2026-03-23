"use client";

import { STRATEGY_DEFS } from "@/lib/backtest-engine";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, FileText, Send, Square, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";

type Message = { role: "user" | "assistant"; content: string };
type Position = { id: number; code: string; name: string; costPrice: number; amount: number };
type AiConfig = { aiEnabled: boolean; models: { id: string; label: string }[]; visionEnabled: boolean };

const FALLBACK_MODELS = [
  { id: "deepseek-chat", label: "DeepSeek" },
  { id: "qwen-plus", label: "通义千问" },
  { id: "glm-4-flash", label: "智谱 GLM" },
];

async function fetchPositions(): Promise<Position[]> {
  const res = await fetch("/api/positions");
  return res.json() as Promise<Position[]>;
}

async function fetchHistory(code: string): Promise<Message[]> {
  const res = await fetch(`/api/chat-sessions/${encodeURIComponent(code)}`);
  return res.json() as Promise<Message[]>;
}

// ── 会话上下文弹窗 ────────────────────────────────────────────
function ContextEditor({ code, onClose }: { code: string; onClose: () => void }) {
  const key = `ctx:${code}`;
  const [text, setText] = useState(() =>
    typeof window !== "undefined" ? (localStorage.getItem(key) ?? "") : ""
  );

  function handleSave() {
    if (text.trim()) localStorage.setItem(key, text.trim());
    else localStorage.removeItem(key);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <p className="text-sm font-semibold text-zinc-800">会话上下文</p>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-zinc-400 hover:text-zinc-700">
            <X size={16} />
          </button>
        </div>
        <p className="text-xs text-zinc-400 mb-3">告诉 AI 你的投资背景，它会结合这些信息给出更贴合你的建议</p>
        <textarea value={text} onChange={e => setText(e.target.value)} rows={5}
          placeholder={"例如：\n我计划持有1年，目标是攒够买车的首付20万\n每月可以定投3000元\n风险承受能力中等，最多接受10%亏损"}
          className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400 resize-none mb-3" />
        <div className="flex gap-2">
          <button type="button" onClick={handleSave}
            className="flex-1 rounded-lg bg-zinc-900 py-2 text-sm text-white hover:bg-zinc-700">
            保存
          </button>
          <button type="button" onClick={() => { localStorage.removeItem(key); setText(""); onClose(); }}
            className="rounded-lg border border-zinc-200 px-3 py-2 text-sm text-zinc-500 hover:bg-zinc-50">
            清除
          </button>
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
  const [strategyCode, setStrategyCode] = useState(() => {
    if (typeof window === "undefined") return "";
    return localStorage.getItem(`strategy-code:${code}`) ?? "";
  });
  const [showCtxEditor, setShowCtxEditor] = useState(false);
  const [editingParams, setEditingParams] = useState(false);
  // 自定义参数：key = param.key, value = number（存 localStorage）
  const [customParams, setCustomParams] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const userScrolledUpRef = useRef(false);
  const initializedRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const { data: positions = [] } = useQuery({ queryKey: ["positions"], queryFn: fetchPositions });
  const { data: history, isSuccess: historyLoaded } = useQuery({
    queryKey: ["chat-history", code],
    queryFn: () => fetchHistory(code),
    enabled: open,
    staleTime: Infinity,
  });
  const { data: aiConfig } = useQuery<AiConfig>({
    queryKey: ["ai-config"],
    queryFn: async () => { const r = await fetch("/api/ai/config"); return r.json(); },
    staleTime: 60_000,
  });
  const availableModels = aiConfig?.models?.length ? aiConfig.models : FALLBACK_MODELS;

  // 切换 code 时恢复策略选择
  useEffect(() => {
    const saved = localStorage.getItem(`strategy-code:${code}`);
    setStrategyCode(saved ?? "");
    setEditingParams(false);
    if (saved) {
      const savedParams = localStorage.getItem(`params:${code}:${saved}`);
      setCustomParams(savedParams ? (JSON.parse(savedParams) as Record<string, number>) : {});
    } else {
      setCustomParams({});
    }
  }, [code]);

  function handleStrategyChange(c: string) {
    setStrategyCode(c);
    setEditingParams(false);
    if (c) {
      localStorage.setItem(`strategy-code:${code}`, c);
      // 加载该策略的自定义参数
      const saved = localStorage.getItem(`params:${code}:${c}`);
      setCustomParams(saved ? (JSON.parse(saved) as Record<string, number>) : {});
    } else {
      localStorage.removeItem(`strategy-code:${code}`);
      setCustomParams({});
    }
  }

  function handleModelChange(m: string) {
    setModel(m);
    localStorage.setItem("preferred-model", m);
  }

  // 只在首次加载或切换 code 时同步历史
  useEffect(() => {
    if (historyLoaded && initializedRef.current !== code) {
      initializedRef.current = code;
      setMessages(history ?? []);
    }
  }, [historyLoaded, history, code]);

  useEffect(() => {
    if (!open) return;
    const el = scrollContainerRef.current;
    if (!el) return;
    const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (!userScrolledUpRef.current || isAtBottom) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  const position = positions.find((p) => p.code === code);
  const { data: watchlist = [] } = useQuery({
    queryKey: ["watchlist"],
    queryFn: async () => { const res = await fetch("/api/watchlist"); return res.json() as Promise<{ code: string; name: string }[]>; },
  });
  const stockName = position?.name || watchlist.find(w => w.code === code)?.name || "";
  const selectedStrategy = STRATEGY_DEFS.find(s => s.code === strategyCode);
  const userContext = typeof window !== "undefined" ? (localStorage.getItem(`ctx:${code}`) ?? "") : "";
  const hasContext = !!userContext;

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
    userScrolledUpRef.current = false;
    setLoading(true);
    void persistMessage("user", text);

    const abort = new AbortController();
    abortRef.current = abort;

    // 构建 context：策略和价格每次都传（放 system prompt），只有大块回测数据只传第一次
    const isFirstMsg = messages.filter(m => m.role === "user").length === 0;
    const ctx = localStorage.getItem(`ctx:${code}`) ?? "";
    const strategyDesc = selectedStrategy
      ? `${selectedStrategy.label}（${selectedStrategy.params.map(p => `${p.label}=${customParams[p.key] ?? p.default}`).join("，")}）`
      : undefined;
    // 历史消息最多保留最近 10 条
    const trimmedNext = next.slice(-10);

    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: abort.signal,
        body: JSON.stringify({
          messages: trimmedNext,
          model,
          context: {
            code,
            currentPrice,
            costPrice: position?.costPrice,
            amount: position?.amount,
            strategy: selectedStrategy?.label,
            strategyDescription: strategyDesc,
            // 用户投资背景和回测数据只在第一条消息传
            backtestContext: isFirstMsg && ctx ? `【用户投资背景】\n${ctx}` : undefined,
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

      if (fullReply) {
        void persistMessage("assistant", fullReply);
        void queryClient.invalidateQueries({ queryKey: ["chat-history", code] });
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        setMessages(prev => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last?.role === "assistant" && last.content) {
            void persistMessage("assistant", last.content);
            void queryClient.invalidateQueries({ queryKey: ["chat-history", code] });
          }
          return updated;
        });
      } else {
        const errMsg = err instanceof Error ? err.message : "请求失败";
        setMessages(prev => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last?.role === "assistant" && last.content === "") updated[updated.length - 1] = { ...last, content: errMsg };
          return updated;
        });
      }
    } finally {
      abortRef.current = null;
      setLoading(false);
    }
  }

  async function handleClear() {
    await fetch(`/api/chat-sessions/${encodeURIComponent(code)}`, { method: "DELETE" });
    initializedRef.current = null;
    setMessages([]);
    void queryClient.invalidateQueries({ queryKey: ["chat-history", code] });
  }

  if (!open) return null;

  return (
    <>
      {showCtxEditor && <ContextEditor code={code} onClose={() => setShowCtxEditor(false)} />}

      <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center" onClick={onClose}>
        <div className="flex h-[90vh] w-full max-w-2xl flex-col rounded-2xl bg-white shadow-2xl sm:h-[680px]" onClick={e => e.stopPropagation()}>
          {/* Header */}
          <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3">
            <div className="flex items-center gap-2 flex-wrap">
              <Bot size={18} className="text-zinc-600" />
              {stockName
                ? <><span className="font-semibold text-zinc-800">{stockName}</span><span className="text-xs text-zinc-400">{code}</span></>
                : <span className="font-semibold text-zinc-800">{code}</span>
              }
              {currentPrice && <span className="text-xs text-zinc-500">现价 {currentPrice.toFixed(3)}</span>}
              {position && <span className="text-xs text-zinc-400">成本 {position.costPrice} × {position.amount} 股</span>}
            </div>
            <button type="button" onClick={onClose} className="rounded-md p-1 text-zinc-400 hover:text-zinc-700">
              <X size={18} />
            </button>
          </div>

          {/* 工具栏 */}
          <div className="flex flex-wrap items-center gap-2 border-b border-zinc-100 px-4 py-2">
            <select value={model} onChange={e => handleModelChange(e.target.value)}
              className="rounded-md border border-zinc-200 px-2 py-1 text-xs outline-none">
              {availableModels.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>

            <select value={strategyCode} onChange={e => handleStrategyChange(e.target.value)}
              className="rounded-md border border-zinc-200 px-2 py-1 text-xs outline-none">
              <option value="">无策略</option>
              {STRATEGY_DEFS.map(s => <option key={s.code} value={s.code}>{s.label}</option>)}
            </select>

            <button type="button" onClick={() => setShowCtxEditor(true)}
              className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition ${hasContext ? "border-blue-200 bg-blue-50 text-blue-600" : "border-zinc-200 text-zinc-500 hover:border-zinc-400 hover:text-zinc-700"}`}>
              <FileText size={12} />
              {hasContext ? "上下文已设置" : "设置上下文"}
            </button>

            {messages.length > 0 && (
              <button type="button" onClick={() => void handleClear()}
                className="ml-auto text-xs text-zinc-400 hover:text-zinc-600">
                清空对话
              </button>
            )}
          </div>

          {/* 策略参数预览 / 编辑 */}
          {selectedStrategy && (
            <div className="border-b border-zinc-100 bg-zinc-50 px-4 py-1.5">
              {editingParams ? (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <span className="text-xs font-medium text-zinc-700">{selectedStrategy.label}：</span>
                  {selectedStrategy.params.map(p => (
                    <label key={p.key} className="flex items-center gap-1 text-xs text-zinc-500">
                      {p.label}
                      <input
                        type="number"
                        value={customParams[p.key] ?? p.default}
                        onChange={e => {
                          const val = parseFloat(e.target.value);
                          if (!isNaN(val)) {
                            const next = { ...customParams, [p.key]: val };
                            setCustomParams(next);
                            localStorage.setItem(`params:${code}:${strategyCode}`, JSON.stringify(next));
                          }
                        }}
                        className="w-14 rounded border border-zinc-300 px-1.5 py-0.5 text-xs outline-none focus:border-zinc-500 text-zinc-800"
                      />
                    </label>
                  ))}
                  <button type="button" onClick={async () => {
                    setEditingParams(false);
                    // 参数变了，清空历史对话让 AI 基于新参数重新回答
                    await fetch(`/api/chat-sessions/${encodeURIComponent(code)}`, { method: "DELETE" });
                    initializedRef.current = null;
                    setMessages([]);
                    void queryClient.invalidateQueries({ queryKey: ["chat-history", code] });
                  }} className="ml-auto text-xs text-blue-500 hover:text-blue-700 font-medium">应用并重置对话</button>
                </div>
              ) : (
                <button type="button" onClick={() => setEditingParams(true)}
                  className="w-full text-left group">
                  <p className="text-xs text-zinc-500 line-clamp-1 group-hover:text-zinc-700 transition-colors">
                    <span className="font-medium text-zinc-700">{selectedStrategy.label}：</span>
                    {selectedStrategy.params.map(p => `${p.label} ${customParams[p.key] ?? p.default}`).join(" · ")}
                    <span className="ml-1.5 text-zinc-300 group-hover:text-zinc-400">✎</span>
                  </p>
                </button>
              )}
            </div>
          )}

          {/* 消息区 */}
          <div ref={scrollContainerRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3"
            onScroll={() => {
              const el = scrollContainerRef.current;
              if (!el) return;
              userScrolledUpRef.current = el.scrollHeight - el.scrollTop - el.clientHeight >= 80;
            }}>
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full gap-2 text-zinc-400">
                <Bot size={32} />
                <p className="text-sm">问我关于 {code} 的任何问题</p>
                <div className="flex flex-wrap justify-center gap-2 mt-2">
                  {["当前走势如何？", "是否应该加仓？", "止损位在哪里？"].map(q => (
                    <button key={q} type="button" onClick={() => setInput(q)}
                      className="rounded-full border border-zinc-200 px-3 py-1 text-xs hover:bg-zinc-50">{q}</button>
                  ))}
                </div>
              </div>
            )}
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
                        h1: ({ children }) => <h1 className="mb-2 text-base font-bold">{children}</h1>,
                        h2: ({ children }) => <h2 className="mb-1 text-sm font-bold">{children}</h2>,
                        h3: ({ children }) => <h3 className="mb-1 text-sm font-semibold">{children}</h3>,
                        code: ({ children }) => <code className="rounded bg-zinc-200 px-1 py-0.5 text-xs font-mono">{children}</code>,
                        hr: () => <hr className="my-2 border-zinc-200" />,
                      }}>{m.content}</ReactMarkdown>
                    )}
                  </div>
                )}
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          <p className="px-4 py-1 text-center text-xs text-zinc-400 border-t border-zinc-50">AI 仅供参考，不构成投资建议</p>

          {/* 输入框 */}
          <div className="flex gap-2 border-t border-zinc-100 px-4 py-3">
            <input value={input} onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && !e.shiftKey && void send()}
              placeholder="输入问题..."
              className="flex-1 rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400" />
            {loading ? (
              <button type="button" onClick={() => abortRef.current?.abort()}
                className="rounded-lg bg-zinc-200 px-3 py-2 text-zinc-700 hover:bg-zinc-300">
                <Square size={16} />
              </button>
            ) : (
              <button type="button" onClick={() => void send()} disabled={!input.trim()}
                className="rounded-lg bg-zinc-900 px-3 py-2 text-white hover:bg-zinc-700 disabled:opacity-40">
                <Send size={16} />
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

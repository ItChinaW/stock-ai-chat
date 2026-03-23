"use client";

import { useQuery } from "@tanstack/react-query";
import { BarChart2, Bitcoin, Bot, FlaskConical, Send, Square, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import AiChatModal from "./ai-chat-modal";
import PortfolioDashboard from "./portfolio-dashboard";
import Watchlist from "./watchlist";

type SelectedStock = { code: string; currentPrice?: number };
type Position = { id: number; code: string; name: string; costPrice: number; amount: number };
type WatchItem = { code: string; name: string };
type Quote = { price: number; changePercent: number };
type NewsItem = { title: string; url: string; digest: string; tag: string; hot: number; time: number };

const SIDEBAR_LINKS = [
  { href: "/backtest", icon: BarChart2, label: "回测广场", desc: "验证你的交易策略" },
  { href: "/paper-trading", icon: FlaskConical, label: "模拟交易", desc: "策略实盘模拟演练" },
  { href: "/crypto", icon: Bitcoin, label: "数字量化", desc: "加密货币策略回测" },
];

const MODELS = [
  { id: "deepseek-chat", label: "DeepSeek" },
  { id: "qwen-plus", label: "通义千问" },
  { id: "glm-4-flash", label: "GLM-4 Flash" },
];

const PORTFOLIO_QUICK_QUESTIONS = [
  "我的持仓中有哪些近期有买入机会？",
  "哪些股票需要注意风险？",
  "帮我分析一下整体持仓结构",
  "自选里有什么值得关注的？",
];

const NEWS_QUICK_QUESTIONS = [
  "当前市场有哪些重要风险点？",
  "哪些新闻对A股影响最大？",
  "全球宏观有什么值得关注的？",
  "结合新闻，现在适合操作吗？",
];

// 通用流式发送逻辑
async function streamChat(
  messages: { role: "user" | "assistant"; content: string }[],
  model: string,
  systemOverride: string,
  signal: AbortSignal,
  onChunk: (text: string) => void
) {
  const res = await fetch("/api/ai/chat", {
    method: "POST", headers: { "Content-Type": "application/json" }, signal,
    body: JSON.stringify({ messages: messages.slice(-10), model, systemOverride }),
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
      try { const p = JSON.parse(payload) as { text?: string }; if (p.text) onChunk(p.text); } catch { /* ignore */ }
    }
  }
}

// ── 持仓 AI 弹窗 ──────────────────────────────────────────
function PortfolioAiModal({ onClose }: { onClose: () => void }) {
  const [messages, setMessages] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [model, setModel] = useState("deepseek-chat");
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data: positions = [] } = useQuery<Position[]>({
    queryKey: ["positions"],
    queryFn: async () => { const r = await fetch("/api/positions"); return r.json(); },
  });
  const { data: watchlist = [] } = useQuery<WatchItem[]>({
    queryKey: ["watchlist"],
    queryFn: async () => { const r = await fetch("/api/watchlist"); return r.json(); },
  });
  const allCodes = [...new Set([...positions.map(p => p.code), ...watchlist.map(w => w.code)])];
  const { data: quotes = {}, isSuccess: quotesReady } = useQuery<Record<string, Quote>>({
    queryKey: ["quotes-portfolio-ai", allCodes.join(",")],
    queryFn: async () => { const r = await fetch(`/api/market/quotes?symbols=${allCodes.join(",")}`); return r.json(); },
    enabled: allCodes.length > 0,
    staleTime: 60_000,
  });

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  function buildSystemPrompt() {
    const lines = ["你是一位专业的A股投资顾问，请基于用户的持仓和自选股数据，回答用户的投资问题。分析时结合具体数据，给出有针对性的建议，语言简洁专业。", "", "【当前持仓】"];
    if (positions.length === 0) {
      lines.push("（暂无持仓）");
    } else {
      for (const p of positions) {
        const q = quotes[p.code]; const price = q?.price ?? 0;
        const pnl = price > 0 ? ((price - p.costPrice) * p.amount).toFixed(2) : "未知";
        const pnlPct = price > 0 ? (((price - p.costPrice) / p.costPrice) * 100).toFixed(2) : "未知";
        const chg = q ? `${q.changePercent >= 0 ? "+" : ""}${q.changePercent.toFixed(2)}%` : "未知";
        lines.push(`- ${p.name || p.code}（${p.code}）：成本 ${p.costPrice}，持仓 ${p.amount} 股，现价 ${price || "未知"}，今日 ${chg}，浮盈 ¥${pnl}（${pnlPct}%）`);
      }
    }
    lines.push("", "【自选列表】");
    const watchOnly = watchlist.filter(w => !positions.find(p => p.code === w.code));
    if (watchOnly.length === 0) {
      lines.push("（暂无自选）");
    } else {
      for (const w of watchOnly) {
        const q = quotes[w.code];
        const chg = q ? `${q.changePercent >= 0 ? "+" : ""}${q.changePercent.toFixed(2)}%` : "未知";
        lines.push(`- ${w.name || w.code}（${w.code}）：现价 ${q?.price ?? "未知"}，今日 ${chg}`);
      }
    }
    return lines.join("\n");
  }

  async function sendMsg(text: string) {
    if (!text.trim() || loading) return;
    const userMsg = { role: "user" as const, content: text };
    const next = [...messages, userMsg];
    setMessages([...next, { role: "assistant", content: "" }]);
    setInput(""); setLoading(true);
    const abort = new AbortController(); abortRef.current = abort;
    try {
      await streamChat(next, model, buildSystemPrompt(), abort.signal, text =>
        setMessages(prev => { const u = [...prev]; const last = u[u.length - 1]; if (last?.role === "assistant") u[u.length - 1] = { ...last, content: last.content + text }; return u; })
      );
    } catch (err) {
      if ((err as Error).name !== "AbortError") setMessages(prev => { const u = [...prev]; const last = u[u.length - 1]; if (last?.role === "assistant" && !last.content) u[u.length - 1] = { ...last, content: "请求失败" }; return u; });
    } finally { abortRef.current = null; setLoading(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center" onClick={onClose}>
      <div className="flex h-[85vh] w-full max-w-2xl flex-col rounded-2xl bg-white shadow-2xl sm:h-[680px]" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3">
          <div className="flex items-center gap-2">
            <Bot size={16} className="text-zinc-500" />
            <span className="font-semibold text-zinc-800 text-sm">AI 投资顾问</span>
            <span className="text-xs text-zinc-400">{positions.length} 只持仓 · {watchlist.length} 只自选</span>
          </div>
          <div className="flex items-center gap-2">
            <select value={model} onChange={e => setModel(e.target.value)} className="rounded-md border border-zinc-200 px-2 py-1 text-xs outline-none">
              {MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
            <button type="button" onClick={onClose}><X size={16} className="text-zinc-400" /></button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full gap-4 text-zinc-400">
              <Bot size={36} />
              <p className="text-sm">{quotesReady ? "行情已加载，可以开始提问" : "正在加载行情数据..."}</p>
              <div className="flex flex-wrap justify-center gap-2">
                {PORTFOLIO_QUICK_QUESTIONS.map(q => (
                  <button key={q} type="button" onClick={() => void sendMsg(q)}
                    className="rounded-full border border-zinc-200 px-3 py-1.5 text-xs text-zinc-600 hover:bg-zinc-50 transition">{q}</button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              {m.role === "user"
                ? <div className="max-w-[85%] rounded-2xl bg-zinc-900 px-3 py-2 text-sm text-white">{m.content}</div>
                : <div className="max-w-[90%] rounded-2xl bg-zinc-100 px-4 py-3 text-sm text-zinc-800">
                    {m.content === "" && loading ? <span className="text-zinc-400">思考中...</span> : (
                      <ReactMarkdown components={{
                        p: ({ children }) => <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>,
                        strong: ({ children }) => <strong className="font-semibold text-zinc-900">{children}</strong>,
                        ul: ({ children }) => <ul className="mb-2 ml-4 list-disc space-y-1">{children}</ul>,
                        li: ({ children }) => <li className="leading-relaxed">{children}</li>,
                      }}>{m.content}</ReactMarkdown>
                    )}
                  </div>
              }
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
        <p className="px-4 py-1 text-center text-xs text-zinc-400 border-t border-zinc-50">AI 仅供参考，不构成投资建议</p>
        <div className="flex gap-2 border-t border-zinc-100 px-4 py-3">
          <input value={input} onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && !e.shiftKey && void sendMsg(input)}
            placeholder="问我关于你持仓和自选的任何问题..."
            className="flex-1 rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400" />
          {loading
            ? <button type="button" onClick={() => abortRef.current?.abort()} className="rounded-lg bg-zinc-200 px-3 py-2 text-zinc-700"><Square size={16} /></button>
            : <button type="button" onClick={() => void sendMsg(input)} disabled={!input.trim()} className="rounded-lg bg-zinc-900 px-3 py-2 text-white disabled:opacity-40"><Send size={16} /></button>
          }
        </div>
      </div>
    </div>
  );
}

// ── 新闻 AI 弹窗 ──────────────────────────────────────────
function NewsAiModal({ onClose }: { onClose: () => void }) {
  const [messages, setMessages] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [model, setModel] = useState("deepseek-chat");
  const [newsReady, setNewsReady] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const newsRef = useRef<Record<string, NewsItem[]>>({});

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  useEffect(() => {
    Promise.allSettled(
      (["ths", "em", "sina", "global"] as const).map(s =>
        fetch(`/api/market/news?source=${s}`).then(r => r.json() as Promise<NewsItem[]>).then(data => ({ s, data }))
      )
    ).then(results => {
      for (const r of results) if (r.status === "fulfilled") newsRef.current[r.value.s] = r.value.data;
      setNewsReady(true);
    });
  }, []);

  function buildSystemPrompt() {
    const labels: Record<string, string> = { ths: "同花顺", em: "东方财富", sina: "新浪财经", global: "全球" };
    const lines = ["你是一位专业的财经分析师，请基于以下最新市场新闻，回答用户的问题。分析要结合具体新闻内容，观点简洁有据。", ""];
    for (const [src, label] of Object.entries(labels)) {
      const items = newsRef.current[src] ?? [];
      if (items.length === 0) continue;
      lines.push(`【${label}热点】`);
      items.slice(0, 10).forEach((item, i) => lines.push(`${i + 1}. ${item.title}`));
      lines.push("");
    }
    return lines.join("\n");
  }

  async function sendMsg(text: string) {
    if (!text.trim() || loading) return;
    const userMsg = { role: "user" as const, content: text };
    const next = [...messages, userMsg];
    setMessages([...next, { role: "assistant", content: "" }]);
    setInput(""); setLoading(true);
    const abort = new AbortController(); abortRef.current = abort;
    try {
      await streamChat(next, model, buildSystemPrompt(), abort.signal, chunk =>
        setMessages(prev => { const u = [...prev]; const last = u[u.length - 1]; if (last?.role === "assistant") u[u.length - 1] = { ...last, content: last.content + chunk }; return u; })
      );
    } catch (err) {
      if ((err as Error).name !== "AbortError") setMessages(prev => { const u = [...prev]; const last = u[u.length - 1]; if (last?.role === "assistant" && !last.content) u[u.length - 1] = { ...last, content: "请求失败" }; return u; });
    } finally { abortRef.current = null; setLoading(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center" onClick={onClose}>
      <div className="flex h-[85vh] w-full max-w-2xl flex-col rounded-2xl bg-white shadow-2xl sm:h-[680px]" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3">
          <div className="flex items-center gap-2">
            <Bot size={16} className="text-zinc-500" />
            <span className="font-semibold text-zinc-800 text-sm">新闻 AI 分析</span>
            <span className="text-xs text-zinc-400">{newsReady ? "4个来源已加载" : "加载中..."}</span>
          </div>
          <div className="flex items-center gap-2">
            <select value={model} onChange={e => setModel(e.target.value)} className="rounded-md border border-zinc-200 px-2 py-1 text-xs outline-none">
              {MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
            <button type="button" onClick={onClose}><X size={16} className="text-zinc-400" /></button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full gap-4 text-zinc-400">
              <Bot size={36} />
              <p className="text-sm">{newsReady ? "已聚合4个来源新闻，可以开始提问" : "正在拉取各平台新闻..."}</p>
              <div className="flex flex-wrap justify-center gap-2">
                {NEWS_QUICK_QUESTIONS.map(q => (
                  <button key={q} type="button" onClick={() => void sendMsg(q)} disabled={!newsReady}
                    className="rounded-full border border-zinc-200 px-3 py-1.5 text-xs text-zinc-600 hover:bg-zinc-50 transition disabled:opacity-40">{q}</button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              {m.role === "user"
                ? <div className="max-w-[85%] rounded-2xl bg-zinc-900 px-3 py-2 text-sm text-white">{m.content}</div>
                : <div className="max-w-[90%] rounded-2xl bg-zinc-100 px-4 py-3 text-sm text-zinc-800">
                    {m.content === "" && loading ? <span className="text-zinc-400">思考中...</span> : (
                      <ReactMarkdown components={{
                        p: ({ children }) => <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>,
                        strong: ({ children }) => <strong className="font-semibold text-zinc-900">{children}</strong>,
                        ul: ({ children }) => <ul className="mb-2 ml-4 list-disc space-y-1">{children}</ul>,
                        li: ({ children }) => <li className="leading-relaxed">{children}</li>,
                      }}>{m.content}</ReactMarkdown>
                    )}
                  </div>
              }
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
        <p className="px-4 py-1 text-center text-xs text-zinc-400 border-t border-zinc-50">AI 仅供参考，不构成投资建议</p>
        <div className="flex gap-2 border-t border-zinc-100 px-4 py-3">
          <input value={input} onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && !e.shiftKey && void sendMsg(input)}
            placeholder="基于当前新闻提问..."
            className="flex-1 rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400" />
          {loading
            ? <button type="button" onClick={() => abortRef.current?.abort()} className="rounded-lg bg-zinc-200 px-3 py-2 text-zinc-700"><Square size={16} /></button>
            : <button type="button" onClick={() => void sendMsg(input)} disabled={!input.trim() || !newsReady} className="rounded-lg bg-zinc-900 px-3 py-2 text-white disabled:opacity-40"><Send size={16} /></button>
          }
        </div>
      </div>
    </div>
  );
}

// ── 主布局 ────────────────────────────────────────────────
export default function MainLayout() {
  const [selected, setSelected] = useState<SelectedStock | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [portfolioAiOpen, setPortfolioAiOpen] = useState(false);
  const [newsAiOpen, setNewsAiOpen] = useState(false);
  const [newsSource, setNewsSource] = useState<"ths" | "em" | "sina" | "global">("ths");

  const { data: news = [] } = useQuery<NewsItem[]>({
    queryKey: ["market-news", newsSource],
    queryFn: async () => { const r = await fetch(`/api/market/news?source=${newsSource}`); return r.json(); },
    refetchInterval: newsSource === "global" ? 10 * 60_000 : 60_000,
    staleTime: newsSource === "global" ? 10 * 60_000 : 60_000,
  });

  useEffect(() => {
    if (newsSource === "global") void fetch("/api/market/news-cron");
  }, [newsSource]);

  function handleSelectStock(code: string, quote?: { price: number }) {
    setSelected({ code, currentPrice: quote?.price });
    setChatOpen(true);
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-4 md:flex-row md:gap-6 md:py-6">
      <div className="flex flex-1 flex-col gap-4 min-w-0">
        <PortfolioDashboard onSelectStock={handleSelectStock} />
        <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-base font-semibold text-zinc-800 md:text-lg">自选列表</h2>
          <Watchlist onSelect={handleSelectStock} />
        </div>
      </div>

      <aside className="w-full md:w-64 shrink-0 flex flex-col gap-3">
        <button type="button" onClick={() => setPortfolioAiOpen(true)}
          className="flex items-center justify-center gap-2 w-full rounded-xl bg-zinc-900 py-2.5 text-sm font-medium text-white hover:bg-zinc-700 transition">
          <Bot size={15} />
          AI 分析
        </button>

        {/* 工具入口 */}
        <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
          <p className="mb-3 text-xs font-medium text-zinc-400 uppercase tracking-wide">工具入口</p>
          <div className="flex flex-col gap-1">
            {SIDEBAR_LINKS.map((item) => {
              const Icon = item.icon;
              return (
                <Link key={item.href} href={item.href}>
                  <div className="flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-zinc-50 transition cursor-pointer">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-zinc-100">
                      <Icon size={15} className="text-zinc-600" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-zinc-800">{item.label}</p>
                      <p className="text-xs text-zinc-400">{item.desc}</p>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>

        {/* 市场热点 */}
        <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
          <div className="mb-3">
            <p className="text-xs font-medium text-zinc-400 uppercase tracking-wide mb-2">市场热点</p>
            <div className="flex rounded-lg border border-zinc-100 overflow-hidden text-[11px] w-full">
              {(["ths", "em", "sina", "global"] as const).map(s => (
                <button key={s} type="button" onClick={() => setNewsSource(s)}
                  className={`flex-1 py-1 transition ${newsSource === s ? "bg-zinc-900 text-white" : "text-zinc-400 hover:text-zinc-600"}`}>
                  {s === "ths" ? "同花顺" : s === "em" ? "东方财富" : s === "sina" ? "新浪" : "全球"}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-col divide-y divide-zinc-50 h-80 overflow-y-auto">
            {news.length === 0 && <p className="text-xs text-zinc-400 py-3 text-center">加载中...</p>}
            {news.map((item, i) => (
              <a key={i} href={item.url} target="_blank" rel="noopener noreferrer"
                className="group flex items-start gap-2 py-2.5 -mx-1 px-1 rounded-lg hover:bg-zinc-50 transition">
                <span className="mt-0.5 shrink-0 w-4 text-center text-[10px] font-bold text-zinc-300">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-zinc-700 leading-relaxed line-clamp-2 group-hover:text-zinc-900">{item.title}</p>
                  {item.hot > 0 && <span className="text-[10px] text-rose-400">🔥 {item.hot}</span>}
                </div>
              </a>
            ))}
          </div>
          <button type="button" onClick={() => setNewsAiOpen(true)}
            className="mt-3 flex items-center justify-center gap-1.5 w-full rounded-lg border border-zinc-200 py-2 text-xs text-zinc-500 hover:bg-zinc-50 hover:text-zinc-800 transition">
            <Bot size={12} />
            AI 分析新闻
          </button>
        </div>
      </aside>

      {portfolioAiOpen && <PortfolioAiModal onClose={() => setPortfolioAiOpen(false)} />}
      {newsAiOpen && <NewsAiModal onClose={() => setNewsAiOpen(false)} />}

      {selected && (
        <AiChatModal
          key={selected.code}
          code={selected.code}
          currentPrice={selected.currentPrice}
          open={chatOpen}
          onClose={() => setChatOpen(false)}
        />
      )}
    </div>
  );
}

"use client";

import { MODELS, streamChat } from "@/lib/ai-chat-client";
import { Bot, Send, Square, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";

export type TimelineEvent = {
  date: string;
  time?: string;
  title: string;
  category: string;
  region: string;
  importance: 1 | 2 | 3;
  note?: string;
  source: string;
  url?: string;
};

type Msg = { role: "user" | "assistant"; content: string };

const ALL_QUICK_QUESTIONS = [
  "未来一周最值得关注的事件是哪些？",
  "这些事件对A股有什么影响？",
  "哪些事件可能引发市场波动？",
  "结合日程，下周操作有什么建议？",
];

function fmtEvent(e: TimelineEvent): string {
  const parts = [`${e.date}${e.time ? " " + e.time : ""}`, `[${e.category}/${e.region}]`, e.title];
  if (e.note) parts.push(`（${e.note}）`);
  return parts.join(" ");
}

export default function EventAiModal({
  events,
  scope,
  onClose,
}: {
  events: TimelineEvent[];
  scope: "single" | "all";
  onClose: () => void;
}) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [model, setModel] = useState("deepseek-chat");
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const started = useRef(false);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function buildSystemPrompt() {
    if (scope === "single") {
      const e = events[0];
      return [
        "你是一位专业的财经分析师。请针对下面这个【即将发生的事件】，分析它对相关市场、行业板块、代表性标的的潜在影响、关注要点与风险，并指出投资者应如何应对。观点简洁、有理有据。",
        "",
        `事件：${fmtEvent(e)}`,
      ].join("\n");
    }
    const lines = [
      "你是一位专业的财经分析师。下面是未来一周的重大事件日程，请基于这些事件回答用户的问题，分析整体看点、对A股/美股/相关板块的影响、值得重点关注的日期。观点简洁、结合具体事件。",
      "",
      "【未来一周大事日程】",
    ];
    events.forEach((e, i) => lines.push(`${i + 1}. ${fmtEvent(e)}`));
    return lines.join("\n");
  }

  async function sendMsg(text: string) {
    if (!text.trim() || loading) return;
    const userMsg: Msg = { role: "user", content: text };
    const next = [...messages, userMsg];
    setMessages([...next, { role: "assistant", content: "" }]);
    setInput("");
    setLoading(true);
    const abort = new AbortController();
    abortRef.current = abort;
    try {
      await streamChat(next, model, buildSystemPrompt(), abort.signal, (chunk) =>
        setMessages((prev) => {
          const u = [...prev];
          const last = u[u.length - 1];
          if (last?.role === "assistant") u[u.length - 1] = { ...last, content: last.content + chunk };
          return u;
        })
      );
    } catch (err) {
      if ((err as Error).name !== "AbortError")
        setMessages((prev) => {
          const u = [...prev];
          const last = u[u.length - 1];
          if (last?.role === "assistant" && !last.content) u[u.length - 1] = { ...last, content: "请求失败" };
          return u;
        });
    } finally {
      abortRef.current = null;
      setLoading(false);
    }
  }

  // 单事件模式：打开即自动分析
  useEffect(() => {
    if (scope === "single" && !started.current && events[0]) {
      started.current = true;
      void sendMsg(`请分析「${events[0].title}」这个事件。`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const headerTitle = scope === "single" ? "事件 AI 分析" : "未来大事 AI 分析";
  const headerSub = scope === "single" ? events[0]?.title : `共 ${events.length} 件大事`;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center" onClick={onClose}>
      <div className="flex h-[85vh] w-full max-w-2xl flex-col rounded-2xl bg-white shadow-2xl sm:h-[680px]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <Bot size={16} className="shrink-0 text-zinc-500" />
            <span className="shrink-0 text-sm font-semibold text-zinc-800">{headerTitle}</span>
            <span className="truncate text-xs text-zinc-400">{headerSub}</span>
          </div>
          <div className="flex items-center gap-2">
            <select value={model} onChange={(e) => setModel(e.target.value)} className="rounded-md border border-zinc-200 px-2 py-1 text-xs outline-none">
              {MODELS.map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
            <button type="button" onClick={onClose}><X size={16} className="text-zinc-400" /></button>
          </div>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
          {messages.length === 0 && scope === "all" && (
            <div className="flex h-full flex-col items-center justify-center gap-4 text-zinc-400">
              <Bot size={36} />
              <p className="text-sm">已载入未来一周 {events.length} 件大事，开始提问</p>
              <div className="flex flex-wrap justify-center gap-2">
                {ALL_QUICK_QUESTIONS.map((q) => (
                  <button key={q} type="button" onClick={() => void sendMsg(q)}
                    className="rounded-full border border-zinc-200 px-3 py-1.5 text-xs text-zinc-600 transition hover:bg-zinc-50">{q}</button>
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
                  {m.content === "" && loading ? (
                    <span className="text-zinc-400">思考中...</span>
                  ) : (
                    <ReactMarkdown components={{
                      p: ({ children }) => <p className="mb-2 leading-relaxed last:mb-0">{children}</p>,
                      strong: ({ children }) => <strong className="font-semibold text-zinc-900">{children}</strong>,
                      ul: ({ children }) => <ul className="mb-2 ml-4 list-disc space-y-1">{children}</ul>,
                      li: ({ children }) => <li className="leading-relaxed">{children}</li>,
                    }}>{m.content}</ReactMarkdown>
                  )}
                </div>
              )}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        <p className="border-t border-zinc-50 px-4 py-1 text-center text-xs text-zinc-400">AI 仅供参考，不构成投资建议</p>
        <div className="flex gap-2 border-t border-zinc-100 px-4 py-3">
          <input value={input} onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && void sendMsg(input)}
            placeholder="继续追问..."
            className="flex-1 rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400" />
          {loading ? (
            <button type="button" onClick={() => abortRef.current?.abort()} className="rounded-lg bg-zinc-200 px-3 py-2 text-zinc-700"><Square size={16} /></button>
          ) : (
            <button type="button" onClick={() => void sendMsg(input)} disabled={!input.trim()} className="rounded-lg bg-zinc-900 px-3 py-2 text-white disabled:opacity-40"><Send size={16} /></button>
          )}
        </div>
      </div>
    </div>
  );
}

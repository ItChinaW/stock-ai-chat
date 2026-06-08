"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, CalendarClock, RefreshCw, Sparkles } from "lucide-react";
import dayjs from "dayjs";
import { useState } from "react";
import EventAiModal, { type TimelineEvent } from "./event-ai-modal";

type EventItem = {
  date: string;
  time?: string;
  title: string;
  category: "宏观" | "公司" | "行业" | "综合";
  region: string;
  importance: 1 | 2 | 3;
  note?: string;
  source: string; // calendar | ai | manual | <来源名>
  url?: string;
};

const CAT_STYLE: Record<EventItem["category"], string> = {
  宏观: "bg-blue-50 text-blue-600",
  公司: "bg-violet-50 text-violet-600",
  行业: "bg-emerald-50 text-emerald-600",
  综合: "bg-zinc-100 text-zinc-500",
};

// 重要度 → 节点 / 标题颜色
const DOT_COLOR = ["bg-zinc-300", "bg-zinc-300", "bg-amber-500", "bg-rose-500"];

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

function relDateLabel(date: string): string {
  const d = dayjs(date).startOf("day");
  const diff = d.diff(dayjs().startOf("day"), "day");
  if (diff === 0) return "今天";
  if (diff === 1) return "明天";
  if (diff === 2) return "后天";
  return WEEKDAYS[d.day()];
}

// 无原文链接时，回退到百度资讯搜索，保证点击始终能查到相关报道
function eventLink(ev: EventItem): string {
  return ev.url || `https://www.baidu.com/s?rtt=1&bsst=1&cl=2&tn=news&word=${encodeURIComponent(ev.title)}`;
}

function ImportanceMark({ level }: { level: 1 | 2 | 3 }) {
  if (level < 2) return null;
  return <span className="text-[10px]">{level >= 3 ? "🔥🔥" : "🔥"}</span>;
}

export default function EventTimeline() {
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const [aiTarget, setAiTarget] = useState<{ scope: "single" | "all"; events: TimelineEvent[] } | null>(null);

  const { data = [], isLoading } = useQuery<EventItem[]>({
    queryKey: ["market-events"],
    queryFn: async () => {
      const r = await fetch("/api/market/events");
      const j = await r.json();
      return Array.isArray(j) ? j : [];
    },
    refetchInterval: 30 * 60_000,
    staleTime: 30 * 60_000,
  });

  const { data: aiConfig } = useQuery<{ aiEnabled: boolean }>({
    queryKey: ["ai-config"],
    queryFn: async () => {
      const r = await fetch("/api/ai/config");
      return r.json();
    },
    staleTime: 60_000,
  });
  const aiEnabled = !!aiConfig?.aiEnabled;

  async function handleRefresh() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await fetch("/api/market/events/refresh", { method: "POST" });
      await qc.invalidateQueries({ queryKey: ["market-events"] });
    } finally {
      setRefreshing(false);
    }
  }

  // 按日期分组（接口已按日期升序返回）
  const groups: { date: string; items: EventItem[] }[] = [];
  for (const ev of data) {
    const g = groups.find((x) => x.date === ev.date);
    if (g) g.items.push(ev);
    else groups.push({ date: ev.date, items: [ev] });
  }

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-1.5">
        <CalendarClock size={13} className="text-zinc-400" />
        <p className="text-xs font-medium text-zinc-400 uppercase tracking-wide">未来一周大事</p>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={refreshing}
          title="刷新事件"
          className="ml-auto text-zinc-300 transition hover:text-zinc-600 disabled:opacity-50"
        >
          <RefreshCw size={12} className={refreshing ? "animate-spin" : ""} />
        </button>
      </div>

      {isLoading && <p className="py-3 text-center text-xs text-zinc-400">加载中...</p>}

      {!isLoading && groups.length === 0 && (
        <p className="py-3 text-center text-xs text-zinc-400">暂无重大事件预告</p>
      )}

      {groups.length > 0 && (
        <div className="relative max-h-96 overflow-y-auto pl-4">
          {/* 时间线主轴 */}
          <div className="absolute bottom-1 left-[3px] top-1.5 w-px bg-zinc-100" />

          {groups.map((g) => {
            const maxImp = Math.max(...g.items.map((e) => e.importance)) as 1 | 2 | 3;
            return (
              <div key={g.date} className="mb-3 last:mb-0">
                {/* 日期节点 */}
                <div className="relative mb-1.5 flex items-baseline gap-2">
                  <span
                    className={`absolute -left-4 top-1 h-[7px] w-[7px] rounded-full ring-2 ring-white ${DOT_COLOR[maxImp]}`}
                  />
                  <span className="text-xs font-semibold text-zinc-700">{relDateLabel(g.date)}</span>
                  <span className="text-[10px] text-zinc-400">{dayjs(g.date).format("M/D")}</span>
                </div>

                {/* 当日事件 */}
                <div className="flex flex-col gap-1">
                  {g.items.map((ev, i) => (
                    <div key={i} className="group/item rounded-lg px-2 py-1.5 -mx-1 transition hover:bg-zinc-50">
                      <div className="flex items-start gap-1.5">
                        <span className={`mt-0.5 shrink-0 rounded px-1 py-px text-[10px] ${CAT_STYLE[ev.category]}`}>
                          {ev.category}
                        </span>
                        <a
                          href={eventLink(ev)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex-1 text-xs leading-relaxed text-zinc-700 transition hover:text-zinc-900 hover:underline decoration-zinc-300 underline-offset-2"
                        >
                          {ev.title}
                          {ev.importance >= 2 && <ImportanceMark level={ev.importance} />}
                        </a>
                        {aiEnabled && (
                          <button
                            type="button"
                            onClick={() => setAiTarget({ scope: "single", events: [ev] })}
                            title="AI 分析此事件"
                            className="mt-0.5 shrink-0 text-zinc-300 transition hover:text-violet-500"
                          >
                            <Sparkles size={12} />
                          </button>
                        )}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 pl-0.5 text-[10px] text-zinc-400">
                        {ev.time && <span className="font-medium text-zinc-500">{ev.time}</span>}
                        <span>{ev.region}</span>
                        {ev.source === "manual" && <span className="text-amber-500">精选</span>}
                        {ev.note && <span className="text-zinc-400">· {ev.note}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {aiEnabled && groups.length > 0 && (
        <button
          type="button"
          onClick={() => setAiTarget({ scope: "all", events: data })}
          className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-zinc-200 py-2 text-xs text-zinc-500 transition hover:bg-zinc-50 hover:text-zinc-800"
        >
          <Bot size={12} />
          AI 分析全部大事
        </button>
      )}

      {!isLoading && (
        <p className="mt-3 border-t border-zinc-50 pt-2 text-[10px] leading-relaxed text-zinc-300">
          来源：财经日历(金十) · 华尔街见闻 · 同花顺/东财/新浪 · 全球RSS · AI归纳 + 人工精选
        </p>
      )}

      {aiTarget && <EventAiModal events={aiTarget.events} scope={aiTarget.scope} onClose={() => setAiTarget(null)} />}
    </div>
  );
}

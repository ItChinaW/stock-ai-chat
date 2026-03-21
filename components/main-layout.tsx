"use client";

import { BarChart2, BookOpen, FlaskConical } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import AiChatModal from "./ai-chat-modal";
import PortfolioDashboard from "./portfolio-dashboard";
import Watchlist from "./watchlist";

type SelectedStock = { code: string; currentPrice?: number };

const SIDEBAR_LINKS = [
  { href: "/backtest", icon: BarChart2, label: "回测广场", desc: "验证你的交易策略" },
  { href: "/paper-trading", icon: FlaskConical, label: "模拟交易", desc: "策略实盘模拟演练" },
  { href: "https://github.com", icon: BookOpen, label: "策略文档", desc: "学习量化策略知识", external: true },
];

export default function MainLayout() {
  const [selected, setSelected] = useState<SelectedStock | null>(null);
  const [chatOpen, setChatOpen] = useState(false);

  function handleSelectStock(code: string, quote?: { price: number }) {
    setSelected({ code, currentPrice: quote?.price });
    setChatOpen(true);
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-4 md:flex-row md:gap-6 md:py-6">
      <div className="flex flex-1 flex-col gap-4 min-w-0">
        <PortfolioDashboard onSelectStock={handleSelectStock} />
        {/* 自选列表：去掉额外 padding，与持仓区宽度一致 */}
        <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-base font-semibold text-zinc-800 md:text-lg">自选列表</h2>
          <Watchlist onSelect={handleSelectStock} />
        </div>
      </div>

      {/* 右侧固定入口 */}
      <aside className="w-full md:w-64 shrink-0 flex flex-col gap-3">
        {selected && (
          <button type="button" onClick={() => setChatOpen(true)}
            className="w-full rounded-xl bg-zinc-900 py-2.5 text-sm font-medium text-white hover:bg-zinc-700">
            与 AI 分析 {selected.code}
          </button>
        )}

        <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
          <p className="mb-3 text-xs font-medium text-zinc-400 uppercase tracking-wide">工具入口</p>
          <div className="flex flex-col gap-1">
            {SIDEBAR_LINKS.map((item) => {
              const Icon = item.icon;
              const inner = (
                <div className="flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-zinc-50 transition cursor-pointer">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-zinc-100">
                    <Icon size={15} className="text-zinc-600" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-zinc-800">{item.label}</p>
                    <p className="text-xs text-zinc-400">{item.desc}</p>
                  </div>
                </div>
              );
              return item.external
                ? <a key={item.href} href={item.href} target="_blank" rel="noreferrer">{inner}</a>
                : <Link key={item.href} href={item.href}>{inner}</Link>;
            })}
          </div>
        </div>
      </aside>

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

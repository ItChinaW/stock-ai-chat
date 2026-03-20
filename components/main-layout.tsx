"use client";

import { useState } from "react";
import AiChatModal from "./ai-chat-modal";
import PortfolioDashboard from "./portfolio-dashboard";
import Watchlist from "./watchlist";
import WinRateSidebar from "./win-rate-sidebar";

type SelectedStock = {
  code: string;
  currentPrice?: number;
};

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
        <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-base font-semibold text-zinc-800 md:text-lg">自选列表</h2>
          <Watchlist onSelect={handleSelectStock} />
        </section>
      </div>

      {selected && (
        <aside className="w-full md:w-72 shrink-0 flex flex-col gap-4">
          <WinRateSidebar code={selected.code} />
          <button
            type="button"
            onClick={() => setChatOpen(true)}
            className="w-full rounded-xl bg-zinc-900 py-2.5 text-sm font-medium text-white hover:bg-zinc-700"
          >
            与 AI 分析 {selected.code}
          </button>
        </aside>
      )}

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

"use client";

import { useQuery } from "@tanstack/react-query";
import dayjs from "dayjs";
import { TrendingDown, TrendingUp } from "lucide-react";

type IndexData = {
  key: string;
  label: string;
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  currency?: string;
};

type IndicesResponse = {
  updatedAt: string;
  indices: IndexData[];
};

async function fetchIndices(): Promise<IndicesResponse> {
  const response = await fetch("/api/market/indices");
  if (!response.ok) throw new Error("Failed to fetch indices");
  return response.json() as Promise<IndicesResponse>;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  }).format(value);
}

export default function MarketMarquee() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["market-indices"],
    queryFn: fetchIndices,
    refetchInterval: 60_000,
  });

  return (
    <header className="w-full border-b border-zinc-200 bg-white">
      <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm">
        <span className="shrink-0 font-semibold text-zinc-800">全球指数</span>
        {isLoading && <span className="text-zinc-500">加载中...</span>}
        {isError && <span className="text-rose-600">行情服务暂时不可用</span>}
        {data?.indices && (
          <div className="flex flex-wrap items-center gap-2">
            {data.indices.map((item) => {
              const positive = item.changePercent >= 0;
              return (
                <span
                  key={item.key}
                  className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2.5 py-1 text-xs"
                >
                  <strong className="shrink-0 text-zinc-800">{item.label}</strong>
                  <span className="text-zinc-700">{formatNumber(item.price)}</span>
                  <span
                    className={`inline-flex shrink-0 items-center gap-0.5 font-medium ${
                      positive ? "text-emerald-600" : "text-rose-600"
                    }`}
                  >
                    {positive ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                    {positive ? "+" : ""}
                    {item.changePercent.toFixed(2)}%
                  </span>
                </span>
              );
            })}
          </div>
        )}
        <span suppressHydrationWarning className="ml-auto shrink-0 text-xs text-zinc-400">
          {dayjs(data?.updatedAt).isValid() ? dayjs(data?.updatedAt).format("HH:mm:ss") : "--:--:--"}
        </span>
      </div>
    </header>
  );
}

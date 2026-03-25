import { fetchYahooQuotes } from "@/lib/market";
import { NextResponse } from "next/server";

const TRACKED_INDICES = [
  { key: "sse",     label: "上证指数",    symbol: "sh000001" },
  { key: "szse",    label: "深证成指",    symbol: "sz399001" },
  { key: "nasdaq",  label: "纳斯达克",    symbol: "gb_ixic" },
  { key: "sp500",   label: "标普500",     symbol: "gb_inx" },
  { key: "dji",     label: "道琼斯",      symbol: "gb_dji" },
  { key: "hsi",     label: "恒生指数",    symbol: "hf_HSI" },
  { key: "gold",    label: "纽约黄金",    symbol: "hf_GC" },
  { key: "oil",     label: "纽约原油",    symbol: "hf_CL" },
  { key: "gas",     label: "美国天然气",  symbol: "hf_NG" },
  { key: "silver",  label: "纽约白银",    symbol: "hf_SI" },
  { key: "usdcny",  label: "美元/人民币", symbol: "fx_susdcny" },
];

export async function GET() {
  try {
    const quotes = await fetchYahooQuotes(TRACKED_INDICES.map((item) => item.symbol));
    const quoteMap = new Map(quotes.map((item) => [item.symbol, item]));

    const indices = TRACKED_INDICES.map((index) => {
      const quote = quoteMap.get(index.symbol);
      return {
        ...index,
        price: quote?.price ?? 0,
        change: quote?.change ?? 0,
        changePercent: quote?.changePercent ?? 0,
        currency: quote?.currency ?? "USD",
      };
    });

    return NextResponse.json({
      updatedAt: new Date().toISOString(),
      indices,
    });
  } catch (error) {
    console.error("[indices] error:", error);
    return NextResponse.json(
      {
        message: "Failed to fetch market indices",
        error: error instanceof Error ? error.message : "Unknown error",
        stack: error instanceof Error ? error.stack : undefined,
      },
      { status: 500 },
    );
  }
}

import { fetchYahooQuotes } from "@/lib/market";
import { NextResponse } from "next/server";

const TRACKED_INDICES = [
  { key: "nasdaq", label: "纳斯达克", symbol: ".IXIC" },
  { key: "sse",    label: "上证指数", symbol: "sh000001" },
  { key: "szse",   label: "深证成指", symbol: "sz399001" },
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
    return NextResponse.json(
      {
        message: "Failed to fetch market indices",
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}

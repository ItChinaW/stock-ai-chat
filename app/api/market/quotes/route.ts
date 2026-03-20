import { fetchYahooQuotes } from "@/lib/market";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const symbolsParam = request.nextUrl.searchParams.get("symbols") ?? "";
  const symbols = symbolsParam
    .split(",")
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);

  if (symbols.length === 0) {
    return NextResponse.json({});
  }

  try {
    const quotes = await fetchYahooQuotes(symbols);
    const map = Object.fromEntries(
      quotes.map((item) => [
        item.symbol.toUpperCase(),
        {
          symbol: item.symbol.toUpperCase(),
          name: item.name,
          price: item.price,
          change: item.change,
          changePercent: item.changePercent,
          previousClose: item.previousClose,
          currency: item.currency,
          marketState: item.marketState,
        },
      ]),
    );
    return NextResponse.json(map);
  } catch (error) {
    return NextResponse.json(
      {
        message: "Failed to fetch quotes",
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}

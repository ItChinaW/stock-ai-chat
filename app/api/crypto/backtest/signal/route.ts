import { getLatestSignal, runEngine } from "@/lib/backtest-engine";
import { getKlines } from "@/lib/binance";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const symbol = searchParams.get("symbol") ?? "";
  const strategyCode = searchParams.get("strategyCode") ?? "ma_cross";
  const paramsStr = searchParams.get("params") ?? "{}";
  const initCapital = Number(searchParams.get("initCapital") ?? "10000");
  const mode = (searchParams.get("mode") ?? "compound") as "simple" | "compound";

  if (!symbol) return NextResponse.json({ error: "symbol required" }, { status: 400 });

  try {
    const candles = await getKlines(symbol, "1d", 300);
    if (candles.length < 10) return NextResponse.json({ error: "数据不足" }, { status: 400 });

    const params = { atrPeriod: 14, atrMult: 2, ...JSON.parse(paramsStr) as Record<string, number> };
    const liveSignal = getLatestSignal(candles, strategyCode, params);
    const result = runEngine(candles, strategyCode, params, initCapital, mode);
    const recentTrades = result.trades.slice(-5).reverse();

    return NextResponse.json({ liveSignal, recentTrades });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "error" }, { status: 500 });
  }
}

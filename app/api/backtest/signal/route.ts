import { getLatestSignal, runEngine } from "@/lib/backtest-engine";
import { isOverseasSymbol, toSinaSymbol, fetchYahooKlineRecent } from "@/lib/market";
import { NextRequest, NextResponse } from "next/server";

async function fetchCandles(symbol: string) {
  // 海外股票走 Yahoo Finance
  if (isOverseasSymbol(symbol)) {
    return fetchYahooKlineRecent(symbol, 300);
  }

  const sinaSymbol = toSinaSymbol(symbol);
  const url = `https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=${sinaSymbol}&scale=240&ma=no&datalen=300`;

  const res = await fetch(url, {
    headers: { Referer: "https://finance.sina.com.cn" },
    next: { revalidate: 300 },
  });
  const json = await res.json() as { day: string; open: string; high: string; low: string; close: string; volume: string }[];
  return (Array.isArray(json) ? json : []).map((item) => ({
    time: item.day,
    open: +item.open,
    high: +item.high,
    low: +item.low,
    close: +item.close,
    volume: +item.volume,
  }));
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const symbol = searchParams.get("symbol") ?? "";
  const strategyCode = searchParams.get("strategyCode") ?? "ma_cross";
  const paramsStr = searchParams.get("params") ?? "{}";
  const initCapital = Number(searchParams.get("initCapital") ?? "100000");
  const mode = (searchParams.get("mode") ?? "compound") as "simple" | "compound";

  if (!symbol) return NextResponse.json({ error: "symbol required" }, { status: 400 });

  try {
    const candles = await fetchCandles(symbol);
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

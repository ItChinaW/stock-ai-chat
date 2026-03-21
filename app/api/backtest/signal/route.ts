import { getLatestSignal, runEngine } from "@/lib/backtest-engine";
import { NextRequest, NextResponse } from "next/server";

function toSinaCode(symbol: string): string {
  if (/^(sh|sz)\d+$/.test(symbol)) return symbol;
  if (/^\d{6}$/.test(symbol)) {
    const isSH = symbol.startsWith("6") || symbol.startsWith("5") || symbol.startsWith("11");
    return `${isSH ? "sh" : "sz"}${symbol}`;
  }
  return symbol;
}

async function fetchCandles(symbol: string) {
  const sinaCode = toSinaCode(symbol);
  const url = `https://quotes.sina.cn/cn/api/jsonp_v2.php/var%20_kline=/CN_MarketDataService.getKLineData?symbol=${sinaCode}&scale=240&datalen=300`;
  const res = await fetch(url, {
    headers: { Referer: "https://finance.sina.com.cn" },
    next: { revalidate: 300 },
  });
  const text = await res.text();
  const m = text.match(/\(\[(.*)\]\)/s);
  if (!m) return [];
  const raw = JSON.parse(`[${m[1]}]`) as { day: string; open: string; high: string; low: string; close: string; volume: string }[];
  return raw.map(d => ({ time: d.day, open: +d.open, high: +d.high, low: +d.low, close: +d.close, volume: +d.volume }));
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

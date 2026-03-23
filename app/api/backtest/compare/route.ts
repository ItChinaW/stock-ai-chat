import { runEngine, STRATEGY_DEFS } from "@/lib/backtest-engine";
import { toSinaSymbol } from "@/lib/market";
import { NextRequest, NextResponse } from "next/server";

async function fetchCandles(symbol: string, startDate: string, endDate: string) {
  const sinaSymbol = toSinaSymbol(symbol);
  const url = `https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=${sinaSymbol}&scale=240&ma=no&datalen=1000`;
  const res = await fetch(url, { headers: { Referer: "https://finance.sina.com.cn" } });
  const json = await res.json() as { day: string; open: string; high: string; low: string; close: string; volume: string }[];
  return (Array.isArray(json) ? json : [])
    .map((item) => ({ time: item.day, open: +item.open, high: +item.high, low: +item.low, close: +item.close, volume: +item.volume }))
    .filter((d) => d.time >= startDate && d.time <= endDate);
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const symbol = searchParams.get("symbol") ?? "";
  const startDate = searchParams.get("startDate") ?? "";
  const endDate = searchParams.get("endDate") ?? "";
  const initCapital = Number(searchParams.get("initCapital") ?? "100000");
  const mode = (searchParams.get("mode") ?? "compound") as "simple" | "compound";

  if (!symbol || !startDate || !endDate) {
    return NextResponse.json({ error: "missing params" }, { status: 400 });
  }

  try {
    const candles = await fetchCandles(symbol, startDate, endDate);
    if (candles.length < 10) return NextResponse.json({ error: "数据不足" }, { status: 400 });

    const results = STRATEGY_DEFS.map((def) => {
      const defaultParams: Record<string, number> = { atrPeriod: 14, atrMult: 2 };
      def.params.forEach((p) => { defaultParams[p.key] = p.default; });
      try {
        const r = runEngine(candles, def.code, defaultParams, initCapital, mode);
        return {
          code: def.code,
          label: def.label,
          totalReturn: r.totalReturn,
          annualReturn: r.annualReturn,
          maxDrawdown: r.maxDrawdown,
          sharpe: r.sharpe,
          winRate: r.winRate,
          tradeCount: r.tradeCount,
        };
      } catch {
        return { code: def.code, label: def.label, totalReturn: 0, annualReturn: 0, maxDrawdown: 0, sharpe: 0, winRate: 0, tradeCount: 0 };
      }
    });

    return NextResponse.json({ results });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "error" }, { status: 500 });
  }
}

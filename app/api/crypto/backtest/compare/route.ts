import { getKlines } from "@/lib/binance";
import { runEngine, STRATEGY_DEFS } from "@/lib/backtest-engine";
import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const symbol = searchParams.get("symbol") ?? "";
  const interval = searchParams.get("interval") ?? "1d";
  const startDate = searchParams.get("startDate") ?? "";
  const endDate = searchParams.get("endDate") ?? "";
  const initCapital = Number(searchParams.get("initCapital") ?? "10000");
  const mode = (searchParams.get("mode") ?? "compound") as "simple" | "compound";

  if (!symbol || !startDate || !endDate) {
    return NextResponse.json({ error: "missing params" }, { status: 400 });
  }

  try {
    const allCandles = await getKlines(symbol, interval, 1000);
    const candles = allCandles.filter(c => c.time >= startDate && c.time <= endDate);
    if (candles.length < 10) return NextResponse.json({ error: "数据不足" }, { status: 400 });

    const results = STRATEGY_DEFS.map((def) => {
      const defaultParams: Record<string, number> = { atrPeriod: 14, atrMult: 2 };
      def.params.forEach((p) => { defaultParams[p.key] = p.default; });
      try {
        const r = runEngine(candles, def.code, defaultParams, initCapital, mode);
        return { code: def.code, label: def.label, totalReturn: r.totalReturn, annualReturn: r.annualReturn, maxDrawdown: r.maxDrawdown, sharpe: r.sharpe, winRate: r.winRate, tradeCount: r.tradeCount };
      } catch {
        return { code: def.code, label: def.label, totalReturn: 0, annualReturn: 0, maxDrawdown: 0, sharpe: 0, winRate: 0, tradeCount: 0 };
      }
    });

    return NextResponse.json({ results });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "error" }, { status: 500 });
  }
}

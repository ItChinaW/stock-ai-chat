import { runEngine } from "@/lib/backtest-engine";
import { getKlinesByRange } from "@/lib/binance";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const record = await prisma.paperTrade.findFirst({ where: { id: Number(id), userId: 1 } });
  if (!record) return NextResponse.json({ error: "not found" }, { status: 404 });

  // name 字段存了 interval 和 params
  let interval = "1d";
  let savedParams: Record<string, number> = {};
  try {
    const meta = JSON.parse(record.name) as { interval?: string; params?: Record<string, number> };
    interval = meta.interval ?? "1d";
    savedParams = meta.params ?? {};
  } catch { /* name 不是 JSON，忽略 */ }

  // URL 参数可覆盖策略参数
  const urlParams: Record<string, number> = {};
  req.nextUrl.searchParams.forEach((v, k) => {
    if (k !== "interval") { const n = parseFloat(v); if (!isNaN(n)) urlParams[k] = n; }
  });
  const mergedParams = { ...savedParams, ...urlParams };

  try {
    const today = new Date().toISOString().slice(0, 10);
    const candles = await getKlinesByRange(record.symbol, interval, record.startDate, today);

    if (candles.length >= 10) {
      const result = runEngine(candles, record.strategyCode, mergedParams, record.initCapital, "compound");
      const lastEquity = result.equityCurve[result.equityCurve.length - 1];
      const currentValue = lastEquity?.value ?? record.initCapital;
      const totalPnl = currentValue - record.initCapital;
      const totalReturn = totalPnl / record.initCapital;

      // 只在无自定义参数时持久化
      if (Object.keys(urlParams).length === 0) {
        await prisma.paperTrade.update({
          where: { id: record.id },
          data: {
            currentValue, totalPnl, totalReturn,
            inPosition: result.inPosition ?? false,
            entryPrice: result.entryPrice ?? null,
            tradeCount: result.tradeCount,
            trades: JSON.stringify(result.trades),
          },
        });
      }

      return NextResponse.json({
        ...record,
        currentValue, totalPnl, totalReturn,
        inPosition: result.inPosition ?? false,
        entryPrice: result.entryPrice ?? null,
        tradeCount: result.tradeCount,
        trades: JSON.stringify(result.trades),
        equityCurve: result.equityCurve,
        interval,
      });
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "计算失败" }, { status: 500 });
  }

  return NextResponse.json(record);
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  await prisma.paperTrade.deleteMany({ where: { id: Number(id), userId: 1 } });
  return new NextResponse(null, { status: 204 });
}

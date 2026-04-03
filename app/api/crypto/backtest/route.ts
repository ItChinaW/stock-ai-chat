import { runEngine } from "@/lib/backtest-engine";
import { getKlines } from "@/lib/binance";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

async function runBacktest(id: number) {
  const record = await prisma.backtest.findUnique({ where: { id } });
  if (!record) return;
  await prisma.backtest.update({ where: { id }, data: { status: "running" } });
  try {
    const interval = record.interval ?? "1d";
    const allCandles = await getKlines(record.symbol, interval, 1000);
    const candles = allCandles.filter(c => c.time >= record.startDate && c.time <= record.endDate);
    if (candles.length < 10) throw new Error("数据不足，请检查交易对或日期范围");

    const params = JSON.parse(record.params) as Record<string, number>;
    const result = runEngine(candles, record.strategyCode, params, record.initCapital, record.mode as "simple" | "compound");

    await prisma.backtest.update({
      where: { id },
      data: {
        status: "done",
        totalReturn: result.totalReturn, totalPnl: result.totalPnl,
        annualReturn: result.annualReturn, maxDrawdown: result.maxDrawdown,
        tradeCount: result.tradeCount, winRate: result.winRate,
        sharpe: result.sharpe, sortino: result.sortino, calmar: result.calmar,
        avgHoldDays: result.avgHoldDays, avgWin: result.avgWin, avgLoss: result.avgLoss,
        profitFactor: result.profitFactor,
        equityCurve: JSON.stringify(result.equityCurve),
        trades: JSON.stringify(result.trades),
      },
    });
  } catch (err) {
    await prisma.backtest.update({
      where: { id },
      data: { status: "error", errorMsg: err instanceof Error ? err.message : "未知错误" },
    });
  }
}

export async function GET() {
  // 只返回加密货币回测（symbol 包含 USDT/BTC/ETH 等）
  const list = await prisma.backtest.findMany({
    where: { userId: 1, symbol: { contains: "USDT" } },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(list);
}

export async function POST(request: NextRequest) {
  const body = await request.json() as {
    symbol: string; strategyCode: string; params?: Record<string, number>;
    interval?: string; startDate: string; endDate: string; initCapital?: number; mode?: string;
  };

  const record = await prisma.backtest.create({
    data: {
      userId: 1,
      name: body.symbol,
      symbol: body.symbol.toUpperCase(),
      strategyCode: body.strategyCode,
      params: JSON.stringify(body.params ?? {}),
      interval: body.interval ?? "1d",
      startDate: body.startDate,
      endDate: body.endDate,
      initCapital: body.initCapital ?? 10000,
      mode: body.mode ?? "compound",
      status: "pending",
    },
  });

  void runBacktest(record.id);
  return NextResponse.json(record, { status: 201 });
}

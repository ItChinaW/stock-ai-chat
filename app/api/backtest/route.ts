import { runEngine } from "@/lib/backtest-engine";
import { isOverseasSymbol, toSinaSymbol, fetchYahooKline } from "@/lib/market";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

async function fetchDailyCandles(symbol: string, startDate: string, endDate: string) {
  // 海外股票走 Yahoo Finance
  if (isOverseasSymbol(symbol)) {
    return fetchYahooKline(symbol, startDate, endDate);
  }

  const sinaSymbol = toSinaSymbol(symbol);
  const url = `https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=${sinaSymbol}&scale=240&ma=no&datalen=1000`;

  const res = await fetch(url, { headers: { Referer: "https://finance.sina.com.cn" } });
  const json = await res.json() as { day: string; open: string; high: string; low: string; close: string; volume: string }[];

  return (Array.isArray(json) ? json : [])
    .map((item) => ({
      time: item.day,
      open: +item.open,
      high: +item.high,
      low: +item.low,
      close: +item.close,
      volume: +item.volume,
    }))
    .filter((d) => d.time >= startDate && d.time <= endDate);
}

async function runBacktest(id: number) {
  const record = await prisma.backtest.findUnique({ where: { id } });
  if (!record) return;

  await prisma.backtest.update({ where: { id }, data: { status: "running" } });

  try {
    const candles = await fetchDailyCandles(record.symbol, record.startDate, record.endDate);
    if (candles.length < 10) throw new Error("数据不足，请检查股票代码或日期范围");

    const params = JSON.parse(record.params) as Record<string, number>;
    const result = runEngine(candles, record.strategyCode, params, record.initCapital, record.mode as "simple" | "compound");

    await prisma.backtest.update({
      where: { id },
      data: {
        status: "done",
        totalReturn: result.totalReturn,
        totalPnl: result.totalPnl,
        annualReturn: result.annualReturn,
        maxDrawdown: result.maxDrawdown,
        tradeCount: result.tradeCount,
        winRate: result.winRate,
        sharpe: result.sharpe,
        sortino: result.sortino,
        calmar: result.calmar,
        avgHoldDays: result.avgHoldDays,
        avgWin: result.avgWin,
        avgLoss: result.avgLoss,
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
  const list = await prisma.backtest.findMany({
    where: { userId: 1 },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(list);
}

export async function POST(request: NextRequest) {
  const body = await request.json() as {
    name: string;
    symbol: string;
    strategyCode: string;
    params?: Record<string, number>;
    startDate: string;
    endDate: string;
    initCapital?: number;
    mode?: string;
  };

  const record = await prisma.backtest.create({
    data: {
      userId: 1,
      name: body.name || `${body.symbol} 回测`,
      symbol: body.symbol,
      strategyCode: body.strategyCode,
      params: JSON.stringify(body.params ?? {}),
      startDate: body.startDate,
      endDate: body.endDate,
      initCapital: body.initCapital ?? 100000,
      mode: body.mode ?? "compound",
      status: "pending",
    },
  });

  void runBacktest(record.id);

  return NextResponse.json(record, { status: 201 });
}

import { getCurrentUserId } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runEngine } from "@/lib/backtest-engine";
import { NextRequest, NextResponse } from "next/server";

type Params = { params: Promise<{ id: string }> };

// 获取单条模拟交易详情，并用最新行情刷新状态
export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const userId = await getCurrentUserId();
  const record = await prisma.paperTrade.findFirst({
    where: { id: Number(id), userId },
  });
  if (!record) return NextResponse.json({ error: "not found" }, { status: 404 });

  // 拉取最新 K 线，重新跑策略引擎得到最新状态
  try {
    const today = new Date().toISOString().slice(0, 10);
    const klineUrl = `https://quotes.sina.cn/cn/api/jsonp_v2.php/var%20_${record.symbol}=/CN_MarketDataService.getKLineData?symbol=${record.symbol}&scale=240&ma=no&datalen=250`;
    const res = await fetch(klineUrl, { headers: { Referer: "https://finance.sina.com.cn" } });
    const text = await res.text();
    const m = text.match(/\(\[(.*)\]\)/s);
    if (m) {
      type RawCandle = { day: string; open: string; high: string; low: string; close: string; volume: string };
      const raw = JSON.parse(`[${m[1]}]`) as RawCandle[];
      const candles = raw
        .filter((c) => c.day >= record.startDate && c.day <= today)
        .map((c) => ({
          date: c.day,
          open: parseFloat(c.open),
          high: parseFloat(c.high),
          low: parseFloat(c.low),
          close: parseFloat(c.close),
          volume: parseFloat(c.volume),
        }));

      if (candles.length >= 5) {
        const result = runEngine(candles, record.strategyCode, {}, record.initCapital, "compound");
        const lastEquity = result.equityCurve[result.equityCurve.length - 1];
        const currentValue = lastEquity?.value ?? record.initCapital;
        const totalPnl = currentValue - record.initCapital;
        const totalReturn = totalPnl / record.initCapital;

        const updated = await prisma.paperTrade.update({
          where: { id: record.id },
          data: {
            currentValue,
            totalPnl,
            totalReturn,
            inPosition: result.inPosition ?? false,
            entryPrice: result.entryPrice ?? null,
            tradeCount: result.tradeCount,
            trades: JSON.stringify(result.trades),
          },
        });
        return NextResponse.json(updated);
      }
    }
  } catch { /* 行情获取失败，返回缓存数据 */ }

  return NextResponse.json(record);
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const userId = await getCurrentUserId();
  await prisma.paperTrade.deleteMany({ where: { id: Number(id), userId } });
  return new NextResponse(null, { status: 204 });
}

import { getCurrentUserId } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runEngine } from "@/lib/backtest-engine";
import { toSinaSymbol } from "@/lib/market";
import { NextRequest, NextResponse } from "next/server";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const userId = await getCurrentUserId();
  const record = await prisma.paperTrade.findFirst({
    where: { id: Number(id), userId },
  });
  if (!record) return NextResponse.json({ error: "not found" }, { status: 404 });

  const searchParams = req.nextUrl.searchParams;
  const customParams: Record<string, number> = {};
  searchParams.forEach((v, k) => {
    const n = parseFloat(v);
    if (!isNaN(n)) customParams[k] = n;
  });

  try {
    const today = new Date().toISOString().slice(0, 10);
    const sinaSymbol = toSinaSymbol(record.symbol);
    const url = `https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=${sinaSymbol}&scale=240&ma=no&datalen=500`;

    const res = await fetch(url, { headers: { Referer: "https://finance.sina.com.cn" } });
    const json = await res.json() as { day: string; open: string; high: string; low: string; close: string; volume: string }[];

    const candles = (Array.isArray(json) ? json : [])
      .map((item) => ({
        date: item.day,
        time: item.day,
        open: +item.open,
        high: +item.high,
        low: +item.low,
        close: +item.close,
        volume: +item.volume,
      }))
      .filter((c) => c.time >= record.startDate && c.time <= today);

    if (candles.length >= 5) {
      const result = runEngine(candles, record.strategyCode, customParams, record.initCapital, "compound");
      const lastEquity = result.equityCurve[result.equityCurve.length - 1];
      const currentValue = lastEquity?.value ?? record.initCapital;
      const totalPnl = currentValue - record.initCapital;
      const totalReturn = totalPnl / record.initCapital;

      if (Object.keys(customParams).length === 0) {
        await prisma.paperTrade.update({
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
      }

      return NextResponse.json({
        ...record,
        currentValue,
        totalPnl,
        totalReturn,
        inPosition: result.inPosition ?? false,
        entryPrice: result.entryPrice ?? null,
        tradeCount: result.tradeCount,
        trades: JSON.stringify(result.trades),
        equityCurve: result.equityCurve,
      });
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

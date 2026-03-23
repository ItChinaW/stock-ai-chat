import { getKlines, marketBuy, marketSell } from "@/lib/binance";
import { getLatestSignal } from "@/lib/backtest-engine";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

type Params = { params: Promise<{ id: string }> };

// PATCH: 启动/停止/手动触发检查
export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = await req.json() as { action: "start" | "stop" | "check" };
  const bot = await prisma.cryptoBot.findFirst({ where: { id: Number(id), userId: 1 } });
  if (!bot) return NextResponse.json({ error: "not found" }, { status: 404 });

  if (body.action === "start") {
    await prisma.cryptoBot.update({ where: { id: bot.id }, data: { status: "running" } });
    return NextResponse.json({ ok: true, status: "running" });
  }
  if (body.action === "stop") {
    await prisma.cryptoBot.update({ where: { id: bot.id }, data: { status: "stopped" } });
    return NextResponse.json({ ok: true, status: "stopped" });
  }

  if (body.action === "check") {
    return runCheck(bot);
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  await prisma.cryptoBot.deleteMany({ where: { id: Number(id), userId: 1 } });
  return new NextResponse(null, { status: 204 });
}

async function runCheck(bot: { id: number; symbol: string; strategyCode: string; params: string; interval: string; quoteQty: number; inPosition: boolean; entryPrice: number | null }) {
  try {
    const candles = await getKlines(bot.symbol, bot.interval, 300);
    if (candles.length < 20) return NextResponse.json({ error: "数据不足" }, { status: 400 });

    const p = JSON.parse(bot.params) as Record<string, number>;
    const signal = getLatestSignal(candles, bot.strategyCode, p);

    let action = "hold";
    let orderResult: unknown = null;

    if (signal.signal === "buy" && !bot.inPosition) {
      // 买入
      orderResult = await marketBuy(bot.symbol, bot.quoteQty);
      const order = orderResult as { fills?: { price: string; qty: string }[]; executedQty: string; cummulativeQuoteQty: string };
      const avgPrice = order.fills?.length
        ? order.fills.reduce((s, f) => s + parseFloat(f.price) * parseFloat(f.qty), 0) / parseFloat(order.executedQty)
        : signal.currentPrice;

      await prisma.cryptoTrade.create({
        data: { botId: bot.id, symbol: bot.symbol, side: "BUY", price: avgPrice, qty: parseFloat(order.executedQty), quoteQty: parseFloat(order.cummulativeQuoteQty) },
      });
      await prisma.cryptoBot.update({
        where: { id: bot.id },
        data: { inPosition: true, entryPrice: avgPrice, entryDate: new Date().toISOString().slice(0, 10), lastChecked: new Date() },
      });
      action = "buy";

    } else if (signal.signal === "sell" && bot.inPosition) {
      // 卖出：先查持仓数量
      const { getAccount } = await import("@/lib/binance");
      const account = await getAccount();
      const base = bot.symbol.replace(/USDT$|BTC$|ETH$|BNB$/, "");
      const bal = account.balances.find(b => b.asset === base);
      if (bal && bal.free > 0) {
        orderResult = await marketSell(bot.symbol, bal.free);
        const order = orderResult as { executedQty: string; cummulativeQuoteQty: string; fills?: { price: string; qty: string }[] };
        const avgPrice = order.fills?.length
          ? order.fills.reduce((s, f) => s + parseFloat(f.price) * parseFloat(f.qty), 0) / parseFloat(order.executedQty)
          : signal.currentPrice;
        const pnl = bot.entryPrice ? (avgPrice - bot.entryPrice) * parseFloat(order.executedQty) : null;
        const pnlPct = bot.entryPrice ? (avgPrice - bot.entryPrice) / bot.entryPrice : null;

        await prisma.cryptoTrade.create({
          data: { botId: bot.id, symbol: bot.symbol, side: "SELL", price: avgPrice, qty: parseFloat(order.executedQty), quoteQty: parseFloat(order.cummulativeQuoteQty), pnl, pnlPct },
        });
        await prisma.cryptoBot.update({
          where: { id: bot.id },
          data: { inPosition: false, entryPrice: null, entryDate: null, lastChecked: new Date() },
        });
        action = "sell";
      }
    } else {
      await prisma.cryptoBot.update({ where: { id: bot.id }, data: { lastChecked: new Date() } });
    }

    return NextResponse.json({ action, signal: signal.signal, inPosition: signal.inPosition, currentPrice: signal.currentPrice });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "check failed" }, { status: 500 });
  }
}

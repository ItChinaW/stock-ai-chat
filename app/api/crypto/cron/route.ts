import { getKlines, marketBuy, marketSell, getAccount } from "@/lib/binance";
import { getLatestSignal } from "@/lib/backtest-engine";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 60;

// 简单的 secret 防止外部随意触发
const CRON_SECRET = process.env.CRON_SECRET ?? "local-cron";

export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret");
  if (secret !== CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const bots = await prisma.cryptoBot.findMany({ where: { status: "running" } });
  if (bots.length === 0) return NextResponse.json({ ok: true, checked: 0 });

  const results: { id: number; symbol: string; action: string; error?: string }[] = [];

  for (const bot of bots) {
    try {
      const candles = await getKlines(bot.symbol, bot.interval, 300);
      if (candles.length < 20) { results.push({ id: bot.id, symbol: bot.symbol, action: "skip", error: "数据不足" }); continue; }

      const p = JSON.parse(bot.params) as Record<string, number>;
      const signal = getLatestSignal(candles, bot.strategyCode, p);
      let action = "hold";

      if (signal.signal === "buy" && !bot.inPosition) {
        const order = await marketBuy(bot.symbol, bot.quoteQty) as { fills?: { price: string; qty: string }[]; executedQty: string; cummulativeQuoteQty: string };
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
        const account = await getAccount();
        const base = bot.symbol.replace(/USDT$|BTC$|ETH$|BNB$/, "");
        const bal = account.balances.find(b => b.asset === base);
        if (bal && bal.free > 0) {
          const order = await marketSell(bot.symbol, bal.free) as { executedQty: string; cummulativeQuoteQty: string; fills?: { price: string; qty: string }[] };
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

      results.push({ id: bot.id, symbol: bot.symbol, action });
    } catch (err) {
      results.push({ id: bot.id, symbol: bot.symbol, action: "error", error: err instanceof Error ? err.message : "unknown" });
    }
  }

  return NextResponse.json({ ok: true, checked: bots.length, results });
}

import { getKlines, marketBuy, marketSell, getAccount } from "@/lib/binance";
import { getLatestSignal } from "@/lib/backtest-engine";
import { selectStrategyWithAI } from "@/lib/ai-strategy-selector";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 60;

const CRON_SECRET = process.env.CRON_SECRET ?? "local-cron";

export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret");
  if (secret !== CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const bots = await prisma.cryptoBot.findMany({ where: { status: "running" } });
  if (bots.length === 0) return NextResponse.json({ ok: true, checked: 0 });

  const results: {
    id: number; symbol: string; action: string;
    strategy?: string; reason?: string; paper?: boolean; error?: string;
  }[] = [];

  for (const bot of bots) {
    // paperMode 字段在新版 schema 中存在，类型断言兼容旧版 Prisma Client 缓存
    const paperMode = (bot as unknown as { paperMode: boolean }).paperMode ?? false;
    try {
      const candles = await getKlines(bot.symbol, bot.interval, 300);
      if (candles.length < 20) {
        results.push({ id: bot.id, symbol: bot.symbol, action: "skip", error: "数据不足" });
        continue;
      }

      let strategyCode = bot.strategyCode;
      let params = JSON.parse(bot.params) as Record<string, number>;
      let aiReason: string | undefined;

      if (bot.aiMode) {
        const selected = await selectStrategyWithAI(candles, bot.aiMode as "short" | "medium" | "long", bot.symbol);
        strategyCode = selected.code;
        params = selected.params;
        aiReason = `${selected.usedAI ? "🤖" : "📐"} ${selected.reason}`;
        await prisma.cryptoBot.update({
          where: { id: bot.id },
          data: { strategyCode: selected.code, params: JSON.stringify(selected.params) },
        });
      }

      const signal = getLatestSignal(candles, strategyCode, params);
      let action = "hold";

      if (signal.signal === "buy" && !bot.inPosition) {
        const price = signal.currentPrice;
        if (paperMode) {
          const qty = bot.quoteQty / price;
          await prisma.cryptoTrade.create({
            data: { botId: bot.id, symbol: bot.symbol, side: "BUY", price, qty, quoteQty: bot.quoteQty, orderId: "paper" },
          });
        } else {
          const order = await marketBuy(bot.symbol, bot.quoteQty) as {
            fills?: { price: string; qty: string }[];
            executedQty: string;
            cummulativeQuoteQty: string;
          };
          const avgPrice = order.fills?.length
            ? order.fills.reduce((s, f) => s + parseFloat(f.price) * parseFloat(f.qty), 0) / parseFloat(order.executedQty)
            : price;
          await prisma.cryptoTrade.create({
            data: { botId: bot.id, symbol: bot.symbol, side: "BUY", price: avgPrice, qty: parseFloat(order.executedQty), quoteQty: parseFloat(order.cummulativeQuoteQty) },
          });
        }
        await prisma.cryptoBot.update({
          where: { id: bot.id },
          data: { inPosition: true, entryPrice: signal.currentPrice, entryDate: new Date().toISOString().slice(0, 10), lastChecked: new Date() },
        });
        action = "buy";

      } else if (signal.signal === "sell" && bot.inPosition) {
        const price = signal.currentPrice;
        const qty = bot.quoteQty / (bot.entryPrice ?? price);
        if (paperMode) {
          const pnl = bot.entryPrice ? (price - bot.entryPrice) * qty : null;
          const pnlPct = bot.entryPrice ? (price - bot.entryPrice) / bot.entryPrice : null;
          await prisma.cryptoTrade.create({
            data: { botId: bot.id, symbol: bot.symbol, side: "SELL", price, qty, quoteQty: price * qty, pnl, pnlPct, orderId: "paper" },
          });
          await prisma.cryptoBot.update({
            where: { id: bot.id },
            data: { inPosition: false, entryPrice: null, entryDate: null, lastChecked: new Date() },
          });
          action = "sell";
        } else {
          const base = bot.symbol.replace(/USDT$|BTC$|ETH$|BNB$/, "");
          const account = await getAccount();
          const bal = (account.balances as { asset: string; free: number }[]).find(b => b.asset === base);
          if (bal && bal.free > 0) {
            const order = await marketSell(bot.symbol, bal.free) as {
              executedQty: string;
              cummulativeQuoteQty: string;
              fills?: { price: string; qty: string }[];
            };
            const avgPrice = order.fills?.length
              ? order.fills.reduce((s, f) => s + parseFloat(f.price) * parseFloat(f.qty), 0) / parseFloat(order.executedQty)
              : price;
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
        }
      } else {
        await prisma.cryptoBot.update({ where: { id: bot.id }, data: { lastChecked: new Date() } });
      }

      results.push({ id: bot.id, symbol: bot.symbol, action, strategy: strategyCode, reason: aiReason, paper: paperMode });
    } catch (err) {
      results.push({ id: bot.id, symbol: bot.symbol, action: "error", error: err instanceof Error ? err.message : "unknown" });
    }
  }

  return NextResponse.json({ ok: true, checked: bots.length, results });
}

import { getKlines, marketBuy, marketSell, getAccount } from "@/lib/binance";
import { getLatestSignal } from "@/lib/backtest-engine";
import { selectStrategyWithAI } from "@/lib/ai-strategy-selector";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 60;

const CRON_SECRET = process.env.CRON_SECRET ?? "local-cron";

// 合约字段类型扩展
type BotWithContract = {
  id: number; symbol: string; strategyCode: string; params: string;
  interval: string; quoteQty: number; status: string;
  paperMode: boolean; aiMode: string | null;
  leverage: number; direction: number; stopLossPct: number; takeProfitPct: number;
  positionSide: string;
  inPosition: boolean; entryPrice: number | null; entryDate: string | null;
  lastChecked: Date | null;
};

export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret");
  if (secret !== CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // interval 参数：只跑指定周期的机器人（1m/5m/15m/1h/4h/1d）
  // 不传则跑所有
  const intervalFilter = req.nextUrl.searchParams.get("interval");

  const where = intervalFilter
    ? { status: "running", interval: intervalFilter }
    : { status: "running" };

  const bots = await prisma.cryptoBot.findMany({ where }) as unknown as BotWithContract[];
  if (bots.length === 0) return NextResponse.json({ ok: true, checked: 0 });

  const results: {
    id: number; symbol: string; action: string;
    strategy?: string; reason?: string; paper?: boolean; error?: string;
  }[] = [];

  for (const bot of bots) {
    const paperMode = bot.paperMode ?? false;
    const leverage = bot.leverage ?? 1;
    const isContract = leverage > 1; // 合约模式
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
      const price = signal.currentPrice;
      let action = "hold";

      // ── 合约模拟盘逻辑 ──────────────────────────────────
      if (isContract && paperMode) {
        const positionSide = bot.positionSide ?? "NONE";
        const stopLossPct = (bot.stopLossPct ?? 0.5) / 100;
        const takeProfitPct = (bot.takeProfitPct ?? 1.5) / 100;

        if (positionSide === "LONG") {
          // 持多仓：检查止损/止盈
          const ep = bot.entryPrice!;
          const pnlPct = (price - ep) / ep;
          const shouldStop = pnlPct <= -stopLossPct || pnlPct >= takeProfitPct;
          if (shouldStop || signal.signal === "sell") {
            const pnl = (price - ep) / ep * bot.quoteQty * leverage;
            const pnlPctFinal = (price - ep) / ep * leverage;
            await prisma.cryptoTrade.create({
              data: {
                botId: bot.id, symbol: bot.symbol, side: "SELL",
                price, qty: bot.quoteQty / ep, quoteQty: bot.quoteQty,
                pnl, pnlPct: pnlPctFinal, leverage, orderId: "paper-contract",
              },
            });
            await prisma.cryptoBot.update({
              where: { id: bot.id },
              data: { inPosition: false, entryPrice: null, entryDate: null, positionSide: "NONE", lastChecked: new Date() },
            });
            action = pnlPct >= takeProfitPct ? "tp" : "sl";
          }
        } else if (positionSide === "SHORT") {
          // 持空仓：检查止损/止盈
          const ep = bot.entryPrice!;
          const pnlPct = (ep - price) / ep;
          const shouldStop = pnlPct <= -stopLossPct || pnlPct >= takeProfitPct;
          if (shouldStop || signal.signal === "buy") {
            const pnl = (ep - price) / ep * bot.quoteQty * leverage;
            const pnlPctFinal = (ep - price) / ep * leverage;
            await prisma.cryptoTrade.create({
              data: {
                botId: bot.id, symbol: bot.symbol, side: "SHORT_CLOSE",
                price, qty: bot.quoteQty / ep, quoteQty: bot.quoteQty,
                pnl, pnlPct: pnlPctFinal, leverage, orderId: "paper-contract",
              },
            });
            await prisma.cryptoBot.update({
              where: { id: bot.id },
              data: { inPosition: false, entryPrice: null, entryDate: null, positionSide: "NONE", lastChecked: new Date() },
            });
            action = pnlPct >= takeProfitPct ? "tp" : "sl";
          }
        } else {
          // 空仓：检查开仓信号
          const dir = bot.direction ?? 0;
          if (signal.signal === "buy" && (dir === 0 || dir === 1)) {
            // 开多
            await prisma.cryptoTrade.create({
              data: {
                botId: bot.id, symbol: bot.symbol, side: "BUY",
                price, qty: bot.quoteQty / price, quoteQty: bot.quoteQty,
                leverage, orderId: "paper-contract",
              },
            });
            await prisma.cryptoBot.update({
              where: { id: bot.id },
              data: { inPosition: true, entryPrice: price, entryDate: new Date().toISOString().slice(0, 10), positionSide: "LONG", lastChecked: new Date() },
            });
            action = "buy-long";
          } else if (signal.signal === "sell" && (dir === 0 || dir === -1)) {
            // 开空
            await prisma.cryptoTrade.create({
              data: {
                botId: bot.id, symbol: bot.symbol, side: "SHORT_OPEN",
                price, qty: bot.quoteQty / price, quoteQty: bot.quoteQty,
                leverage, orderId: "paper-contract",
              },
            });
            await prisma.cryptoBot.update({
              where: { id: bot.id },
              data: { inPosition: true, entryPrice: price, entryDate: new Date().toISOString().slice(0, 10), positionSide: "SHORT", lastChecked: new Date() },
            });
            action = "sell-short";
          } else {
            await prisma.cryptoBot.update({ where: { id: bot.id }, data: { lastChecked: new Date() } });
          }
        }

      // ── 现货/普通模拟盘逻辑 ─────────────────────────────
      } else if (signal.signal === "buy" && !bot.inPosition) {
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
          data: { inPosition: true, entryPrice: price, entryDate: new Date().toISOString().slice(0, 10), lastChecked: new Date() },
        });
        action = "buy";

      } else if (signal.signal === "sell" && bot.inPosition) {
        if (paperMode) {
          const qty = bot.quoteQty / (bot.entryPrice ?? price);
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

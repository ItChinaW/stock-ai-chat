import { getKlines, marketBuy, marketSell } from "@/lib/binance";
import { getLatestSignal } from "@/lib/backtest-engine";
import { selectStrategyWithAI } from "@/lib/ai-strategy-selector";
import { botEventBus } from "@/lib/bot-events";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

type Params = { params: Promise<{ id: string }> };

type BotFull = {
  id: number; symbol: string; strategyCode: string; params: string;
  interval: string; quoteQty: number; status: string;
  paperMode: boolean; aiMode: string | null;
  leverage: number; direction: number; stopLossPct: number; takeProfitPct: number;
  positionSide: string;
  inPosition: boolean; entryPrice: number | null; entryDate: string | null;
};

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
    return runCheck(bot as unknown as BotFull);
  }
  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  await prisma.cryptoBot.deleteMany({ where: { id: Number(id), userId: 1 } });
  return new NextResponse(null, { status: 204 });
}

async function runCheck(bot: BotFull) {
  try {
    const candles = await getKlines(bot.symbol, bot.interval, 300);
    if (candles.length < 20) return NextResponse.json({ error: "数据不足" }, { status: 400 });

    let strategyCode = bot.strategyCode;
    let params = JSON.parse(bot.params) as Record<string, number>;
    let aiReason: string | undefined;

    if (bot.aiMode) {
      const selected = await selectStrategyWithAI(candles, bot.aiMode as "short" | "medium" | "long", bot.symbol);
      strategyCode = selected.code;
      params = selected.params;
      aiReason = selected.reason;
      await prisma.cryptoBot.update({
        where: { id: bot.id },
        data: { strategyCode: selected.code, params: JSON.stringify(selected.params) },
      });
    }

    const signal = getLatestSignal(candles, strategyCode, params);
    const price = signal.currentPrice;
    const leverage = bot.leverage ?? 1;
    const isContract = leverage > 1;
    const paperMode = bot.paperMode ?? false;
    let action = "hold";

    // ── 合约模拟盘 ────────────────────────────────────────
    if (isContract && paperMode) {
      const positionSide = bot.positionSide ?? "NONE";
      const stopLossPct = (bot.stopLossPct ?? 0.5) / 100;
      const takeProfitPct = (bot.takeProfitPct ?? 1.5) / 100;
      const dir = bot.direction ?? 0;

      if (positionSide === "LONG") {
        const ep = bot.entryPrice!;
        const pnlPct = (price - ep) / ep;
        if (pnlPct <= -stopLossPct || pnlPct >= takeProfitPct || signal.signal === "sell") {
          const pnl = pnlPct * bot.quoteQty * leverage;
          await prisma.cryptoTrade.create({
            data: { botId: bot.id, symbol: bot.symbol, side: "SELL", price, qty: bot.quoteQty / ep, quoteQty: bot.quoteQty, pnl, pnlPct: pnlPct * leverage, leverage, orderId: "paper-contract" },
          });
          await prisma.cryptoBot.update({
            where: { id: bot.id },
            data: { inPosition: false, entryPrice: null, entryDate: null, positionSide: "NONE", lastChecked: new Date() },
          });
          botEventBus.emit({ botId: bot.id, symbol: bot.symbol, action: "close-long", price, pnl, pnlPct: pnlPct * leverage, leverage, ts: Date.now() });
          action = "close-long";
        } else {
          await prisma.cryptoBot.update({ where: { id: bot.id }, data: { lastChecked: new Date() } });
        }

      } else if (positionSide === "SHORT") {
        const ep = bot.entryPrice!;
        const pnlPct = (ep - price) / ep;
        if (pnlPct <= -stopLossPct || pnlPct >= takeProfitPct || signal.signal === "buy") {
          const pnl = pnlPct * bot.quoteQty * leverage;
          await prisma.cryptoTrade.create({
            data: { botId: bot.id, symbol: bot.symbol, side: "SHORT_CLOSE", price, qty: bot.quoteQty / ep, quoteQty: bot.quoteQty, pnl, pnlPct: pnlPct * leverage, leverage, orderId: "paper-contract" },
          });
          await prisma.cryptoBot.update({
            where: { id: bot.id },
            data: { inPosition: false, entryPrice: null, entryDate: null, positionSide: "NONE", lastChecked: new Date() },
          });
          botEventBus.emit({ botId: bot.id, symbol: bot.symbol, action: "close-short", price, pnl, pnlPct: pnlPct * leverage, leverage, ts: Date.now() });
          action = "close-short";
        } else {
          await prisma.cryptoBot.update({ where: { id: bot.id }, data: { lastChecked: new Date() } });
        }

      } else {
        // 空仓找开仓信号
        if (signal.signal === "buy" && dir !== -1) {
          await prisma.cryptoTrade.create({
            data: { botId: bot.id, symbol: bot.symbol, side: "BUY", price, qty: bot.quoteQty / price, quoteQty: bot.quoteQty, leverage, orderId: "paper-contract" },
          });
          await prisma.cryptoBot.update({
            where: { id: bot.id },
            data: { inPosition: true, entryPrice: price, entryDate: new Date().toISOString().slice(0, 10), positionSide: "LONG", lastChecked: new Date() },
          });
          botEventBus.emit({ botId: bot.id, symbol: bot.symbol, action: "buy-long", price, leverage, positionSide: "LONG", ts: Date.now() });
          action = "buy-long";
        } else if (signal.signal === "sell" && dir === -1) {
          await prisma.cryptoTrade.create({
            data: { botId: bot.id, symbol: bot.symbol, side: "SHORT_OPEN", price, qty: bot.quoteQty / price, quoteQty: bot.quoteQty, leverage, orderId: "paper-contract" },
          });
          await prisma.cryptoBot.update({
            where: { id: bot.id },
            data: { inPosition: true, entryPrice: price, entryDate: new Date().toISOString().slice(0, 10), positionSide: "SHORT", lastChecked: new Date() },
          });
          botEventBus.emit({ botId: bot.id, symbol: bot.symbol, action: "sell-short", price, leverage, positionSide: "SHORT", ts: Date.now() });
          action = "sell-short";
        } else {
          await prisma.cryptoBot.update({ where: { id: bot.id }, data: { lastChecked: new Date() } });
        }
      }

    // ── 现货 ──────────────────────────────────────────────
    } else if (signal.signal === "buy" && !bot.inPosition) {
      if (paperMode) {
        await prisma.cryptoTrade.create({
          data: { botId: bot.id, symbol: bot.symbol, side: "BUY", price, qty: bot.quoteQty / price, quoteQty: bot.quoteQty, orderId: "paper" },
        });
      } else {
        const order = await marketBuy(bot.symbol, bot.quoteQty) as { fills?: { price: string; qty: string }[]; executedQty: string; cummulativeQuoteQty: string };
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
      const qty = bot.quoteQty / (bot.entryPrice ?? price);
      if (paperMode) {
        const pnl = bot.entryPrice ? (price - bot.entryPrice) * qty : null;
        const pnlPct = bot.entryPrice ? (price - bot.entryPrice) / bot.entryPrice : null;
        await prisma.cryptoTrade.create({
          data: { botId: bot.id, symbol: bot.symbol, side: "SELL", price, qty, quoteQty: price * qty, pnl, pnlPct, orderId: "paper" },
        });
        await prisma.cryptoBot.update({ where: { id: bot.id }, data: { inPosition: false, entryPrice: null, entryDate: null, lastChecked: new Date() } });
        action = "sell";
      } else {
        const { getAccount } = await import("@/lib/binance");
        const account = await getAccount();
        const base = bot.symbol.replace(/USDT$|BTC$|ETH$|BNB$/, "");
        const bal = account.balances.find(b => b.asset === base);
        if (bal && bal.free > 0) {
          const order = await marketSell(bot.symbol, bal.free) as { executedQty: string; cummulativeQuoteQty: string; fills?: { price: string; qty: string }[] };
          const avgPrice = order.fills?.length
            ? order.fills.reduce((s, f) => s + parseFloat(f.price) * parseFloat(f.qty), 0) / parseFloat(order.executedQty)
            : price;
          const pnl = bot.entryPrice ? (avgPrice - bot.entryPrice) * parseFloat(order.executedQty) : null;
          const pnlPct = bot.entryPrice ? (avgPrice - bot.entryPrice) / bot.entryPrice : null;
          await prisma.cryptoTrade.create({
            data: { botId: bot.id, symbol: bot.symbol, side: "SELL", price: avgPrice, qty: parseFloat(order.executedQty), quoteQty: parseFloat(order.cummulativeQuoteQty), pnl, pnlPct },
          });
          await prisma.cryptoBot.update({ where: { id: bot.id }, data: { inPosition: false, entryPrice: null, entryDate: null, lastChecked: new Date() } });
          action = "sell";
        }
      }
    } else {
      await prisma.cryptoBot.update({ where: { id: bot.id }, data: { lastChecked: new Date() } });
    }

    return NextResponse.json({ action, signal: signal.signal, inPosition: signal.inPosition, currentPrice: price, reason: aiReason });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "check failed" }, { status: 500 });
  }
}

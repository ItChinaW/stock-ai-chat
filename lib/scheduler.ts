/**
 * 后台调度器 - 服务启动后自动按 K 线周期检查运行中的机器人
 * 每1分钟轮询一次，每个机器人按自己的 K 线周期决定是否真正执行
 */

const INTERVAL_MS: Record<string, number> = {
  "15m": 15 * 60_000,
  "1h":  60 * 60_000,
  "4h":  4 * 60 * 60_000,
  "1d":  24 * 60 * 60_000,
};

const POLL_INTERVAL_MS = 60_000;

const globalForScheduler = globalThis as unknown as { schedulerStarted?: boolean };

export function startScheduler() {
  if (globalForScheduler.schedulerStarted) return;
  globalForScheduler.schedulerStarted = true;
  console.log("[scheduler] 后台调度器已启动，每1分钟轮询，按各机器人 K 线周期执行");
  setInterval(() => { void runCheck(); }, POLL_INTERVAL_MS);
  void runCheck();
}

async function runCheck() {
  try {
    const { prisma } = await import("./prisma");
    const { getKlines, marketBuy, marketSell, getAccount } = await import("./binance");
    const { getLatestSignal } = await import("./backtest-engine");
    const { selectStrategyWithAI } = await import("./ai-strategy-selector");

    const bots = await prisma.cryptoBot.findMany({ where: { status: "running" } });
    if (bots.length === 0) return;

    const now = Date.now();

    for (const bot of bots) {
      try {
        const intervalMs = INTERVAL_MS[bot.interval] ?? 60 * 60_000;
        const lastChecked = bot.lastChecked ? new Date(bot.lastChecked).getTime() : 0;
        if (now - lastChecked < intervalMs - 30_000) continue;

        const paperMode = (bot as unknown as { paperMode: boolean }).paperMode ?? false;
        const candles = await getKlines(bot.symbol, bot.interval, 300);
        if (candles.length < 20) continue;

        let strategyCode = bot.strategyCode;
        let params = JSON.parse(bot.params) as Record<string, number>;

        if (bot.aiMode) {
          const selected = await selectStrategyWithAI(candles, bot.aiMode as "short" | "medium" | "long", bot.symbol);
          strategyCode = selected.code;
          params = selected.params;
          await prisma.cryptoBot.update({
            where: { id: bot.id },
            data: { strategyCode: selected.code, params: JSON.stringify(selected.params) },
          });
        }

        const signal = getLatestSignal(candles, strategyCode, params);

        if (signal.signal === "buy" && !bot.inPosition) {
          const price = signal.currentPrice;
          if (paperMode) {
            const qty = bot.quoteQty / price;
            await prisma.cryptoTrade.create({
              data: { botId: bot.id, symbol: bot.symbol, side: "BUY", price, qty, quoteQty: bot.quoteQty, orderId: "paper" },
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
            data: { inPosition: true, entryPrice: signal.currentPrice, entryDate: new Date().toISOString().slice(0, 10), lastChecked: new Date() },
          });
          console.log("[scheduler] " + bot.symbol + " BUY @ " + signal.currentPrice + " (" + (paperMode ? "paper" : "real") + ")");

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
          } else {
            const base = bot.symbol.replace(/USDT$|BTC$|ETH$|BNB$/, "");
            const account = await getAccount();
            const bal = (account.balances as { asset: string; free: number }[]).find(b => b.asset === base);
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
              await prisma.cryptoBot.update({
                where: { id: bot.id },
                data: { inPosition: false, entryPrice: null, entryDate: null, lastChecked: new Date() },
              });
            }
          }
          console.log("[scheduler] " + bot.symbol + " SELL @ " + signal.currentPrice + " (" + (paperMode ? "paper" : "real") + ")");

        } else {
          await prisma.cryptoBot.update({ where: { id: bot.id }, data: { lastChecked: new Date() } });
        }
      } catch (err) {
        console.error("[scheduler] bot " + bot.id + " (" + bot.symbol + ") error:", err instanceof Error ? err.message : err);
      }
    }
  } catch (err) {
    console.error("[scheduler] runCheck error:", err instanceof Error ? err.message : err);
  }
}

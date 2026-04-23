/**
 * 后台调度器 - 服务启动后自动按 K 线周期检查运行中的机器人
 * 轮询间隔 30 秒，每个机器人按自己的 K 线周期决定是否真正执行
 */

const INTERVAL_MS: Record<string, number> = {
  "1m":  1 * 60_000,
  "5m":  5 * 60_000,
  "15m": 15 * 60_000,
  "1h":  60 * 60_000,
  "4h":  4 * 60 * 60_000,
  "1d":  24 * 60 * 60_000,
};

// 轮询间隔：30秒，保证 1m 策略能及时触发
const POLL_INTERVAL_MS = 30_000;

const g = globalThis as unknown as {
  schedulerStarted?: boolean;
  schedulerTimer?: ReturnType<typeof setInterval>;
  schedulerLastRun?: number;
};

export function startScheduler() {
  if (g.schedulerStarted) return;
  g.schedulerStarted = true;
  g.schedulerLastRun = 0;
  console.log("[scheduler] 启动，轮询间隔 30s，支持 1m/5m/15m/1h/4h/1d");
  if (g.schedulerTimer) clearInterval(g.schedulerTimer);
  g.schedulerTimer = setInterval(() => { void runCheck(); }, POLL_INTERVAL_MS);
  void runCheck();
}

export function forceRestartScheduler() {
  g.schedulerStarted = false;
  g.schedulerLastRun = 0;
  if (g.schedulerTimer) { clearInterval(g.schedulerTimer); g.schedulerTimer = undefined; }
  startScheduler();
}

export function getSchedulerStatus() {
  return {
    started: g.schedulerStarted ?? false,
    lastRun: g.schedulerLastRun ?? 0,
  };
}

type BotRow = {
  id: number; symbol: string; strategyCode: string; params: string;
  interval: string; quoteQty: number; status: string;
  paperMode: boolean; aiMode: string | null;
  leverage: number; direction: number; stopLossPct: number; takeProfitPct: number;
  positionSide: string;
  inPosition: boolean; entryPrice: number | null; entryDate: string | null;
  lastChecked: Date | null;
};

async function runCheck() {
  g.schedulerLastRun = Date.now();
  try {
    const { prisma } = await import("./prisma");
    const { getKlines, marketBuy, marketSell, getAccount } = await import("./binance");
    const { getLatestSignal } = await import("./backtest-engine");
    const { selectStrategyWithAI } = await import("./ai-strategy-selector");
    const { botEventBus } = await import("./bot-events");

    const bots = await prisma.cryptoBot.findMany({ where: { status: "running" } }) as unknown as BotRow[];
    if (bots.length === 0) return;

    const now = Date.now();

    for (const bot of bots) {
      try {
        // 按各自周期决定是否执行（提前 15 秒容差）
        const intervalMs = INTERVAL_MS[bot.interval] ?? 60 * 60_000;
        const lastChecked = bot.lastChecked ? new Date(bot.lastChecked).getTime() : 0;
        if (now - lastChecked < intervalMs - 15_000) continue;

        const paperMode = bot.paperMode ?? false;
        const leverage = bot.leverage ?? 1;
        const isContract = leverage > 1;

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
        const price = signal.currentPrice;

        // ── 合约模拟盘 ──────────────────────────────────────
        if (isContract && paperMode) {
          const positionSide = bot.positionSide ?? "NONE";
          const stopLossPct = (bot.stopLossPct ?? 0.5) / 100;
          const takeProfitPct = (bot.takeProfitPct ?? 1.5) / 100;
          const dir = bot.direction ?? 0; // 0=双向 1=只多 -1=只空

          if (positionSide === "LONG") {
            // 持多仓：止损/止盈/卖出信号 → 平多
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
              console.log(`[scheduler] ${bot.symbol} LONG CLOSE @ ${price} pnl=${pnl.toFixed(2)}`);
            } else {
              await prisma.cryptoBot.update({ where: { id: bot.id }, data: { lastChecked: new Date() } });
              botEventBus.emit({ botId: bot.id, symbol: bot.symbol, action: "hold", price, positionSide: "LONG", ts: Date.now() });
            }

          } else if (positionSide === "SHORT") {
            // 持空仓：止损/止盈/买入信号 → 平空
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
              console.log(`[scheduler] ${bot.symbol} SHORT CLOSE @ ${price} pnl=${pnl.toFixed(2)}`);
            } else {
              await prisma.cryptoBot.update({ where: { id: bot.id }, data: { lastChecked: new Date() } });
              botEventBus.emit({ botId: bot.id, symbol: bot.symbol, action: "hold", price, positionSide: "SHORT", ts: Date.now() });
            }

          } else {
            // 空仓：根据 direction 决定能否开仓
            if (signal.signal === "buy" && dir !== -1) {
              // 开多（双向或只多）
              await prisma.cryptoTrade.create({
                data: { botId: bot.id, symbol: bot.symbol, side: "BUY", price, qty: bot.quoteQty / price, quoteQty: bot.quoteQty, leverage, orderId: "paper-contract" },
              });
              await prisma.cryptoBot.update({
                where: { id: bot.id },
                data: { inPosition: true, entryPrice: price, entryDate: new Date().toISOString().slice(0, 10), positionSide: "LONG", lastChecked: new Date() },
              });
              botEventBus.emit({ botId: bot.id, symbol: bot.symbol, action: "buy-long", price, leverage, positionSide: "LONG", ts: Date.now() });
              console.log(`[scheduler] ${bot.symbol} LONG OPEN @ ${price} ${leverage}x`);
            } else if (signal.signal === "sell" && dir === -1) {
              // 开空（只有明确设置只做空才开空）
              await prisma.cryptoTrade.create({
                data: { botId: bot.id, symbol: bot.symbol, side: "SHORT_OPEN", price, qty: bot.quoteQty / price, quoteQty: bot.quoteQty, leverage, orderId: "paper-contract" },
              });
              await prisma.cryptoBot.update({
                where: { id: bot.id },
                data: { inPosition: true, entryPrice: price, entryDate: new Date().toISOString().slice(0, 10), positionSide: "SHORT", lastChecked: new Date() },
              });
              botEventBus.emit({ botId: bot.id, symbol: bot.symbol, action: "sell-short", price, leverage, positionSide: "SHORT", ts: Date.now() });
              console.log(`[scheduler] ${bot.symbol} SHORT OPEN @ ${price} ${leverage}x`);
            } else {
              await prisma.cryptoBot.update({ where: { id: bot.id }, data: { lastChecked: new Date() } });
              botEventBus.emit({ botId: bot.id, symbol: bot.symbol, action: "hold", price, positionSide: "NONE", ts: Date.now() });
            }
          }

        // ── 现货 ────────────────────────────────────────────
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
          botEventBus.emit({ botId: bot.id, symbol: bot.symbol, action: "buy", price, ts: Date.now() });
          console.log(`[scheduler] ${bot.symbol} BUY @ ${price} (${paperMode ? "paper" : "real"})`);

        } else if (signal.signal === "sell" && bot.inPosition) {
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
          botEventBus.emit({ botId: bot.id, symbol: bot.symbol, action: "sell", price, ts: Date.now() });
          console.log(`[scheduler] ${bot.symbol} SELL @ ${price} (${paperMode ? "paper" : "real"})`);

        } else {
          await prisma.cryptoBot.update({ where: { id: bot.id }, data: { lastChecked: new Date() } });
          botEventBus.emit({ botId: bot.id, symbol: bot.symbol, action: "hold", price, ts: Date.now() });
        }

      } catch (err) {
        console.error(`[scheduler] bot ${bot.id} (${bot.symbol}) error:`, err instanceof Error ? err.message : err);
      }
    }
  } catch (err) {
    console.error("[scheduler] runCheck error:", err instanceof Error ? err.message : err);
  }
}

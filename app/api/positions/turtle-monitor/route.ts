/**
 * 海龟策略持仓监控
 * 对所有持仓跑海龟策略信号，返回买入价和止损价
 * 若当前价格触及止损线，发送邮件预警
 */
import { getLatestSignal, atrArr } from "@/lib/backtest-engine";
import { getCurrentUserId } from "@/lib/auth";
import { sendMail } from "@/lib/mailer";
import { isOverseasSymbol, toSinaSymbol, fetchYahooKlineRecent } from "@/lib/market";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

// 海龟策略默认参数
const TURTLE_PARAMS = { entryPeriod: 20, exitPeriod: 10, atrPeriod: 20, atrMult: 2 };

async function fetchCandles(symbol: string) {
  if (isOverseasSymbol(symbol)) {
    return fetchYahooKlineRecent(symbol, 300);
  }
  const sinaSymbol = toSinaSymbol(symbol);
  const url = `https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=${sinaSymbol}&scale=240&ma=no&datalen=300`;
  const res = await fetch(url, {
    headers: { Referer: "https://finance.sina.com.cn" },
    next: { revalidate: 300 },
  });
  const json = await res.json() as { day: string; open: string; high: string; low: string; close: string; volume: string }[];
  return (Array.isArray(json) ? json : []).map(item => ({
    time: item.day, open: +item.open, high: +item.high,
    low: +item.low, close: +item.close, volume: +item.volume,
  }));
}

export type TurtleSignalItem = {
  id: number;
  code: string;
  name: string;
  costPrice: number;
  amount: number;
  currentPrice: number;
  signal: "buy" | "sell" | "hold";
  inPosition: boolean;
  entryPrice: number | null;
  stopLoss: number | null;
  buyPrice: number | { low: number; high: number } | null;
  unrealizedPnlPct: number | null;
  stopTriggered: boolean; // 当前价是否已触及止损
  error?: string;
};

export async function GET() {
  const userId = await getCurrentUserId();
  const positions = await prisma.position.findMany({ where: { userId, strategy: "turtle" }, orderBy: { id: "asc" } });

  if (positions.length === 0) {
    return NextResponse.json({ items: [], checkedAt: new Date().toISOString() });
  }

  const results = await Promise.allSettled(
    positions.map(async (pos): Promise<TurtleSignalItem> => {
      try {
        const candles = await fetchCandles(pos.code);
        if (candles.length < 30) {
          return {
            id: pos.id, code: pos.code, name: pos.name, costPrice: pos.costPrice, amount: pos.amount,
            currentPrice: 0, signal: "hold", inPosition: false,
            entryPrice: null, stopLoss: null, buyPrice: null, unrealizedPnlPct: null,
            stopTriggered: false, error: "数据不足",
          };
        }
        const sig = getLatestSignal(candles, "turtle", TURTLE_PARAMS);
        // 用户已实际持仓，用其成本价作为入场，按海龟规则算止损：
        // stop = max(成本价 - 2*ATR(20), 最近 10 日最低价)
        const n = candles.length;
        const atr = atrArr(candles, TURTLE_PARAMS.atrPeriod)[n - 1] ?? pos.costPrice * 0.02;
        const recentLow = Math.min(...candles.slice(n - TURTLE_PARAMS.exitPeriod, n).map(c => c.low));
        const stopLoss = Math.max(pos.costPrice - TURTLE_PARAMS.atrMult * atr, recentLow);
        const stopTriggered = sig.currentPrice <= stopLoss;
        return {
          id: pos.id, code: pos.code, name: pos.name, costPrice: pos.costPrice, amount: pos.amount,
          currentPrice: sig.currentPrice,
          signal: sig.signal,
          inPosition: true,
          entryPrice: pos.costPrice,
          stopLoss,
          buyPrice: sig.buyPrice,
          unrealizedPnlPct: (sig.currentPrice - pos.costPrice) / pos.costPrice,
          stopTriggered,
        };
      } catch (err) {
        return {
          id: pos.id, code: pos.code, name: pos.name, costPrice: pos.costPrice, amount: pos.amount,
          currentPrice: 0, signal: "hold", inPosition: false,
          entryPrice: null, stopLoss: null, buyPrice: null, unrealizedPnlPct: null,
          stopTriggered: false, error: err instanceof Error ? err.message : "error",
        };
      }
    })
  );

  const items: TurtleSignalItem[] = results.map((r, i) =>
    r.status === "fulfilled" ? r.value : {
      id: positions[i]!.id, code: positions[i]!.code, name: positions[i]!.name,
      costPrice: positions[i]!.costPrice, amount: positions[i]!.amount,
      currentPrice: 0, signal: "hold" as const, inPosition: false,
      entryPrice: null, stopLoss: null, buyPrice: null, unrealizedPnlPct: null,
      stopTriggered: false, error: "请求失败",
    }
  );

  // 找出触发止损的持仓，发邮件预警
  const triggered = items.filter(item => item.stopTriggered);
  if (triggered.length > 0) {
    const rows = triggered.map(item => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0">${item.name || item.code}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0">${item.code}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0">${item.costPrice.toFixed(3)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;color:#ef4444;font-weight:600">${item.currentPrice.toFixed(3)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;color:#ef4444">${item.stopLoss?.toFixed(3) ?? "-"}</td>
      </tr>`).join("");

    await sendMail({
      subject: `⚠️ 海龟策略止损预警 - ${triggered.map(t => t.code).join(", ")}`,
      html: `
        <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
          <h2 style="color:#ef4444;margin-bottom:8px">⚠️ 海龟策略止损预警</h2>
          <p style="color:#666;margin-bottom:16px">以下持仓当前价格已触及或跌破海龟策略止损线，请及时处理：</p>
          <table style="width:100%;border-collapse:collapse;font-size:14px">
            <thead>
              <tr style="background:#f9fafb;color:#6b7280;font-size:12px">
                <th style="padding:8px 12px;text-align:left">名称</th>
                <th style="padding:8px 12px;text-align:left">代码</th>
                <th style="padding:8px 12px;text-align:left">成本价</th>
                <th style="padding:8px 12px;text-align:left">当前价</th>
                <th style="padding:8px 12px;text-align:left">止损价</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
          <p style="color:#9ca3af;font-size:12px;margin-top:16px">
            检查时间：${new Date().toLocaleString("zh-CN")} · 此邮件由持仓监控系统自动发送
          </p>
        </div>`,
    }).catch(err => console.error("[turtle-monitor] 邮件发送失败:", err));
  }

  return NextResponse.json({ items, checkedAt: new Date().toISOString(), triggeredCount: triggered.length });
}

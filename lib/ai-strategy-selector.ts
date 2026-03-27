/**
 * AI 自动策略选择器
 * 根据交易周期（短/中/长线）和当前市场状态，选择最适合的策略
 */

import { atrArr } from "./backtest-engine";

export type AiMode = "short" | "medium" | "long";

// 各周期对应的 K 线间隔和候选策略
export const AI_MODE_CONFIG: Record<AiMode, {
  label: string;
  interval: string;
  desc: string;
  strategies: { code: string; params: Record<string, number> }[];
}> = {
  short: {
    label: "短线",
    interval: "1h",
    desc: "1小时K线，追求快进快出，适合波动行情",
    strategies: [
      { code: "supertrend",    params: { atrPeriod: 10, mult: 3 } },
      { code: "rsi_divergence",params: { rsiPeriod: 14, signalPeriod: 9, oversold: 35, overbought: 65 } },
      { code: "vwap_revert",   params: { period: 20, threshold: 1.5 } },
      { code: "bb_squeeze",    params: { period: 20, mult: 2, lookback: 50 } },
      { code: "heikin_ashi_trend", params: { confirmBars: 3 } },
    ],
  },
  medium: {
    label: "中线",
    interval: "4h",
    desc: "4小时K线，持仓数天到数周，平衡收益与风险",
    strategies: [
      { code: "supertrend",    params: { atrPeriod: 10, mult: 3 } },
      { code: "ichimoku_cloud",params: { tenkan: 9, kijun: 26, senkouB: 52 } },
      { code: "ema_ribbon",    params: {} },
      { code: "funding_arb",   params: { maPeriod: 10, volPeriod: 20, threshold: 2 } },
      { code: "bb_squeeze",    params: { period: 20, mult: 2, lookback: 50 } },
    ],
  },
  long: {
    label: "长线",
    interval: "1d",
    desc: "日线K线，持仓数周到数月，趋势跟踪",
    strategies: [
      { code: "ichimoku_cloud",params: { tenkan: 9, kijun: 26, senkouB: 52 } },
      { code: "ema_ribbon",    params: {} },
      { code: "supertrend",    params: { atrPeriod: 14, mult: 3 } },
      { code: "turtle",        params: { entryPeriod: 20, exitPeriod: 10 } },
      { code: "heikin_ashi_trend", params: { confirmBars: 5 } },
    ],
  },
};

type Candle = { time: string; open: number; high: number; low: number; close: number; volume: number };

/**
 * 计算市场状态指标
 */
function analyzeMarket(candles: Candle[]) {
  const n = candles.length;
  const closes = candles.map(c => c.close);
  const last = candles[n - 1]!;

  // 波动率：近20根K线的ATR / 价格
  const atr = atrArr(candles, 20);
  const atrVal = atr[n - 1] ?? 0;
  const volatility = atrVal / last.close; // 相对波动率

  // 趋势强度：近20根收盘价的线性回归斜率
  const period = Math.min(20, n);
  const recentCloses = closes.slice(-period);
  const avgClose = recentCloses.reduce((a, b) => a + b, 0) / period;
  let slope = 0;
  let denom = 0;
  for (let i = 0; i < period; i++) {
    slope += (i - period / 2) * (recentCloses[i]! - avgClose);
    denom += (i - period / 2) ** 2;
  }
  const trendStrength = denom > 0 ? Math.abs(slope / denom / avgClose) : 0;

  // 是否处于趋势中（vs 震荡）
  const isTrending = trendStrength > volatility * 0.3;
  const isUptrend = slope > 0;

  return { volatility, trendStrength, isTrending, isUptrend };
}

/**
 * 根据市场状态从候选策略中选最优策略
 */
export function selectStrategy(candles: Candle[], mode: AiMode): { code: string; params: Record<string, number>; reason: string } {
  const config = AI_MODE_CONFIG[mode];
  const market = analyzeMarket(candles);

  let selected = config.strategies[0]!;
  let reason = "";

  if (market.isTrending) {
    // 趋势行情：选趋势跟踪策略
    const trendStrategies = ["turtle", "ma_cross", "ema_cross", "breakout", "dmi", "atr_break", "macd"];
    selected = config.strategies.find(s => trendStrategies.includes(s.code)) ?? config.strategies[0]!;
    reason = `市场处于${market.isUptrend ? "上升" : "下降"}趋势（趋势强度 ${(market.trendStrength * 100).toFixed(2)}%），选用趋势跟踪策略`;
  } else {
    // 震荡行情：选震荡指标策略
    const oscStrategies = ["boll_rsi", "kdj", "rsi", "boll", "macd_kdj", "cci"];
    selected = config.strategies.find(s => oscStrategies.includes(s.code)) ?? config.strategies[0]!;
    reason = `市场处于震荡行情（波动率 ${(market.volatility * 100).toFixed(2)}%），选用震荡指标策略`;
  }

  return { ...selected, reason };
}

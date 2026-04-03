/**
 * AI 自动策略选择器
 * 根据交易周期（短/中/长线）和当前市场状态，选择最适合的策略
 */

import { atrArr } from "./backtest-engine";
import OpenAI from "openai";

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

  // 各策略的倾向分类（趋势 vs 震荡）
  const trendCodes = new Set(["supertrend", "turtle", "turtle_crypto", "ema_ribbon", "ichimoku_cloud", "heikin_ashi_trend", "ma_cross", "ema_cross", "breakout", "dmi", "atr_break", "macd", "intraday_trend"]);
  const oscCodes   = new Set(["rsi_divergence", "vwap_revert", "bb_squeeze", "funding_arb", "boll_rsi", "kdj", "rsi", "boll", "macd_kdj", "cci", "stoch_rsi", "macd_scalp", "scalping_ema"]);

  let selected = config.strategies[0]!;
  let reason = "";

  if (market.isTrending) {
    const pick = config.strategies.find(s => trendCodes.has(s.code));
    selected = pick ?? config.strategies[0]!;
    reason = `市场处于${market.isUptrend ? "上升" : "下降"}趋势（趋势强度 ${(market.trendStrength * 100).toFixed(2)}%），选用趋势跟踪策略 [${selected.code}]`;
  } else {
    const pick = config.strategies.find(s => oscCodes.has(s.code));
    selected = pick ?? config.strategies[0]!;
    reason = `市场处于震荡行情（波动率 ${(market.volatility * 100).toFixed(2)}%），选用震荡指标策略 [${selected.code}]`;
  }

  return { ...selected, reason };
}

/**
 * 获取可用的 AI 客户端（按优先级：DeepSeek > 通义千问 > 智谱 > OpenAI）
 */
function getAiClient(): { client: OpenAI; model: string } | null {
  if (process.env.DEEPSEEK_API_KEY) {
    return {
      client: new OpenAI({ apiKey: process.env.DEEPSEEK_API_KEY, baseURL: "https://api.deepseek.com" }),
      model: "deepseek-chat",
    };
  }
  if (process.env.DASHSCOPE_API_KEY) {
    return {
      client: new OpenAI({ apiKey: process.env.DASHSCOPE_API_KEY, baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1" }),
      model: "qwen-plus",
    };
  }
  if (process.env.ZHIPU_API_KEY) {
    return {
      client: new OpenAI({ apiKey: process.env.ZHIPU_API_KEY, baseURL: "https://open.bigmodel.cn/api/paas/v4" }),
      model: "glm-4-flash",
    };
  }
  if (process.env.OPENAI_API_KEY) {
    return { client: new OpenAI({ apiKey: process.env.OPENAI_API_KEY }), model: "gpt-4o-mini" };
  }
  return null;
}

/**
 * 用 LLM 决策策略，失败时 fallback 到规则引擎
 */
export async function selectStrategyWithAI(
  candles: Candle[],
  mode: AiMode,
  symbol: string,
): Promise<{ code: string; params: Record<string, number>; reason: string; usedAI: boolean }> {
  const config = AI_MODE_CONFIG[mode];
  const market = analyzeMarket(candles);
  const ai = getAiClient();

  if (!ai) {
    // 没有配置任何 AI key，直接用规则引擎
    return { ...selectStrategy(candles, mode), usedAI: false };
  }

  // 构造给 LLM 的市场摘要
  const n = candles.length;
  const last = candles[n - 1]!;
  const prev5 = candles.slice(-6, -1).map(c => c.close);
  const pct5 = prev5.length > 0 ? ((last.close - prev5[0]!) / prev5[0]! * 100).toFixed(2) : "N/A";
  const candidateList = config.strategies.map(s => `- ${s.code}（参数：${JSON.stringify(s.params)}）`).join("\n");

  const prompt = `你是一个量化交易策略选择专家。请根据以下市场数据，从候选策略中选出最适合当前行情的一个策略。

## 市场数据
- 交易对：${symbol}
- 周期：${config.label}（${config.interval} K线）
- 当前价格：${last.close}
- 近5根K线涨跌幅：${pct5}%
- 相对波动率（ATR/价格）：${(market.volatility * 100).toFixed(3)}%
- 趋势强度：${(market.trendStrength * 100).toFixed(3)}%
- 市场状态：${market.isTrending ? (market.isUptrend ? "上升趋势" : "下降趋势") : "震荡行情"}

## 候选策略
${candidateList}

## 要求
只返回 JSON，格式如下，不要有任何其他文字：
{"code":"策略code","reason":"选择理由，50字以内"}`;

  try {
    const resp = await ai.client.chat.completions.create({
      model: ai.model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 200,
      temperature: 0.3,
    });

    const text = resp.choices[0]?.message?.content?.trim() ?? "";
    // 提取 JSON（防止模型多输出文字）
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("no json");

    const parsed = JSON.parse(jsonMatch[0]) as { code: string; reason: string };
    const matched = config.strategies.find(s => s.code === parsed.code);
    if (!matched) throw new Error(`unknown code: ${parsed.code}`);

    return { code: matched.code, params: matched.params, reason: `[AI] ${parsed.reason}`, usedAI: true };
  } catch {
    // AI 调用失败，fallback 到规则引擎
    const fallback = selectStrategy(candles, mode);
    return { ...fallback, reason: `[规则] ${fallback.reason}`, usedAI: false };
  }
}

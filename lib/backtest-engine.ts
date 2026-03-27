/**
 * 回测引擎 - 支持20种技术指标策略
 * 数据来源：新浪日线 OHLCV
 */

import { genCryptoSignals } from "./crypto-strategies";

export type Candle = { time: string; open: number; high: number; low: number; close: number; volume: number };
export type BacktestParams = Record<string, number>;
export type Trade = { entryDate: string; exitDate: string; entryPrice: number; exitPrice: number; pnl: number; pnlPct: number };
export type BacktestResult = {
  totalReturn: number; totalPnl: number; annualReturn: number;
  maxDrawdown: number; sharpe: number; sortino: number; calmar: number;
  tradeCount: number; winRate: number; avgHoldDays: number;
  avgWin: number; avgLoss: number; profitFactor: number;
  equityCurve: { date: string; value: number; benchmark: number }[];
  trades: Trade[];
  inPosition: boolean;
  entryPrice: number | null;
};

// ── 指标工具 ──────────────────────────────────────────────

function sma(arr: number[], p: number): (number | null)[] {
  return arr.map((_, i) => i < p - 1 ? null : arr.slice(i - p + 1, i + 1).reduce((a, b) => a + b, 0) / p);
}

function ema(arr: number[], p: number): (number | null)[] {
  const k = 2 / (p + 1);
  const out: (number | null)[] = new Array(p - 1).fill(null);
  let prev = arr.slice(0, p).reduce((a, b) => a + b, 0) / p;
  out.push(prev);
  for (let i = p; i < arr.length; i++) { prev = arr[i]! * k + prev * (1 - k); out.push(prev); }
  return out;
}

function trueRange(candles: Candle[]): number[] {
  return candles.map((c, i) => {
    if (i === 0) return c.high - c.low;
    const prev = candles[i - 1]!;
    return Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close));
  });
}

export function atrArr(candles: Candle[], p: number): (number | null)[] { return sma(trueRange(candles), p); }

function calcRsi(closes: number[], p: number): (number | null)[] {
  const out: (number | null)[] = new Array(p).fill(null);
  for (let i = p; i < closes.length; i++) {
    let g = 0, l = 0;
    for (let j = i - p + 1; j <= i; j++) { const d = closes[j]! - closes[j - 1]!; if (d > 0) g += d; else l -= d; }
    out.push(100 - 100 / (1 + (l === 0 ? 100 : g / l)));
  }
  return out;
}

function calcMacd(closes: number[], fast = 12, slow = 26, signal = 9) {
  const ef = ema(closes, fast), es = ema(closes, slow);
  const dif = closes.map((_, i) => ef[i] != null && es[i] != null ? ef[i]! - es[i]! : null);
  const validDif = dif.filter((v): v is number => v != null);
  const sigArr: (number | null)[] = new Array(dif.length - validDif.length).fill(null);
  const sigEma = ema(validDif, signal);
  sigArr.push(...sigEma);
  const hist = dif.map((d, i) => d != null && sigArr[i] != null ? d - sigArr[i]! : null);
  return { dif, dea: sigArr, hist };
}

function calcKdj(candles: Candle[], n = 9, m1 = 3, m2 = 3) {
  const len = candles.length;
  const k: number[] = [], d: number[] = [], j: number[] = [];
  let prevK = 50, prevD = 50;
  for (let i = 0; i < len; i++) {
    if (i < n - 1) { k.push(50); d.push(50); j.push(50); continue; }
    const slice = candles.slice(i - n + 1, i + 1);
    const low = Math.min(...slice.map(c => c.low));
    const high = Math.max(...slice.map(c => c.high));
    const rsv = high === low ? 50 : (candles[i]!.close - low) / (high - low) * 100;
    const kv = (m1 - 1) / m1 * prevK + rsv / m1;
    const dv = (m2 - 1) / m2 * prevD + kv / m2;
    k.push(kv); d.push(dv); j.push(3 * kv - 2 * dv);
    prevK = kv; prevD = dv;
  }
  return { k, d, j };
}

function calcBoll(closes: number[], p = 20, mult = 2) {
  const mid = sma(closes, p);
  const upper = mid.map((m, i) => {
    if (m == null) return null;
    const slice = closes.slice(i - p + 1, i + 1);
    const std = Math.sqrt(slice.reduce((s, v) => s + (v - m) ** 2, 0) / p);
    return m + mult * std;
  });
  const lower = mid.map((m, i) => {
    if (m == null) return null;
    const slice = closes.slice(i - p + 1, i + 1);
    const std = Math.sqrt(slice.reduce((s, v) => s + (v - m) ** 2, 0) / p);
    return m - mult * std;
  });
  return { mid, upper, lower };
}

function calcSar(candles: Candle[], step = 0.02, max = 0.2) {
  const len = candles.length;
  const sar: number[] = new Array(len).fill(0);
  let bull = true, af = step, ep = candles[0]!.high;
  sar[0] = candles[0]!.low;
  for (let i = 1; i < len; i++) {
    const c = candles[i]!, prev = candles[i - 1]!;
    let s = sar[i - 1]! + af * (ep - sar[i - 1]!);
    if (bull) {
      s = Math.min(s, prev.low, i > 1 ? candles[i - 2]!.low : prev.low);
      if (c.low < s) { bull = false; s = ep; af = step; ep = c.low; }
      else { if (c.high > ep) { ep = c.high; af = Math.min(af + step, max); } }
    } else {
      s = Math.max(s, prev.high, i > 1 ? candles[i - 2]!.high : prev.high);
      if (c.high > s) { bull = true; s = ep; af = step; ep = c.high; }
      else { if (c.low < ep) { ep = c.low; af = Math.min(af + step, max); } }
    }
    sar[i] = s;
  }
  return { sar, bull: candles.map((c, i) => c.close > sar[i]!) };
}

function calcDmi(candles: Candle[], p = 14, adxP = 14) {
  const len = candles.length;
  const pdm: number[] = [], ndm: number[] = [], tr: number[] = [];
  for (let i = 1; i < len; i++) {
    const c = candles[i]!, prev = candles[i - 1]!;
    const upMove = c.high - prev.high, downMove = prev.low - c.low;
    pdm.push(upMove > downMove && upMove > 0 ? upMove : 0);
    ndm.push(downMove > upMove && downMove > 0 ? downMove : 0);
    tr.push(Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close)));
  }
  const smaTr = sma(tr, p), smaPdm = sma(pdm, p), smaNdm = sma(ndm, p);
  const pdi = smaTr.map((t, i) => t && smaPdm[i] ? smaPdm[i]! / t * 100 : null);
  const ndi = smaTr.map((t, i) => t && smaNdm[i] ? smaNdm[i]! / t * 100 : null);
  const dx = pdi.map((p2, i) => p2 != null && ndi[i] != null ? Math.abs(p2 - ndi[i]!) / (p2 + ndi[i]!) * 100 : null);
  const validDx = dx.filter((v): v is number => v != null);
  const adxRaw = sma(validDx, adxP);
  const adx: (number | null)[] = new Array(dx.length - validDx.length).fill(null);
  adx.push(...adxRaw);
  // 补齐长度（pdm/ndm比candles少1）
  return {
    pdi: [null, ...pdi] as (number | null)[],
    ndi: [null, ...ndi] as (number | null)[],
    adx: [null, ...adx] as (number | null)[],
  };
}

function calcCci(candles: Candle[], p = 20): (number | null)[] {
  const tp = candles.map(c => (c.high + c.low + c.close) / 3);
  return tp.map((_, i) => {
    if (i < p - 1) return null;
    const slice = tp.slice(i - p + 1, i + 1);
    const mean = slice.reduce((a, b) => a + b, 0) / p;
    const md = slice.reduce((a, b) => a + Math.abs(b - mean), 0) / p;
    return md === 0 ? 0 : (tp[i]! - mean) / (0.015 * md);
  });
}

function calcTrix(closes: number[], p = 12, signal = 9) {
  const e1 = ema(closes, p), e2 = ema(e1.filter((v): v is number => v != null), p);
  const e3 = ema(e2.filter((v): v is number => v != null), p);
  const offset = closes.length - e3.length;
  const trix: (number | null)[] = new Array(offset).fill(null);
  for (let i = 1; i < e3.length; i++) {
    trix.push(e3[i] != null && e3[i - 1] != null && e3[i - 1] !== 0 ? (e3[i]! - e3[i - 1]!) / e3[i - 1]! * 100 : null);
  }
  const validTrix = trix.filter((v): v is number => v != null);
  const sigRaw = sma(validTrix, signal);
  const sig: (number | null)[] = new Array(trix.length - validTrix.length).fill(null);
  sig.push(...sigRaw);
  return { trix, sig };
}

function calcBias(closes: number[], p = 20): (number | null)[] {
  const ma = sma(closes, p);
  return closes.map((c, i) => ma[i] != null ? (c - ma[i]!) / ma[i]! * 100 : null);
}

function calcRoc(closes: number[], p = 12): (number | null)[] {
  return closes.map((c, i) => i < p ? null : (c - closes[i - p]!) / closes[i - p]! * 100);
}

// ── 策略定义 ──────────────────────────────────────────────

export type StrategyDef = {
  code: string;
  label: string;
  desc: string;
  params: { key: string; label: string; default: number }[];
};

export const STRATEGY_DEFS: StrategyDef[] = [
  { code: "ma_cross",  label: "双均线策略",          desc: "短期均线上穿长期均线买入，下穿卖出。最经典的趋势跟踪方法，适合趋势明显的行情。", params: [{ key: "fastPeriod", label: "快线周期", default: 20 }, { key: "slowPeriod", label: "慢线周期", default: 60 }] },
  { code: "ema_cross", label: "EMA交叉策略",         desc: "与双均线类似，但用指数移动均线，对近期价格更敏感，信号更快但噪音也更多。", params: [{ key: "fastPeriod", label: "快线周期", default: 12 }, { key: "slowPeriod", label: "慢线周期", default: 26 }] },
  { code: "triple_ma", label: "三均线策略",           desc: "短、中、长三条均线同时排列向上才买入，过滤掉更多假信号，信号更可靠但更少。", params: [{ key: "p1", label: "短期", default: 5 }, { key: "p2", label: "中期", default: 20 }, { key: "p3", label: "长期", default: 60 }] },
  { code: "breakout",  label: "均线突破策略",         desc: "价格突破均线时买入，跌破时卖出。简单直接，适合震荡后突破的行情。", params: [{ key: "breakoutPeriod", label: "突破周期", default: 20 }] },
  { code: "macd",      label: "MACD策略",            desc: "通过两条均线的差值判断趋势动能。金叉买入、死叉卖出，是最常用的技术指标之一。", params: [{ key: "fast", label: "快线", default: 12 }, { key: "slow", label: "慢线", default: 26 }, { key: "signal", label: "信号线", default: 9 }] },
  { code: "kdj",       label: "KDJ策略",             desc: "衡量价格超买超卖程度。K线从低位上穿D线买入，从高位下穿卖出，适合震荡行情。", params: [{ key: "n", label: "周期", default: 9 }, { key: "overbought", label: "超买线", default: 80 }, { key: "oversold", label: "超卖线", default: 20 }] },
  { code: "macd_kdj",  label: "MACD-KDJ组合策略",    desc: "MACD和KDJ同时发出信号才操作，双重确认减少误判，信号更少但更准。", params: [{ key: "fast", label: "MACD快线", default: 12 }, { key: "slow", label: "MACD慢线", default: 26 }, { key: "signal", label: "信号线", default: 9 }, { key: "n", label: "KDJ周期", default: 9 }] },
  { code: "rsi",       label: "RSI策略",             desc: "衡量涨跌力度。RSI跌到超卖区（如30以下）买入，涨到超买区（如70以上）卖出，适合震荡市。", params: [{ key: "rsiPeriod", label: "RSI周期", default: 14 }, { key: "rsiOversold", label: "超卖线", default: 30 }, { key: "rsiOverbought", label: "超买线", default: 70 }] },
  { code: "boll",      label: "布林带策略",           desc: "价格触碰下轨买入，触碰上轨卖出。布林带会随波动率自动扩缩，适合均值回归行情。", params: [{ key: "period", label: "周期", default: 20 }, { key: "mult", label: "倍数", default: 2 }] },
  { code: "boll_rsi",  label: "BOLL-RSI组合策略",    desc: "布林带下轨 + RSI超卖同时满足才买入，双重过滤，减少在下跌趋势中抄底的风险。", params: [{ key: "bollPeriod", label: "布林周期", default: 20 }, { key: "rsiPeriod", label: "RSI周期", default: 14 }, { key: "rsiOversold", label: "超卖线", default: 35 }] },
  { code: "sar",       label: "SAR抛物线策略",        desc: "价格在SAR点上方持有，跌破SAR点卖出。会随趋势自动追踪止损位，适合强趋势行情。", params: [{ key: "step", label: "步长(×0.01)", default: 2 }, { key: "max", label: "最大值(×0.01)", default: 20 }] },
  { code: "dmi",       label: "DMI趋向指标策略",      desc: "通过+DI和-DI判断多空力量对比，ADX衡量趋势强度。趋势强时跟随方向操作。", params: [{ key: "period", label: "周期", default: 14 }, { key: "adxThreshold", label: "ADX阈值", default: 25 }] },
  { code: "momentum",  label: "动量策略",             desc: "涨得快的继续买，跌得快的继续卖。基于「强者恒强」的惯性原理，适合趋势延续行情。", params: [{ key: "period", label: "动量周期", default: 20 }, { key: "threshold", label: "阈值(%)", default: 0 }] },
  { code: "roc",       label: "ROC变动率策略",        desc: "计算当前价格相对N天前的变化率，ROC上穿信号线买入，下穿卖出，捕捉加速上涨机会。", params: [{ key: "period", label: "ROC周期", default: 12 }, { key: "signal", label: "信号周期", default: 6 }] },
  { code: "cci",       label: "CCI策略",             desc: "衡量价格偏离均值的程度。CCI从超卖区回升买入，从超买区回落卖出，适合周期性波动品种。", params: [{ key: "period", label: "周期", default: 20 }, { key: "overbought", label: "超买线", default: 100 }, { key: "oversold", label: "超卖线", default: -100 }] },
  { code: "trix",      label: "TRIX三重指数平滑策略", desc: "对均线做三次平滑处理，过滤掉短期噪音，信号更稳定，适合中长线趋势跟踪。", params: [{ key: "period", label: "TRIX周期", default: 12 }, { key: "signal", label: "信号周期", default: 9 }] },
  { code: "bias",      label: "BIAS乖离率策略",       desc: "价格偏离均线过远时会回归。跌得太多（乖离率为负）买入，涨得太多卖出，适合震荡市。", params: [{ key: "period", label: "均线周期", default: 20 }, { key: "buyBias", label: "买入乖离(%)", default: -5 }, { key: "sellBias", label: "卖出乖离(%)", default: 5 }] },
  { code: "turtle",    label: "海龟交易策略",          desc: "价格突破N日最高点买入，跌破M日最低点卖出。华尔街经典趋势跟踪系统，适合大趋势行情。", params: [{ key: "entryPeriod", label: "入场周期", default: 20 }, { key: "exitPeriod", label: "出场周期", default: 10 }] },
  { code: "atr_break", label: "ATR波动率突破策略",    desc: "价格突破「均线 + ATR倍数」时买入，用波动率动态调整突破门槛，适合波动较大的加密货币。", params: [{ key: "maPeriod", label: "均线周期", default: 20 }, { key: "atrPeriod", label: "ATR周期", default: 14 }, { key: "atrMult", label: "ATR倍数", default: 1.5 }] },
  { code: "vol_break", label: "波动率突破策略",        desc: "布林带收窄后价格突破上轨买入，跌破下轨卖出。专门捕捉低波动后的爆发行情。", params: [{ key: "period", label: "周期", default: 20 }, { key: "mult", label: "布林倍数", default: 2 }] },
  { code: "dca",       label: "定期定额定投",           desc: "每隔固定周期无条件买入固定金额，不管涨跌都坚持买入，最终一次性卖出。适合长期持有、懒人投资。", params: [{ key: "interval", label: "定投间隔(根K线)", default: 7 }, { key: "perAmount", label: "每次定投金额", default: 1000 }] },
  { code: "va",        label: "价值平均定投",           desc: "目标市值每期增加固定金额，市值低于目标时多买，高于目标时少买甚至卖出，比定期定额更聪明。", params: [{ key: "interval", label: "定投间隔(根K线)", default: 7 }, { key: "perAmount", label: "每期目标增量", default: 1000 }, { key: "growthRate", label: "每期目标增长(%)", default: 1 }] },
];

// ── 信号生成 ──────────────────────────────────────────────

function genSignals(candles: Candle[], code: string, p: BacktestParams): (1 | -1 | 0)[] {
  // 路由到币圈专用策略
  const cryptoCodes = ["turtle_crypto", "supertrend", "vwap_revert", "ema_ribbon", "rsi_divergence", "bb_squeeze", "funding_arb", "ichimoku_cloud", "heikin_ashi_trend", "scalping_ema", "stoch_rsi", "macd_scalp", "breakout_scalp"];
  if (cryptoCodes.includes(code)) {
    return genCryptoSignals(candles, code, p);
  }

  const closes = candles.map(c => c.close);
  const n = candles.length;
  const sig: (1 | -1 | 0)[] = new Array(n).fill(0);

  const cross = (a: (number|null)[], b: (number|null)[], i: number) =>
    a[i] != null && b[i] != null && a[i-1] != null && b[i-1] != null && a[i]! > b[i]! && a[i-1]! <= b[i-1]!;
  const crossDown = (a: (number|null)[], b: (number|null)[], i: number) =>
    a[i] != null && b[i] != null && a[i-1] != null && b[i-1] != null && a[i]! < b[i]! && a[i-1]! >= b[i-1]!;

  if (code === "ma_cross") {
    const fast = sma(closes, p.fastPeriod ?? 20), slow = sma(closes, p.slowPeriod ?? 60);
    for (let i = 1; i < n; i++) { if (cross(fast, slow, i)) sig[i] = 1; else if (crossDown(fast, slow, i)) sig[i] = -1; }
  } else if (code === "ema_cross") {
    const fast = ema(closes, p.fastPeriod ?? 12), slow = ema(closes, p.slowPeriod ?? 26);
    for (let i = 1; i < n; i++) { if (cross(fast, slow, i)) sig[i] = 1; else if (crossDown(fast, slow, i)) sig[i] = -1; }
  } else if (code === "triple_ma") {
    const s = sma(closes, p.p1 ?? 5), m = sma(closes, p.p2 ?? 20), l = sma(closes, p.p3 ?? 60);
    for (let i = 1; i < n; i++) {
      if (s[i] != null && m[i] != null && l[i] != null && s[i-1] != null && m[i-1] != null && l[i-1] != null) {
        if (s[i]! > m[i]! && m[i]! > l[i]! && !(s[i-1]! > m[i-1]! && m[i-1]! > l[i-1]!)) sig[i] = 1;
        else if (s[i]! < m[i]! && m[i]! < l[i]! && !(s[i-1]! < m[i-1]! && m[i-1]! < l[i-1]!)) sig[i] = -1;
      }
    }
  } else if (code === "breakout") {
    const period = p.breakoutPeriod ?? 20;
    for (let i = period; i < n; i++) {
      const hi = Math.max(...candles.slice(i - period, i).map(c => c.high));
      const lo = Math.min(...candles.slice(i - period, i).map(c => c.low));
      if (closes[i]! > hi) sig[i] = 1; else if (closes[i]! < lo) sig[i] = -1;
    }
  } else if (code === "macd") {
    const { dif, dea } = calcMacd(closes, p.fast ?? 12, p.slow ?? 26, p.signal ?? 9);
    for (let i = 1; i < n; i++) { if (cross(dif, dea, i)) sig[i] = 1; else if (crossDown(dif, dea, i)) sig[i] = -1; }
  } else if (code === "kdj") {
    const { k, d } = calcKdj(candles, p.n ?? 9);
    const ob = p.overbought ?? 80, os = p.oversold ?? 20;
    for (let i = 1; i < n; i++) {
      if (k[i]! > d[i]! && k[i-1]! <= d[i-1]! && k[i]! < ob) sig[i] = 1;
      else if (k[i]! < d[i]! && k[i-1]! >= d[i-1]! && k[i]! > os) sig[i] = -1;
    }
  } else if (code === "macd_kdj") {
    const { dif, dea } = calcMacd(closes, p.fast ?? 12, p.slow ?? 26, p.signal ?? 9);
    const { k, d } = calcKdj(candles, p.n ?? 9);
    for (let i = 1; i < n; i++) {
      if (cross(dif, dea, i) && k[i]! > d[i]!) sig[i] = 1;
      else if (crossDown(dif, dea, i) && k[i]! < d[i]!) sig[i] = -1;
    }
  } else if (code === "rsi") {
    const r = calcRsi(closes, p.rsiPeriod ?? 14);
    const os = p.rsiOversold ?? 30, ob = p.rsiOverbought ?? 70;
    for (let i = 1; i < n; i++) {
      if (r[i] != null && r[i-1] != null) {
        if (r[i]! > os && r[i-1]! <= os) sig[i] = 1;
        else if (r[i]! < ob && r[i-1]! >= ob) sig[i] = -1;
      }
    }
  } else if (code === "boll") {
    const { upper, lower } = calcBoll(closes, p.period ?? 20, p.mult ?? 2);
    for (let i = 1; i < n; i++) {
      if (lower[i] != null && closes[i-1]! < lower[i-1]! && closes[i]! >= lower[i]!) sig[i] = 1;
      else if (upper[i] != null && closes[i-1]! > upper[i-1]! && closes[i]! <= upper[i]!) sig[i] = -1;
    }
  } else if (code === "boll_rsi") {
    const { lower } = calcBoll(closes, p.bollPeriod ?? 20, 2);
    const r = calcRsi(closes, p.rsiPeriod ?? 14);
    const os = p.rsiOversold ?? 35;
    for (let i = 1; i < n; i++) {
      if (lower[i] != null && closes[i]! <= lower[i]! && r[i] != null && r[i]! < os) sig[i] = 1;
      else if (r[i] != null && r[i-1] != null && r[i]! > 70 && r[i-1]! <= 70) sig[i] = -1;
    }
  } else if (code === "sar") {
    const { bull } = calcSar(candles, (p.step ?? 2) / 100, (p.max ?? 20) / 100);
    for (let i = 1; i < n; i++) {
      if (bull[i] && !bull[i-1]) sig[i] = 1; else if (!bull[i] && bull[i-1]) sig[i] = -1;
    }
  } else if (code === "dmi") {
    const { pdi, ndi, adx } = calcDmi(candles, p.period ?? 14, p.period ?? 14);
    const thr = p.adxThreshold ?? 25;
    for (let i = 1; i < n; i++) {
      if (cross(pdi, ndi, i) && adx[i] != null && adx[i]! > thr) sig[i] = 1;
      else if (crossDown(pdi, ndi, i)) sig[i] = -1;
    }
  } else if (code === "momentum") {
    const period = p.period ?? 20, thr = p.threshold ?? 0;
    for (let i = period + 1; i < n; i++) {
      const mom = closes[i]! - closes[i - period]!, prevMom = closes[i-1]! - closes[i - period - 1]!;
      if (mom > thr && prevMom <= thr) sig[i] = 1; else if (mom < -thr && prevMom >= -thr) sig[i] = -1;
    }
  } else if (code === "roc") {
    const r = calcRoc(closes, p.period ?? 12);
    const validR = r.filter((v): v is number => v != null);
    const sigRaw = sma(validR, p.signal ?? 6);
    const sigFull: (number|null)[] = new Array(r.length - validR.length).fill(null);
    sigFull.push(...sigRaw);
    for (let i = 1; i < n; i++) { if (cross(r, sigFull, i)) sig[i] = 1; else if (crossDown(r, sigFull, i)) sig[i] = -1; }
  } else if (code === "cci") {
    const c = calcCci(candles, p.period ?? 20);
    const ob = p.overbought ?? 100, os = p.oversold ?? -100;
    for (let i = 1; i < n; i++) {
      if (c[i] != null && c[i-1] != null) {
        if (c[i]! > os && c[i-1]! <= os) sig[i] = 1; else if (c[i]! < ob && c[i-1]! >= ob) sig[i] = -1;
      }
    }
  } else if (code === "trix") {
    const { trix, sig: sigLine } = calcTrix(closes, p.period ?? 12, p.signal ?? 9);
    for (let i = 1; i < n; i++) { if (cross(trix, sigLine, i)) sig[i] = 1; else if (crossDown(trix, sigLine, i)) sig[i] = -1; }
  } else if (code === "bias") {
    const b = calcBias(closes, p.period ?? 20);
    const buy = p.buyBias ?? -5, sell = p.sellBias ?? 5;
    for (let i = 1; i < n; i++) {
      if (b[i] != null && b[i-1] != null) {
        if (b[i]! > buy && b[i-1]! <= buy) sig[i] = 1; else if (b[i]! > sell && b[i-1]! <= sell) sig[i] = -1;
      }
    }
  } else if (code === "turtle") {
    const ep = p.entryPeriod ?? 20, xp = p.exitPeriod ?? 10;
    for (let i = Math.max(ep, xp); i < n; i++) {
      const entryHi = Math.max(...candles.slice(i - ep, i).map(c => c.high));
      const exitLo  = Math.min(...candles.slice(i - xp, i).map(c => c.low));
      if (closes[i]! > entryHi) sig[i] = 1; else if (closes[i]! < exitLo) sig[i] = -1;
    }
  } else if (code === "atr_break") {
    const ma = sma(closes, p.maPeriod ?? 20);
    const atr = atrArr(candles, p.atrPeriod ?? 14);
    const mult = p.atrMult ?? 1.5;
    for (let i = 1; i < n; i++) {
      if (ma[i] != null && atr[i] != null) {
        const upper = ma[i]! + atr[i]! * mult, lower = ma[i]! - atr[i]! * mult;
        if (closes[i-1]! < upper && closes[i]! >= upper) sig[i] = 1;
        else if (closes[i-1]! > lower && closes[i]! <= lower) sig[i] = -1;
      }
    }
  } else if (code === "vol_break") {
    const { upper, lower } = calcBoll(closes, p.period ?? 20, p.mult ?? 2);
    for (let i = 1; i < n; i++) {
      if (upper[i] != null && closes[i-1]! < upper[i-1]! && closes[i]! >= upper[i]!) sig[i] = 1;
      else if (lower[i] != null && closes[i-1]! > lower[i-1]! && closes[i]! <= lower[i]!) sig[i] = -1;
    }
  }
  return sig;
}

// ── 定投引擎 ──────────────────────────────────────────────

function runDCA(candles: Candle[], strategyCode: string, params: BacktestParams, initCapital: number): BacktestResult {
  const n = candles.length;
  const closes = candles.map(c => c.close);
  const interval = Math.max(1, Math.round(params.interval ?? 7));
  const growthRate = (params.growthRate ?? 1) / 100;

  const trades: Trade[] = [];
  const equity: number[] = [];

  let cash = initCapital;
  let shares = 0;
  let totalInvested = 0;
  const perAmount = params.perAmount ?? initCapital / Math.max(10, Math.floor(n / interval));
  let targetValue = 0;

  // 记录每次买入，用于图表买入点
  const buyLogs: { date: string; price: number; qty: number; amount: number }[] = [];

  for (let i = 0; i < n; i++) {
    const price = closes[i]!;

    if (i % interval === 0 && i < n - 1) {
      if (strategyCode === "dca") {
        const buyAmount = perAmount;
        if (buyAmount > 0 && price > 0) {
          const qty = buyAmount / price;
          shares += qty;
          totalInvested += buyAmount;
          buyLogs.push({ date: candles[i]!.time, price, qty, amount: buyAmount });
        }
      } else {
        // 价值平均
        const period = Math.floor(i / interval);
        targetValue = perAmount * (period + 1) * Math.pow(1 + growthRate, period);
        const currentValue = shares * price;
        const diff = targetValue - currentValue;
        if (diff > 0) {
          const buyAmount = diff;
          if (buyAmount > 0) {
            const qty = buyAmount / price;
            shares += qty;
            totalInvested += buyAmount;
            buyLogs.push({ date: candles[i]!.time, price, qty, amount: buyAmount });
          }
        } else if (diff < 0 && shares > 0) {
          const sellShares = Math.min(Math.abs(diff) / price, shares);
          const proceeds = sellShares * price;
          const avgCost = totalInvested / shares;
          const pnl = (price - avgCost) * sellShares;
          shares -= sellShares;
          totalInvested = Math.max(0, totalInvested - avgCost * sellShares);
          trades.push({ entryDate: candles[i]!.time, exitDate: candles[i]!.time, entryPrice: avgCost, exitPrice: price, pnl, pnlPct: (price - avgCost) / avgCost });
        }
      }
    }

    equity.push(shares * price);
  }

  // 最后一根K线全部卖出，每笔买入对应一笔卖出
  const lastPrice = closes[n - 1]!;
  const lastDate = candles[n - 1]!.time;
  for (const buy of buyLogs) {
    const pnl = (lastPrice - buy.price) * buy.qty;
    trades.push({ entryDate: buy.date, exitDate: lastDate, entryPrice: buy.price, exitPrice: lastPrice, pnl, pnlPct: (lastPrice - buy.price) / buy.price });
  }

  const finalValue = shares * lastPrice;
  const totalPnl = finalValue - totalInvested;
  const totalReturn = totalInvested > 0 ? totalPnl / totalInvested : 0;
  const days = Math.max(1, (new Date(candles[n-1]!.time).getTime() - new Date(candles[0]!.time).getTime()) / 86400000);
  const annualReturn = Math.pow(1 + totalReturn, 365 / days) - 1;

  let peak = equity[0] ?? 0, maxDrawdown = 0;
  for (const v of equity) { if (v > peak) peak = v; const dd = peak > 0 ? (peak - v) / peak : 0; if (dd > maxDrawdown) maxDrawdown = dd; }

  const dailyR = equity.slice(1).map((v, i) => (v - equity[i]!) / equity[i]!);
  const meanR = dailyR.reduce((a, b) => a + b, 0) / (dailyR.length || 1);
  const stdR = Math.sqrt(dailyR.reduce((s, r) => s + (r - meanR) ** 2, 0) / (dailyR.length || 1));
  const rfDaily = 0.02 / 252;
  const sharpe = stdR > 0 ? ((meanR - rfDaily) * 252) / (stdR * Math.sqrt(252)) : 0;
  const downR = dailyR.filter(r => r < rfDaily);
  const downStd = downR.length > 1 ? Math.sqrt(downR.reduce((s, r) => s + (r - rfDaily) ** 2, 0) / downR.length) : 0;
  const sortino = downStd > 0 ? ((meanR - rfDaily) * 252) / (downStd * Math.sqrt(252)) : 0;
  const calmar = maxDrawdown > 0 ? annualReturn / maxDrawdown : 0;

  const wins = trades.filter(t => t.pnl > 0), losses = trades.filter(t => t.pnl <= 0);
  const winRate = trades.length > 0 ? wins.length / trades.length : 0;
  const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? losses.reduce((s, t) => s + t.pnl, 0) / losses.length : 0;
  const totalWin = wins.reduce((s, t) => s + t.pnl, 0);
  const totalLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const profitFactor = totalLoss > 0 ? totalWin / totalLoss : totalWin > 0 ? 999 : 0;

  const step = Math.max(1, Math.floor(n / 300));
  const benchmarkStart = closes[0]!;
  const equityCurve = candles.filter((_, i) => i % step === 0).map((c, idx) => ({
    date: c.time.slice(0, 10),
    value: Math.round(equity[idx * step] ?? initCapital),
    benchmark: Math.round(initCapital * (c.close / benchmarkStart)),
  }));

  return { totalReturn, totalPnl, annualReturn, maxDrawdown, sharpe, sortino, calmar, tradeCount: buyLogs.length, winRate, avgHoldDays: days / Math.max(1, buyLogs.length), avgWin, avgLoss, profitFactor, equityCurve, trades, inPosition: shares > 0, entryPrice: shares > 0 ? lastPrice : null };
}

// ── 主引擎 ────────────────────────────────────────────────

// ── 海龟策略专用引擎 ──────────────────────────────────────
function runTurtle(
  candles: Candle[], params: BacktestParams,
  initCapital: number, mode: "simple" | "compound",
): BacktestResult {
  const n = candles.length;
  const closes = candles.map(c => c.close);
  const ep = params.entryPeriod ?? 20;
  const xp = params.exitPeriod ?? 10;
  const atrPeriod = 20; // 海龟原版用20日ATR
  const atrVals = atrArr(candles, atrPeriod);
  const benchmarkStart = closes[0]!;

  const trades: Trade[] = [];
  const equity: number[] = [initCapital];
  let capital = initCapital;

  // 头寸状态
  let units: { price: number; shares: number; date: string }[] = [];
  let stopLoss = 0;

  for (let i = Math.max(ep, xp, atrPeriod); i < n; i++) {
    const price = closes[i]!;
    const c = candles[i]!;
    const atr = atrVals[i] ?? price * 0.02;

    // ── 平仓检查 ──
    if (units.length > 0) {
      const exitLo = Math.min(...candles.slice(i - xp, i).map(c2 => c2.low));
      const hitStop = c.low <= stopLoss;
      const hitExit = price < exitLo;

      if (hitStop || hitExit) {
        const exitPrice = hitStop ? Math.min(stopLoss, price) : price;
        // 每个 Unit 单独记录一笔 trade，图表上可以看到每次加仓的买入点
        for (const u of units) {
          const pnl = (exitPrice - u.price) * u.shares;
          trades.push({
            entryDate: u.date,
            exitDate: c.time,
            entryPrice: u.price,
            exitPrice,
            pnl,
            pnlPct: exitPrice / u.price - 1,
          });
          capital += pnl;
        }
        units = [];
      }
    }

    // ── 入场 / 加仓检查 ──
    if (units.length < 4) {
      const entryHi = Math.max(...candles.slice(i - ep, i).map(c2 => c2.high));
      const base = mode === "simple" ? initCapital : capital;

      // 每个 Unit 的股数：账户资金 * 1% / ATR（风险单位）
      const unitShares = Math.max(1, Math.floor((base * 0.01) / atr));

      if (units.length === 0 && price > entryHi) {
        // 初始突破入场
        units.push({ price, shares: unitShares, date: c.time });
        stopLoss = price - 2 * atr;
      } else if (units.length > 0) {
        // 加仓：每涨 0.5N 加一个 Unit
        const lastEntry = units[units.length - 1]!.price;
        if (price >= lastEntry + 0.5 * atr) {
          units.push({ price, shares: unitShares, date: c.time });
          // 止损统一上移到最新入场价 - 2N
          stopLoss = price - 2 * atr;
        }
      }
    }

    const totalShares = units.reduce((s, u) => s + u.shares, 0);
    equity.push(capital + (totalShares > 0 ? (price - units.reduce((s, u) => s + u.price * u.shares, 0) / totalShares) * totalShares : 0));
  }

  // 填充前面没有计算的 equity
  while (equity.length < n) equity.unshift(initCapital);

  // 记录最终持仓状态（强制平仓前）
  const finalInPosition = units.length > 0;
  const finalEntryPrice = units.length > 0
    ? units.reduce((s, u) => s + u.price * u.shares, 0) / units.reduce((s, u) => s + u.shares, 0)
    : null;

  // 强制平仓
  if (units.length > 0) {
    const last = candles[n - 1]!;
    for (const u of units) {
      const pnl = (last.close - u.price) * u.shares;
      trades.push({ entryDate: u.date, exitDate: last.time, entryPrice: u.price, exitPrice: last.close, pnl, pnlPct: last.close / u.price - 1 });
      capital += pnl;
    }
    equity[equity.length - 1] = capital;
  }

  const totalPnl = capital - initCapital;
  const totalReturn = totalPnl / initCapital;
  const days = Math.max(1, (new Date(candles[n-1]!.time).getTime() - new Date(candles[0]!.time).getTime()) / 86400000);
  const annualReturn = Math.pow(1 + totalReturn, 365 / days) - 1;

  let peak = initCapital, maxDrawdown = 0;
  for (const v of equity) { if (v > peak) peak = v; const dd = (peak - v) / peak; if (dd > maxDrawdown) maxDrawdown = dd; }

  const dailyR = equity.slice(1).map((v, i) => (v - equity[i]!) / equity[i]!);
  const meanR = dailyR.reduce((a, b) => a + b, 0) / (dailyR.length || 1);
  const stdR = Math.sqrt(dailyR.reduce((s, r) => s + (r - meanR) ** 2, 0) / (dailyR.length || 1));
  const rfDaily = 0.02 / 252;
  const sharpe = stdR > 0 ? ((meanR - rfDaily) * 252) / (stdR * Math.sqrt(252)) : 0;
  const downR = dailyR.filter(r => r < rfDaily);
  const downStd = downR.length > 1 ? Math.sqrt(downR.reduce((s, r) => s + (r - rfDaily) ** 2, 0) / downR.length) : 0;
  const sortino = downStd > 0 ? ((meanR - rfDaily) * 252) / (downStd * Math.sqrt(252)) : 0;
  const calmar = maxDrawdown > 0 ? annualReturn / maxDrawdown : 0;

  const wins = trades.filter(t => t.pnl > 0), losses = trades.filter(t => t.pnl <= 0);
  const winRate = trades.length > 0 ? wins.length / trades.length : 0;
  const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? losses.reduce((s, t) => s + t.pnl, 0) / losses.length : 0;
  const totalWin = wins.reduce((s, t) => s + t.pnl, 0);
  const totalLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const profitFactor = totalLoss > 0 ? totalWin / totalLoss : totalWin > 0 ? 999 : 0;
  const avgHoldDays = trades.length > 0
    ? trades.reduce((s, t) => s + (new Date(t.exitDate).getTime() - new Date(t.entryDate).getTime()) / 86400000, 0) / trades.length
    : 0;

  const step = Math.max(1, Math.floor(n / 300));
  const equityCurve = candles.filter((_, i) => i % step === 0).map((c, idx) => ({
    date: c.time.slice(0, 10),
    value: Math.round(equity[idx * step] ?? initCapital),
    benchmark: Math.round(initCapital * (c.close / benchmarkStart)),
  }));

  return { totalReturn, totalPnl, annualReturn, maxDrawdown, sharpe, sortino, calmar, tradeCount: trades.length, winRate, avgHoldDays, avgWin, avgLoss, profitFactor, equityCurve, trades, inPosition: finalInPosition, entryPrice: finalEntryPrice };
}

export function runEngine(
  candles: Candle[], strategyCode: string, params: BacktestParams,
  initCapital: number, mode: "simple" | "compound",
): BacktestResult {
  // ── 定投策略单独处理 ──────────────────────────────────
  if (strategyCode === "dca" || strategyCode === "va") {
    return runDCA(candles, strategyCode, params, initCapital);
  }

  // ── 海龟策略单独处理（头寸管理）──────────────────────
  if (strategyCode === "turtle") {
    return runTurtle(candles, params, initCapital, mode);
  }

  const n = candles.length;
  const closes = candles.map(c => c.close);
  const signals = genSignals(candles, strategyCode, params);
  const atrVals = atrArr(candles, params.atrPeriod ?? 14);
  const atrMult = params.atrMult ?? 2;

  const trades: Trade[] = [];
  let capital = initCapital, inPosition = false;
  let entryPrice = 0, entryDate = "", stopLoss = 0, shares = 0;
  const equity: number[] = [initCapital];
  const benchmarkStart = closes[0]!;

  for (let i = 1; i < n; i++) {
    const price = closes[i]!, c = candles[i]!;
    if (inPosition) {
      const hitStop = c.low <= stopLoss, exitSig = signals[i] === -1;
      if (hitStop || exitSig) {
        const exitPrice = hitStop ? Math.min(stopLoss, price) : price;
        const pnl = mode === "compound"
          ? (exitPrice / entryPrice - 1) * capital
          : (exitPrice - entryPrice) * shares;
        trades.push({ entryDate, exitDate: c.time, entryPrice, exitPrice, pnl, pnlPct: exitPrice / entryPrice - 1 });
        capital += pnl; inPosition = false;
      }
    }
    if (!inPosition && signals[i] === 1) {
      entryPrice = price; entryDate = c.time;
      const a = atrVals[i] ?? price * 0.02;
      stopLoss = entryPrice - a * atrMult;
      const base = mode === "simple" ? initCapital : capital;
      shares = Math.max(100, Math.floor(base / entryPrice / 100) * 100);
      inPosition = true;
    }
    equity.push(capital);
  }

  // 记录循环结束时的真实持仓状态（在强制平仓前）
  const finalInPosition = inPosition;
  const finalEntryPrice = inPosition ? entryPrice : null;

  if (inPosition) {
    const last = candles[n - 1]!;
    const pnl = mode === "compound"
      ? (last.close / entryPrice - 1) * capital
      : (last.close - entryPrice) * shares;
    trades.push({ entryDate, exitDate: last.time, entryPrice, exitPrice: last.close, pnl, pnlPct: last.close / entryPrice - 1 });
    capital += pnl; equity[equity.length - 1] = capital;
  }

  const totalPnl = capital - initCapital;
  const totalReturn = totalPnl / initCapital;
  const days = Math.max(1, (new Date(candles[n-1]!.time).getTime() - new Date(candles[0]!.time).getTime()) / 86400000);
  const annualReturn = Math.pow(1 + totalReturn, 365 / days) - 1;

  let peak = initCapital, maxDrawdown = 0;
  for (const v of equity) { if (v > peak) peak = v; const dd = (peak - v) / peak; if (dd > maxDrawdown) maxDrawdown = dd; }

  const dailyR = equity.slice(1).map((v, i) => (v - equity[i]!) / equity[i]!);
  const meanR = dailyR.reduce((a, b) => a + b, 0) / dailyR.length;
  const stdR = Math.sqrt(dailyR.reduce((s, r) => s + (r - meanR) ** 2, 0) / dailyR.length);
  const rfDaily = 0.02 / 252;
  const sharpe = stdR > 0 ? ((meanR - rfDaily) * 252) / (stdR * Math.sqrt(252)) : 0;
  const downR = dailyR.filter(r => r < rfDaily);
  const downStd = downR.length > 1 ? Math.sqrt(downR.reduce((s, r) => s + (r - rfDaily) ** 2, 0) / downR.length) : 0;
  const sortino = downStd > 0 ? ((meanR - rfDaily) * 252) / (downStd * Math.sqrt(252)) : 0;
  const calmar = maxDrawdown > 0 ? annualReturn / maxDrawdown : 0;

  const wins = trades.filter(t => t.pnl > 0), losses = trades.filter(t => t.pnl <= 0);
  const winRate = trades.length > 0 ? wins.length / trades.length : 0;
  const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? losses.reduce((s, t) => s + t.pnl, 0) / losses.length : 0;
  const totalWin = wins.reduce((s, t) => s + t.pnl, 0);
  const totalLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const profitFactor = totalLoss > 0 ? totalWin / totalLoss : totalWin > 0 ? 999 : 0;
  const avgHoldDays = trades.length > 0
    ? trades.reduce((s, t) => s + (new Date(t.exitDate).getTime() - new Date(t.entryDate).getTime()) / 86400000, 0) / trades.length
    : 0;

  const step = Math.max(1, Math.floor(n / 300));
  const equityCurve = candles.filter((_, i) => i % step === 0).map((c, idx) => ({
    date: c.time.slice(0, 10),
    value: Math.round(equity[idx * step] ?? initCapital),
    benchmark: Math.round(initCapital * (c.close / benchmarkStart)),
  }));

  return { totalReturn, totalPnl, annualReturn, maxDrawdown, sharpe, sortino, calmar, tradeCount: trades.length, winRate, avgHoldDays, avgWin, avgLoss, profitFactor, equityCurve, trades, inPosition: finalInPosition, entryPrice: finalEntryPrice };
}

// ── 实时信号 ──────────────────────────────────────────────

export type LiveSignal = {
  signal: "buy" | "sell" | "hold";
  inPosition: boolean;
  entryPrice: number | null;
  entryDate: string | null;
  currentPrice: number;
  unrealizedPnlPct: number | null;
  stopLoss: number | null;
  buyPrice: { low: number; high: number } | number | null; // 买入触发价或区间
};

export function getLatestSignal(
  candles: Candle[], strategyCode: string, params: BacktestParams,
): LiveSignal {
  const signals = genSignals(candles, strategyCode, params);
  const atrVals = atrArr(candles, params.atrPeriod ?? 14);
  const atrMult = params.atrMult ?? 2;
  const n = candles.length;

  let inPosition = false, entryPrice = 0, entryDate = "", stopLoss = 0;

  for (let i = 1; i < n; i++) {
    const c = candles[i]!;
    if (inPosition) {
      const hitStop = c.low <= stopLoss, exitSig = signals[i] === -1;
      if (hitStop || exitSig) { inPosition = false; entryPrice = 0; entryDate = ""; stopLoss = 0; }
    }
    if (!inPosition && signals[i] === 1) {
      entryPrice = c.close; entryDate = c.time;
      const a = atrVals[i] ?? c.close * 0.02;
      stopLoss = entryPrice - a * atrMult;
      inPosition = true;
    }
  }

  const last = candles[n - 1]!;
  const latestSig = signals[n - 1]!;
  const closes = candles.map(c => c.close);

  // 计算买入触发价
  let buyPrice: LiveSignal["buyPrice"] = null;
  if (!inPosition) {
    const p = params;
    if (strategyCode === "ma_cross" || strategyCode === "ema_cross") {
      const fn = strategyCode === "ema_cross" ? ema : sma;
      const slow = fn(closes, p.slowPeriod ?? 60);
      const sv = slow[n - 1];
      if (sv != null) buyPrice = { low: sv * 0.998, high: sv * 1.005 };
    } else if (strategyCode === "triple_ma") {
      const m = sma(closes, p.p2 ?? 20);
      const mv = m[n - 1];
      if (mv != null) buyPrice = { low: mv * 0.998, high: mv * 1.005 };
    } else if (strategyCode === "breakout" || strategyCode === "turtle") {
      const period = strategyCode === "turtle" ? (p.entryPeriod ?? 20) : (p.breakoutPeriod ?? 20);
      const hi = Math.max(...candles.slice(n - period - 1, n - 1).map(c => c.high));
      buyPrice = hi;
    } else if (strategyCode === "macd" || strategyCode === "macd_kdj") {
      const { dif, dea } = calcMacd(closes, p.fast ?? 12, p.slow ?? 26, p.signal ?? 9);
      const d = dif[n - 1], e = dea[n - 1];
      if (d != null && e != null && d < e) {
        // MACD 金叉需要 dif 上穿 dea，估算触发价为当前价附近 ±1%
        buyPrice = { low: last.close * 0.99, high: last.close * 1.01 };
      }
    } else if (strategyCode === "boll" || strategyCode === "boll_rsi" || strategyCode === "vol_break") {
      const { lower } = calcBoll(closes, p.bollPeriod ?? p.period ?? 20, p.mult ?? 2);
      const lv = lower[n - 1];
      if (lv != null) buyPrice = { low: lv * 0.995, high: lv * 1.005 };
    } else if (strategyCode === "rsi") {
      const os = p.rsiOversold ?? 30;
      // RSI 从超卖区回升，买入价参考当前价
      buyPrice = { low: last.close * 0.98, high: last.close * 1.01 };
      void os;
    } else if (strategyCode === "kdj") {
      const { k, d } = calcKdj(candles, p.n ?? 9);
      const kv = k[n - 1], dv = d[n - 1];
      if (kv != null && dv != null && kv < dv) {
        buyPrice = { low: last.close * 0.99, high: last.close * 1.01 };
      }
    } else if (strategyCode === "atr_break") {
      const ma = sma(closes, p.maPeriod ?? 20);
      const atr = atrArr(candles, p.atrPeriod ?? 14);
      const mv = ma[n - 1], av = atr[n - 1];
      if (mv != null && av != null) buyPrice = mv + av * (p.atrMult ?? 1.5);
    } else if (strategyCode === "sar") {
      const { sar } = calcSar(candles, (p.step ?? 2) / 100, (p.max ?? 20) / 100);
      const sv = sar[n - 1];
      if (sv != null && sv < last.close) buyPrice = sv;
    } else if (strategyCode === "momentum" || strategyCode === "roc" || strategyCode === "trix" || strategyCode === "cci" || strategyCode === "bias" || strategyCode === "dmi") {
      buyPrice = { low: last.close * 0.99, high: last.close * 1.02 };
    }
  }

  return {
    signal: latestSig === 1 ? "buy" : latestSig === -1 ? "sell" : "hold",
    inPosition,
    entryPrice: inPosition ? entryPrice : null,
    entryDate: inPosition ? entryDate : null,
    currentPrice: last.close,
    unrealizedPnlPct: inPosition ? (last.close - entryPrice) / entryPrice : null,
    stopLoss: inPosition ? stopLoss : null,
    buyPrice,
  };
}

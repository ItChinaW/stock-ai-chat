/**
 * 币圈专用策略
 * 针对加密货币高波动、24小时交易、短线特性设计
 */

import type { Candle, BacktestParams, StrategyDef } from "./backtest-engine";

// ── 指标工具（内部复用）────────────────────────────────────

function ema(arr: number[], p: number): (number | null)[] {
  const k = 2 / (p + 1);
  const out: (number | null)[] = new Array(p - 1).fill(null);
  let prev = arr.slice(0, p).reduce((a, b) => a + b, 0) / p;
  out.push(prev);
  for (let i = p; i < arr.length; i++) { prev = arr[i]! * k + prev * (1 - k); out.push(prev); }
  return out;
}

function sma(arr: number[], p: number): (number | null)[] {
  return arr.map((_, i) => i < p - 1 ? null : arr.slice(i - p + 1, i + 1).reduce((a, b) => a + b, 0) / p);
}

function trueRange(candles: Candle[]): number[] {
  return candles.map((c, i) => {
    if (i === 0) return c.high - c.low;
    const prev = candles[i - 1]!;
    return Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close));
  });
}

function atr(candles: Candle[], p: number): (number | null)[] {
  return sma(trueRange(candles), p);
}

function calcRsi(closes: number[], p: number): (number | null)[] {
  const out: (number | null)[] = new Array(p).fill(null);
  for (let i = p; i < closes.length; i++) {
    let g = 0, l = 0;
    for (let j = i - p + 1; j <= i; j++) { const d = closes[j]! - closes[j - 1]!; if (d > 0) g += d; else l -= d; }
    out.push(100 - 100 / (1 + (l === 0 ? 100 : g / l)));
  }
  return out;
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

// ADX 计算（用于趋势强度过滤）
function calcAdx(candles: Candle[], p = 14): (number | null)[] {
  const n = candles.length;
  const pdm: number[] = [], ndm: number[] = [], tr: number[] = [];
  for (let i = 0; i < n; i++) {
    if (i === 0) { pdm.push(0); ndm.push(0); tr.push(candles[i]!.high - candles[i]!.low); continue; }
    const c = candles[i]!, prev = candles[i - 1]!;
    const upMove = c.high - prev.high, downMove = prev.low - c.low;
    pdm.push(upMove > downMove && upMove > 0 ? upMove : 0);
    ndm.push(downMove > upMove && downMove > 0 ? downMove : 0);
    tr.push(Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close)));
  }
  const smoothTr = sma(tr, p), smoothPdm = sma(pdm, p), smoothNdm = sma(ndm, p);
  const dx: (number | null)[] = smoothTr.map((t, i) => {
    if (t == null || t === 0 || smoothPdm[i] == null || smoothNdm[i] == null) return null;
    const pdi = (smoothPdm[i]! / t) * 100, ndi = (smoothNdm[i]! / t) * 100;
    const sum = pdi + ndi;
    return sum === 0 ? 0 : (Math.abs(pdi - ndi) / sum) * 100;
  });
  const validDx = dx.filter((v): v is number => v != null);
  const adxSmooth = sma(validDx, p);
  const adx: (number | null)[] = new Array(dx.length - adxSmooth.length).fill(null);
  adx.push(...adxSmooth);
  return adx;
}

// ── 币圈策略信号生成 ───────────────────────────────────────

export function genCryptoSignals(candles: Candle[], code: string, p: BacktestParams): (1 | -1 | 0)[] {
  const closes = candles.map(c => c.close);
  const n = candles.length;
  const sig: (1 | -1 | 0)[] = new Array(n).fill(0);

  const cross = (a: (number | null)[], b: (number | null)[], i: number) =>
    a[i] != null && b[i] != null && a[i - 1] != null && b[i - 1] != null && a[i]! > b[i]! && a[i - 1]! <= b[i - 1]!;
  const crossDown = (a: (number | null)[], b: (number | null)[], i: number) =>
    a[i] != null && b[i] != null && a[i - 1] != null && b[i - 1] != null && a[i]! < b[i]! && a[i - 1]! >= b[i - 1]!;

  if (code === "supertrend") {
    // SuperTrend：ATR 动态止损线，价格在线上做多，线下做空
    const atrVals = atr(candles, p.atrPeriod ?? 10);
    const mult = p.mult ?? 3;
    const upper: number[] = [], lower: number[] = [];
    const trend: number[] = []; // 1=多 -1=空
    for (let i = 0; i < n; i++) {
      const a = atrVals[i] ?? 0;
      const hl2 = (candles[i]!.high + candles[i]!.low) / 2;
      const bu = hl2 + mult * a, bl = hl2 - mult * a;
      upper.push(i === 0 ? bu : (bu < (upper[i - 1] ?? bu) || closes[i - 1]! > (upper[i - 1] ?? bu) ? bu : upper[i - 1]!));
      lower.push(i === 0 ? bl : (bl > (lower[i - 1] ?? bl) || closes[i - 1]! < (lower[i - 1] ?? bl) ? bl : lower[i - 1]!));
      if (i === 0) { trend.push(1); continue; }
      const prevTrend = trend[i - 1]!;
      if (prevTrend === -1 && closes[i]! > upper[i - 1]!) trend.push(1);
      else if (prevTrend === 1 && closes[i]! < lower[i - 1]!) trend.push(-1);
      else trend.push(prevTrend);
    }
    for (let i = 1; i < n; i++) {
      if (trend[i] === 1 && trend[i - 1] === -1) sig[i] = 1;
      else if (trend[i] === -1 && trend[i - 1] === 1) sig[i] = -1;
    }

  } else if (code === "vwap_revert") {
    // VWAP 均值回归：价格跌破 VWAP 一定幅度后反弹买入
    const threshold = (p.threshold ?? 1.5) / 100;
    // 用成交量加权均价（近N根K线）
    const vwapPeriod = p.period ?? 20;
    for (let i = vwapPeriod; i < n; i++) {
      const slice = candles.slice(i - vwapPeriod, i);
      const totalVol = slice.reduce((s, c) => s + c.volume, 0);
      const vwap = totalVol > 0
        ? slice.reduce((s, c) => s + (c.high + c.low + c.close) / 3 * c.volume, 0) / totalVol
        : closes[i]!;
      const deviation = (closes[i]! - vwap) / vwap;
      const prevDeviation = i > 0 ? (closes[i - 1]! - vwap) / vwap : 0;
      if (deviation > -threshold && prevDeviation <= -threshold) sig[i] = 1;  // 从低位回升
      else if (deviation > threshold) sig[i] = -1;  // 偏离过高卖出
    }

  } else if (code === "ema_ribbon") {
    // EMA 彩带：多条 EMA 全部排列向上才买入，任一反转卖出
    const periods = [8, 13, 21, 34, 55];
    const emas = periods.map(p => ema(closes, p));
    for (let i = 1; i < n; i++) {
      const vals = emas.map(e => e[i]);
      const prevVals = emas.map(e => e[i - 1]);
      if (vals.every(v => v != null) && prevVals.every(v => v != null)) {
        const bullish = vals.every((v, j) => j === 0 || v! < vals[j - 1]!);
        const prevBullish = prevVals.every((v, j) => j === 0 || v! < prevVals[j - 1]!);
        if (bullish && !prevBullish) sig[i] = 1;
        else if (!bullish && prevBullish) sig[i] = -1;
      }
    }

  } else if (code === "rsi_divergence") {
    // RSI 背离 + 超卖反弹：RSI 超卖后金叉买入，超买后死叉卖出
    const rsiVals = calcRsi(closes, p.rsiPeriod ?? 14);
    const rsiSig = ema(rsiVals.filter((v): v is number => v != null), p.signalPeriod ?? 9);
    const rsiSigFull: (number | null)[] = new Array(rsiVals.length - rsiSig.length).fill(null);
    rsiSigFull.push(...rsiSig);
    const os = p.oversold ?? 35, ob = p.overbought ?? 65;
    for (let i = 1; i < n; i++) {
      const r = rsiVals[i], rs = rsiSigFull[i], pr = rsiVals[i - 1], prs = rsiSigFull[i - 1];
      if (r != null && rs != null && pr != null && prs != null) {
        if (r > rs && pr <= prs && r < ob) sig[i] = 1;
        else if (r < rs && pr >= prs && r > os) sig[i] = -1;
      }
    }

  } else if (code === "bb_squeeze") {
    // 布林带收缩突破：布林带宽度收窄到历史低位后，价格突破上轨买入
    const bollPeriod = p.period ?? 20;
    const { upper, lower, mid } = calcBoll(closes, bollPeriod, p.mult ?? 2);
    const bandWidth = upper.map((u, i) => u != null && lower[i] != null && mid[i] != null
      ? (u - lower[i]!) / mid[i]! : null);
    const bwSma = sma(bandWidth.filter((v): v is number => v != null), p.lookback ?? 50);
    const bwFull: (number | null)[] = new Array(bandWidth.length - bwSma.length).fill(null);
    bwFull.push(...bwSma);
    for (let i = 1; i < n; i++) {
      const bw = bandWidth[i], pbw = bwFull[i];
      if (bw != null && pbw != null) {
        const isSqueeze = bw < pbw * 0.8; // 当前宽度 < 历史均值80%
        if (isSqueeze && upper[i] != null && closes[i]! > upper[i]! && closes[i - 1]! <= upper[i - 1]!) sig[i] = 1;
        else if (lower[i] != null && closes[i]! < lower[i]! && closes[i - 1]! >= lower[i - 1]!) sig[i] = -1;
      }
    }

  } else if (code === "funding_arb") {
    // 资金费率套利模拟：用价格偏离短期均线 + 成交量放大判断超买超卖
    const maPeriod = p.maPeriod ?? 10;
    const volPeriod = p.volPeriod ?? 20;
    const maVals = ema(closes, maPeriod);
    const volumes = candles.map(c => c.volume);
    const volMa = sma(volumes, volPeriod);
    const threshold = (p.threshold ?? 2) / 100;
    for (let i = 1; i < n; i++) {
      const ma = maVals[i], vm = volMa[i];
      if (ma == null || vm == null) continue;
      const dev = (closes[i]! - ma) / ma;
      const prevDev = maVals[i - 1] != null ? (closes[i - 1]! - maVals[i - 1]!) / maVals[i - 1]! : 0;
      const volSpike = volumes[i]! > vm * 1.5; // 成交量放大
      if (dev > -threshold && prevDev <= -threshold && volSpike) sig[i] = 1;
      else if (dev > threshold && volSpike) sig[i] = -1;
    }

  } else if (code === "ichimoku_cloud") {
    // 一目均衡表：价格突破云层上方买入，跌破云层下方卖出
    const tenkanPeriod = p.tenkan ?? 9;
    const kijunPeriod = p.kijun ?? 26;
    const senkouBPeriod = p.senkouB ?? 52;
    const tenkan: (number | null)[] = [], kijun: (number | null)[] = [];
    for (let i = 0; i < n; i++) {
      if (i < tenkanPeriod - 1) { tenkan.push(null); } else {
        const sl = candles.slice(i - tenkanPeriod + 1, i + 1);
        tenkan.push((Math.max(...sl.map(c => c.high)) + Math.min(...sl.map(c => c.low))) / 2);
      }
      if (i < kijunPeriod - 1) { kijun.push(null); } else {
        const sl = candles.slice(i - kijunPeriod + 1, i + 1);
        kijun.push((Math.max(...sl.map(c => c.high)) + Math.min(...sl.map(c => c.low))) / 2);
      }
    }
    // 先行带A = (tenkan + kijun) / 2，先行带B = senkouB周期高低均值
    const senkouA = tenkan.map((t, i) => t != null && kijun[i] != null ? (t + kijun[i]!) / 2 : null);
    const senkouB: (number | null)[] = [];
    for (let i = 0; i < n; i++) {
      if (i < senkouBPeriod - 1) { senkouB.push(null); } else {
        const sl = candles.slice(i - senkouBPeriod + 1, i + 1);
        senkouB.push((Math.max(...sl.map(c => c.high)) + Math.min(...sl.map(c => c.low))) / 2);
      }
    }
    for (let i = 1; i < n; i++) {
      const sa = senkouA[i], sb = senkouB[i];
      if (sa == null || sb == null) continue;
      const cloudTop = Math.max(sa, sb), cloudBot = Math.min(sa, sb);
      if (closes[i]! > cloudTop && closes[i - 1]! <= cloudTop) sig[i] = 1;
      else if (closes[i]! < cloudBot && closes[i - 1]! >= cloudBot) sig[i] = -1;
    }

  } else if (code === "heikin_ashi_trend") {
    // 平均K线趋势：连续N根平均K线同色确认趋势
    const confirmBars = p.confirmBars ?? 3;
    const ha: { open: number; close: number }[] = [];
    for (let i = 0; i < n; i++) {
      const c = candles[i]!;
      const haClose = (c.open + c.high + c.low + c.close) / 4;
      const haOpen = i === 0 ? (c.open + c.close) / 2 : (ha[i - 1]!.open + ha[i - 1]!.close) / 2;
      ha.push({ open: haOpen, close: haClose });
    }
    for (let i = confirmBars; i < n; i++) {
      const recent = ha.slice(i - confirmBars + 1, i + 1);
      const allBull = recent.every(h => h.close > h.open);
      const allBear = recent.every(h => h.close < h.open);
      const prevRecent = ha.slice(i - confirmBars, i);
      const prevAllBull = prevRecent.every(h => h.close > h.open);
      const prevAllBear = prevRecent.every(h => h.close < h.open);
      if (allBull && !prevAllBull) sig[i] = 1;
      else if (allBear && !prevAllBear) sig[i] = -1;
    }

  } else if (code === "turtle_crypto") {
    // 海龟交易策略（币圈版）
    // 入场：价格突破近T根K线最高点（唐奇安上轨）
    // 离场：价格跌破近T/2根K线最低点（唐奇安下轨，及时止损）
    // 止损：价格相对上次买入价下跌 2*ATR 清仓
    // 加仓信号：价格相对上次买入价上涨 0.5*ATR（在回测引擎层面体现为持续持仓）
    const T = p.entryPeriod ?? 20;
    const exitT = Math.max(2, Math.floor(T / 2));
    const atrP = p.atrPeriod ?? 5;
    const stopMult = p.stopMult ?? 2;
    const atrVals = atr(candles, atrP);

    let holdFlag = false;
    let lastBuyPrice = 0;

    for (let i = Math.max(T, atrP); i < n; i++) {
      const price = closes[i]!;
      const a = atrVals[i] ?? price * 0.02;

      if (holdFlag) {
        // 止损：下跌超过 2*ATR
        if (price <= lastBuyPrice - stopMult * a) {
          sig[i] = -1;
          holdFlag = false;
        }
        // 离场：跌破唐奇安下轨（T/2 周期最低点）
        else {
          const downChannel = Math.min(...candles.slice(i - exitT, i).map(c => c.low));
          if (price < downChannel) {
            sig[i] = -1;
            holdFlag = false;
          }
          // 加仓：上涨超过 0.5*ATR，更新买入价（信号层面继续持仓）
          else if (price >= lastBuyPrice + 0.5 * a) {
            lastBuyPrice = price;
          }
        }
      } else {
        // 入场：突破唐奇安上轨（T 周期最高点）
        const upChannel = Math.max(...candles.slice(i - T, i).map(c => c.high));
        if (price > upChannel) {
          sig[i] = 1;
          holdFlag = true;
          lastBuyPrice = price;
        }
      }
    }

  } else if (code === "scalping_ema") {
    // Scalping EMA：超短线 EMA3/EMA8 金叉死叉，配合价格在 EMA21 上下过滤方向
    const fastP = p.fastPeriod ?? 3;
    const slowP = p.slowPeriod ?? 8;
    const trendP = p.trendPeriod ?? 21;
    const fastEma = ema(closes, fastP);
    const slowEma = ema(closes, slowP);
    const trendEma = ema(closes, trendP);
    for (let i = 1; i < n; i++) {
      const f = fastEma[i], s = slowEma[i], t = trendEma[i];
      const pf = fastEma[i - 1], ps = slowEma[i - 1];
      if (f == null || s == null || t == null || pf == null || ps == null) continue;
      // 金叉且价格在趋势线上方 → 买入
      if (f > s && pf <= ps && closes[i]! > t) sig[i] = 1;
      // 死叉且价格在趋势线下方 → 卖出
      else if (f < s && pf >= ps && closes[i]! < t) sig[i] = -1;
    }

  } else if (code === "stoch_rsi") {
    // Stochastic RSI：RSI 的随机指标，比 RSI 更灵敏，专为短线设计
    const rsiP = p.rsiPeriod ?? 14;
    const stochP = p.stochPeriod ?? 14;
    const smoothK = p.smoothK ?? 3;
    const smoothD = p.smoothD ?? 3;
    const ob = p.overbought ?? 80;
    const os = p.oversold ?? 20;
    const rsiVals = calcRsi(closes, rsiP);
    // 计算 StochRSI
    const stochRsi: (number | null)[] = [];
    for (let i = 0; i < rsiVals.length; i++) {
      if (i < rsiP + stochP - 2) { stochRsi.push(null); continue; }
      const slice = rsiVals.slice(i - stochP + 1, i + 1).filter((v): v is number => v != null);
      if (slice.length < stochP) { stochRsi.push(null); continue; }
      const minR = Math.min(...slice), maxR = Math.max(...slice);
      stochRsi.push(maxR === minR ? 50 : ((rsiVals[i]! - minR) / (maxR - minR)) * 100);
    }
    const kLine = sma(stochRsi.filter((v): v is number => v != null), smoothK);
    const kFull: (number | null)[] = new Array(stochRsi.length - kLine.length).fill(null);
    kFull.push(...kLine);
    const dLine = sma(kLine.filter((v): v is number => v != null), smoothD);
    const dFull: (number | null)[] = new Array(kFull.length - dLine.length).fill(null);
    dFull.push(...dLine);
    for (let i = 1; i < n; i++) {
      const k = kFull[i], d = dFull[i], pk = kFull[i - 1], pd = dFull[i - 1];
      if (k == null || d == null || pk == null || pd == null) continue;
      // K线从超卖区上穿D线 → 买入
      if (k > d && pk <= pd && k < ob) sig[i] = 1;
      // K线从超买区下穿D线 → 卖出
      else if (k < d && pk >= pd && k > os) sig[i] = -1;
    }

  } else if (code === "macd_scalp") {
    // MACD Scalp：快速参数 MACD（5/13/4），专为短线日内交易设计
    const fastP = p.fastPeriod ?? 5;
    const slowP = p.slowPeriod ?? 13;
    const signalP = p.signalPeriod ?? 4;
    const fastEma = ema(closes, fastP);
    const slowEma = ema(closes, slowP);
    const macdLine: (number | null)[] = fastEma.map((f, i) =>
      f != null && slowEma[i] != null ? f - slowEma[i]! : null
    );
    const macdVals = macdLine.filter((v): v is number => v != null);
    const signalLine = ema(macdVals, signalP);
    const signalFull: (number | null)[] = new Array(macdLine.length - signalLine.length).fill(null);
    signalFull.push(...signalLine);
    for (let i = 1; i < n; i++) {
      const m = macdLine[i], s = signalFull[i], pm = macdLine[i - 1], ps = signalFull[i - 1];
      if (m == null || s == null || pm == null || ps == null) continue;
      // MACD 金叉且在零轴附近（避免追高）
      if (m > s && pm <= ps && m < Math.abs(closes[i]!) * 0.005) sig[i] = 1;
      // MACD 死叉
      else if (m < s && pm >= ps) sig[i] = -1;
    }

  } else if (code === "breakout_scalp") {
    // 价格突破 Scalp：突破近N根K线的最高/最低点，配合成交量确认
    const lookback = p.lookback ?? 10;
    const volMult = p.volMult ?? 1.2;
    const volumes = candles.map(c => c.volume);
    const volMa = sma(volumes, lookback);
    for (let i = lookback; i < n; i++) {
      const prevCandles = candles.slice(i - lookback, i);
      const highestHigh = Math.max(...prevCandles.map(c => c.high));
      const lowestLow = Math.min(...prevCandles.map(c => c.low));
      const vm = volMa[i];
      if (vm == null) continue;
      const volConfirm = volumes[i]! > vm * volMult;
      // 向上突破近期高点 + 成交量放大
      if (closes[i]! > highestHigh && closes[i - 1]! <= highestHigh && volConfirm) sig[i] = 1;
      // 向下跌破近期低点
      else if (closes[i]! < lowestLow && closes[i - 1]! >= lowestLow) sig[i] = -1;
    }

  } else if (code === "intraday_trend") {
    // 日内趋势跟随策略
    // 逻辑：EMA(fastP) 上穿 EMA(slowP) 且 ADX > adxThreshold（趋势足够强）时买入
    //       EMA(fastP) 下穿 EMA(slowP) 时卖出
    //       额外用 EMA(trendP) 过滤大方向，只在大趋势方向上开仓
    const fastP = p.fastPeriod ?? 9;
    const slowP = p.slowPeriod ?? 21;
    const trendP = p.trendPeriod ?? 55;
    const adxP = p.adxPeriod ?? 14;
    const adxThr = p.adxThreshold ?? 20;

    const fastEma = ema(closes, fastP);
    const slowEma = ema(closes, slowP);
    const trendEma = ema(closes, trendP);
    const adxVals = calcAdx(candles, adxP);

    for (let i = 1; i < n; i++) {
      const f = fastEma[i], s = slowEma[i], t = trendEma[i], adxV = adxVals[i];
      const pf = fastEma[i - 1], ps = slowEma[i - 1];
      if (f == null || s == null || t == null || adxV == null || pf == null || ps == null) continue;

      const trendStrong = adxV > adxThr;
      // 金叉 + 趋势强 + 价格在长期均线上方（多头市场）
      if (f > s && pf <= ps && trendStrong && closes[i]! > t) sig[i] = 1;
      // 死叉 + 价格在长期均线下方（空头市场）
      else if (f < s && pf >= ps && closes[i]! < t) sig[i] = -1;
    }
  }

  return sig;
}

// ── 币圈策略定义 ───────────────────────────────────────────

export const CRYPTO_STRATEGY_DEFS: StrategyDef[] = [
  {
    code: "turtle_crypto",
    label: "海龟交易策略",
    desc: "经典海龟系统币圈版。唐奇安通道上轨突破入场，T/2下轨跌破止盈离场；上涨0.5ATR自动加仓（最多4次），下跌2ATR强制止损清仓。趋势跟随+动态止损。",
    params: [
      { key: "entryPeriod", label: "入场周期T", default: 20 },
      { key: "atrPeriod", label: "ATR周期", default: 5 },
      { key: "stopMult", label: "止损ATR倍数", default: 2 },
    ],
  },
  {
    code: "supertrend",
    label: "SuperTrend 超级趋势",
    desc: "基于 ATR 动态计算支撑/压力线，价格在线上持多，跌破翻空。币圈最流行的趋势跟踪指标，适合各周期。",
    params: [
      { key: "atrPeriod", label: "ATR周期", default: 10 },
      { key: "mult", label: "ATR倍数", default: 3 },
    ],
  },
  {
    code: "vwap_revert",
    label: "VWAP 均值回归",
    desc: "价格偏离成交量加权均价（VWAP）过远时反向操作。短线主力常用 VWAP 作为成本线，偏离后回归概率高。",
    params: [
      { key: "period", label: "VWAP周期", default: 20 },
      { key: "threshold", label: "偏离阈值(%)", default: 1.5 },
    ],
  },
  {
    code: "ema_ribbon",
    label: "EMA 彩带策略",
    desc: "5条 EMA（8/13/21/34/55）全部多头排列才买入，任一反转立即卖出。多重均线过滤假信号，适合趋势行情。",
    params: [],
  },
  {
    code: "rsi_divergence",
    label: "RSI 信号线策略",
    desc: "RSI 与其信号线（EMA）金叉死叉操作，在超买超卖区域过滤。比单纯 RSI 更灵敏，适合短线波段。",
    params: [
      { key: "rsiPeriod", label: "RSI周期", default: 14 },
      { key: "signalPeriod", label: "信号线周期", default: 9 },
      { key: "oversold", label: "超卖线", default: 35 },
      { key: "overbought", label: "超买线", default: 65 },
    ],
  },
  {
    code: "bb_squeeze",
    label: "布林带收缩突破",
    desc: "布林带宽度收窄到历史低位（能量积蓄）后，价格突破上轨买入。专门捕捉低波动后的爆发行情，币圈常见。",
    params: [
      { key: "period", label: "布林周期", default: 20 },
      { key: "mult", label: "布林倍数", default: 2 },
      { key: "lookback", label: "历史对比周期", default: 50 },
    ],
  },
  {
    code: "funding_arb",
    label: "量价背离策略",
    desc: "价格偏离短期均线 + 成交量放大时操作，捕捉主力资金推动的方向性行情，适合高流动性交易对。",
    params: [
      { key: "maPeriod", label: "均线周期", default: 10 },
      { key: "volPeriod", label: "成交量均线", default: 20 },
      { key: "threshold", label: "偏离阈值(%)", default: 2 },
    ],
  },
  {
    code: "ichimoku_cloud",
    label: "一目均衡表",
    desc: "日本经典技术分析，价格突破云层上方做多，跌破云层下方做空。综合趋势、支撑、动量于一体。",
    params: [
      { key: "tenkan", label: "转换线周期", default: 9 },
      { key: "kijun", label: "基准线周期", default: 26 },
      { key: "senkouB", label: "先行带B周期", default: 52 },
    ],
  },
  {
    code: "heikin_ashi_trend",
    label: "平均K线趋势",
    desc: "用平均K线（Heikin Ashi）过滤噪音，连续N根同色K线确认趋势后入场。视觉直观，减少假信号。",
    params: [
      { key: "confirmBars", label: "确认K线数", default: 3 },
    ],
  },
  {
    code: "scalping_ema",
    label: "Scalping EMA 超短线",
    desc: "EMA3/EMA8 快速金叉死叉，以 EMA21 过滤大方向。专为 1m/5m 日内高频设计，信号频繁，适合短线刷单。",
    params: [
      { key: "fastPeriod", label: "快线周期", default: 3 },
      { key: "slowPeriod", label: "慢线周期", default: 8 },
      { key: "trendPeriod", label: "趋势过滤周期", default: 21 },
    ],
  },
  {
    code: "stoch_rsi",
    label: "Stochastic RSI",
    desc: "RSI 的随机化版本，比普通 RSI 灵敏数倍。K线从超卖区上穿D线买入，从超买区下穿卖出。日内短线首选。",
    params: [
      { key: "rsiPeriod", label: "RSI周期", default: 14 },
      { key: "stochPeriod", label: "Stoch周期", default: 14 },
      { key: "smoothK", label: "K线平滑", default: 3 },
      { key: "smoothD", label: "D线平滑", default: 3 },
      { key: "oversold", label: "超卖线", default: 20 },
      { key: "overbought", label: "超买线", default: 80 },
    ],
  },
  {
    code: "macd_scalp",
    label: "MACD Scalp 快速版",
    desc: "使用快速参数（5/13/4）的 MACD，比标准版（12/26/9）快近3倍。专为日内短线设计，捕捉小级别动量转换。",
    params: [
      { key: "fastPeriod", label: "快线周期", default: 5 },
      { key: "slowPeriod", label: "慢线周期", default: 13 },
      { key: "signalPeriod", label: "信号线周期", default: 4 },
    ],
  },
  {
    code: "breakout_scalp",
    label: "高低点突破 Scalp",
    desc: "突破近N根K线的最高点买入，跌破最低点卖出，配合成交量放大确认。纯价格行为策略，适合波动剧烈的短线行情。",
    params: [
      { key: "lookback", label: "回看K线数", default: 10 },
      { key: "volMult", label: "成交量放大倍数", default: 1.2 },
    ],
  },
  {
    code: "intraday_trend",
    label: "日内趋势跟随",
    desc: "EMA(9/21) 金叉死叉 + ADX 趋势强度过滤 + EMA(55) 大方向确认。只在趋势明确（ADX > 阈值）且大方向一致时入场，避免震荡市频繁假信号。适合 1h/4h 日内波段。",
    params: [
      { key: "fastPeriod", label: "快线周期", default: 9 },
      { key: "slowPeriod", label: "慢线周期", default: 21 },
      { key: "trendPeriod", label: "趋势过滤周期", default: 55 },
      { key: "adxPeriod", label: "ADX周期", default: 14 },
      { key: "adxThreshold", label: "ADX趋势阈值", default: 20 },
    ],
  },
];

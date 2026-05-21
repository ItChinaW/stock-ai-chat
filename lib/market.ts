export type QuoteItem = {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  previousClose: number;
  currency?: string;
  // 美股盘前 / 盘后（仅在有数据且与盘中价不同时透出）
  extendedSession?: "pre" | "post";
  extendedPrice?: number;
  extendedChangePercent?: number;
  // 延长时段数据是否已过期（处于无 tick 空档，比如美东 20:00-04:00 之间）
  extendedStale?: boolean;
  // 美股夜盘（Blue Ocean ATS，20:00-04:00 ET），来自 Webull
  overnightPrice?: number;
  overnightChangePercent?: number;
};

const DEFAULT_TIMEOUT_MS = 8000;

// 转换为新浪格式：600001 -> sh600001，000001 -> sz000001
export function toSinaSymbol(symbol: string): string {
  const s = symbol.toLowerCase();
  if (s.startsWith("sh") || s.startsWith("sz") || s.startsWith("bj")) return s;
  if (s.startsWith("gb_") || s.startsWith("hf_") || s.startsWith("fx_")) return s;
  if (symbol.startsWith(".")) return `gb_${symbol.slice(1).toLowerCase()}`;
  if (!/^\d{6}$/.test(symbol)) return `gb_${symbol.toLowerCase()}`;
  const isSH = /^(6|5|11)/.test(symbol);
  return `${isSH ? "sh" : "sz"}${symbol}`;
}

async function fetchSinaQuotes(symbols: string[]): Promise<QuoteItem[]> {
  if (symbols.length === 0) return [];

  const sinaSymbols = symbols.map(toSinaSymbol).join(",");
  const url = `https://hq.sinajs.cn/list=${sinaSymbols}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
      headers: { Referer: "https://finance.sina.com.cn" },
    });
    const buf = await res.arrayBuffer();
    const text = new TextDecoder("gbk").decode(buf);
    const lines = text.trim().split("\n");

    return lines.map((line, i): QuoteItem | null => {
      const symbol = symbols[i]!;
      const match = line.match(/="([^"]+)"/);
      if (!match) return null;
      const parts = match[1]!.split(",");

      const isUS = toSinaSymbol(symbol).startsWith("gb_");

      let name: string, price: number, prevClose: number, change: number, changePercent: number;

      if (isUS) {
        // 美股格式: 名称, 当前价, 涨跌幅%, 时间, 涨跌额, 今开, ...
        name = parts[0] ?? "";
        price = parseFloat(parts[1] ?? "0");
        changePercent = parseFloat(parts[2] ?? "0");
        change = parseFloat(parts[4] ?? "0");
        prevClose = price - change;
      } else {
        // A股格式: 名称, 今开, 昨收, 当前价, ...
        name = parts[0] ?? "";
        price = parseFloat(parts[3] ?? "0");
        prevClose = parseFloat(parts[2] ?? "0");
        // 开盘前当前价为0，用昨收价代替
        if (price === 0 && prevClose > 0) price = prevClose;
        change = price - prevClose;
        changePercent = prevClose > 0 ? (change / prevClose) * 100 : 0;
      }

      if (!name || price === 0) return null;
      return {
        symbol,
        name,
        price,
        change,
        changePercent,
        previousClose: prevClose,
        currency: isUS ? "USD" : "CNY",
      } satisfies QuoteItem;
    }).filter((v): v is QuoteItem => v != null);
  } finally {
    clearTimeout(timeout);
  }
}

// 东方财富 secid 映射（目前仅保留确认可用的品种）
const EASTMONEY_SYMBOL_MAP: Record<string, { secid: string; currency: string }> = {
  "em_sse":    { secid: "1.000001",  currency: "CNY" },
  "em_ndx":    { secid: "100.NDX",   currency: "USD" },
  "em_n225":   { secid: "100.N225",  currency: "JPY" },
  "em_ks11":   { secid: "100.KS11",  currency: "KRW" },
  "em_twii":   { secid: "100.TWII",  currency: "TWD" },
  "em_hsi":    { secid: "100.HSI",   currency: "HKD" },
  "em_ftse":   { secid: "100.FTSE",  currency: "GBP" },
};

// 新浪期货/外汇行情（hf_ / fx_ 前缀），格式与股票不同
const isHfSymbol = (s: string) => s.startsWith("hf_");
const isFxSymbol = (s: string) => s.startsWith("fx_");

async function fetchSinaHfQuotes(symbols: string[]): Promise<QuoteItem[]> {
  if (symbols.length === 0) return [];
  const joined = symbols.join(",");
  const url = `https://hq.sinajs.cn/list=${joined}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
      headers: { Referer: "https://finance.sina.com.cn" },
    });
    const buf = await res.arrayBuffer();
    const text = new TextDecoder("gbk").decode(buf);
    const lines = text.trim().split("\n");
    return lines.map((line, i): QuoteItem | null => {
      const symbol = symbols[i]!;
      const match = line.match(/="([^"]+)"/);
      if (!match) return null;
      const parts = match[1]!.split(",");
      if (isFxSymbol(symbol)) {
        // fx 格式: 时间,买价,卖价,现价,...,名称,...
        const price = parseFloat(parts[3] ?? "0");
        const prevClose = parseFloat(parts[4] ?? "0") || price;
        const name = parts[9] ?? symbol;
        if (!price) return null;
        return { symbol, name, price, change: price - prevClose, changePercent: prevClose > 0 ? (price - prevClose) / prevClose * 100 : 0, previousClose: prevClose, currency: "CNY" };
      } else {
        // hf 格式: 价格,,买,卖,最高,最低,时间,昨收,均价,...,名称
        const price = parseFloat(parts[0] ?? "0");
        const prevClose = parseFloat(parts[7] ?? "0") || price;
        const name = parts[13] ?? symbol;
        if (!price) return null;
        return { symbol, name, price, change: price - prevClose, changePercent: prevClose > 0 ? (price - prevClose) / prevClose * 100 : 0, previousClose: prevClose, currency: "USD" };
      }
    }).filter((v): v is QuoteItem => v != null);
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchEastMoneyQuotes(symbols: string[]): Promise<QuoteItem[]> {
  if (symbols.length === 0) return [];

  const secids = symbols.map((s) => EASTMONEY_SYMBOL_MAP[s]!.secid).join(",");
  const url = `https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&invt=2&fields=f1,f2,f3,f4,f12,f14&secids=${secids}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const res = await fetch(url, { cache: "no-store", signal: controller.signal });
    const json = await res.json() as {
      data: { diff: { f2: number; f3: number; f4: number; f12: string; f14: string }[] };
    };

    const diffMap = new Map(json.data.diff.map((d) => [d.f12, d]));

    return symbols.map((symbol): QuoteItem | null => {
      const meta = EASTMONEY_SYMBOL_MAP[symbol]!;
      const key = meta.secid.split(".")[1]!;
      const d = diffMap.get(key);
      if (!d || !d.f2) return null;
      return {
        symbol,
        name: d.f14,
        price: d.f2,
        change: d.f4,
        changePercent: d.f3,
        previousClose: d.f2 - d.f4,
        currency: meta.currency,
      } satisfies QuoteItem;
    }).filter((v): v is QuoteItem => v != null);
  } finally {
    clearTimeout(timeout);
  }
}

export type Candle = {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

// 判断是否为海外股票（非A股）
export function isOverseasSymbol(symbol: string): boolean {
  const s = symbol.toLowerCase();
  if (s.startsWith("sh") || s.startsWith("sz")) return false;
  if (/^\d{6}$/.test(symbol)) return false;
  return true;
}

// Yahoo Finance K线数据（用于海外股票）
export async function fetchYahooKline(
  symbol: string,
  startDate: string,
  endDate: string,
): Promise<Candle[]> {
  const start = Math.floor(new Date(startDate).getTime() / 1000);
  const end = Math.floor(new Date(endDate).getTime() / 1000);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&period1=${start}&period2=${end}&events=history`;

  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Accept: "application/json",
    },
    next: { revalidate: 300 },
  });

  if (!res.ok) throw new Error(`Yahoo Finance 请求失败: ${res.status}`);

  const json = await res.json() as {
    chart: {
      result?: {
        timestamp: number[];
        indicators: {
          quote: { open: number[]; high: number[]; low: number[]; close: number[]; volume: number[] }[];
        };
      }[];
      error?: { description: string };
    };
  };

  if (json.chart.error) throw new Error(json.chart.error.description);
  const result = json.chart.result?.[0];
  if (!result) return [];

  const { timestamp, indicators } = result;
  const quote = indicators.quote[0];
  if (!quote) return [];

  return timestamp
    .map((ts, i) => ({
      time: new Date(ts * 1000).toISOString().slice(0, 10),
      open: quote.open[i] ?? 0,
      high: quote.high[i] ?? 0,
      low: quote.low[i] ?? 0,
      close: quote.close[i] ?? 0,
      volume: quote.volume[i] ?? 0,
    }))
    .filter((c) => c.open > 0 && c.close > 0);
}

// Yahoo Finance K线（不限日期，获取最近 N 条）
export async function fetchYahooKlineRecent(symbol: string, datalen = 300): Promise<Candle[]> {
  const end = Math.floor(Date.now() / 1000);
  // 多取一些天数以保证足够数据（交易日约为自然日的 70%）
  const start = end - Math.ceil(datalen / 0.7) * 86400;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&period1=${start}&period2=${end}&events=history`;

  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
    next: { revalidate: 300 },
  });

  if (!res.ok) return [];

  const json = await res.json() as {
    chart: {
      result?: {
        timestamp: number[];
        indicators: {
          quote: { open: number[]; high: number[]; low: number[]; close: number[]; volume: number[] }[];
        };
      }[];
    };
  };

  const result = json.chart.result?.[0];
  if (!result) return [];
  const { timestamp, indicators } = result;
  const quote = indicators.quote[0];
  if (!quote) return [];

  return timestamp
    .map((ts, i) => ({
      time: new Date(ts * 1000).toISOString().slice(0, 10),
      open: quote.open[i] ?? 0,
      high: quote.high[i] ?? 0,
      low: quote.low[i] ?? 0,
      close: quote.close[i] ?? 0,
      volume: quote.volume[i] ?? 0,
    }))
    .filter((c) => c.open > 0 && c.close > 0)
    .slice(-datalen);
}

export async function fetchYahooQuotes(symbols: string[]): Promise<QuoteItem[]> {
  const emSymbols = symbols.filter((s) => s in EASTMONEY_SYMBOL_MAP);
  const hfFxSymbols = symbols.filter((s) => isHfSymbol(s) || isFxSymbol(s));
  // 美股走 Yahoo v8 chart（带盘前/盘后），其他走新浪
  const otherSymbols = symbols.filter((s) => !(s in EASTMONEY_SYMBOL_MAP) && !isHfSymbol(s) && !isFxSymbol(s));
  const usSymbols = otherSymbols.filter((s) => toSinaSymbol(s).startsWith("gb_"));
  const sinaSymbols = otherSymbols.filter((s) => !toSinaSymbol(s).startsWith("gb_"));

  const [emResults, hfResults, sinaResults, usResults] = await Promise.all([
    fetchEastMoneyQuotes(emSymbols),
    fetchSinaHfQuotes(hfFxSymbols),
    fetchSinaQuotes(sinaSymbols),
    fetchYahooUSQuotes(usSymbols),
  ]);

  const resultMap = new Map([...emResults, ...hfResults, ...sinaResults, ...usResults].map((r) => [r.symbol, r]));
  return symbols.map((s) => resultMap.get(s)).filter((v): v is QuoteItem => v != null);
}

// 美股行情（含盘前/盘后）：Yahoo v8 chart + includePrePost=true
// v7 quote 现已要求 crumb 鉴权，改用 v8 chart 走 1m 分钟线判断当前会话状态。
// 夜盘 (Blue Ocean ATS) 数据来自 Webull，并行拉取后合并。
export async function fetchYahooUSQuotes(symbols: string[]): Promise<QuoteItem[]> {
  if (symbols.length === 0) return [];

  const bareTickers = symbols.map(s => s.startsWith("gb_") ? s.slice(3).toUpperCase() : s.toUpperCase());

  const [yahooResults, overnightResults] = await Promise.all([
    fetchYahooUSQuotesRaw(symbols),
    // 夜盘 / 延长时段：失败不影响主流程
    import("./tradingview").then(m => m.fetchTradingViewOvernight(bareTickers)).catch(() => []),
  ]);

  const overnightMap = new Map(overnightResults.map(o => [o.symbol, o]));
  return yahooResults.map(q => {
    const yahooSymbol = q.symbol.startsWith("gb_") ? q.symbol.slice(3).toUpperCase() : q.symbol.toUpperCase();
    const ot = overnightMap.get(yahooSymbol);
    if (ot?.overnightPrice != null) {
      q.overnightPrice = ot.overnightPrice;
      q.overnightChangePercent = ot.overnightChangePercent;
    }
    return q;
  });
}

async function fetchYahooUSQuotesRaw(symbols: string[]): Promise<QuoteItem[]> {
  const results = await Promise.allSettled(
    symbols.map(async (symbol): Promise<QuoteItem | null> => {
      const yahooSymbol = symbol.startsWith("gb_") ? symbol.slice(3).toUpperCase() : symbol.toUpperCase();
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=1m&range=1d&includePrePost=true`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
      try {
        const res = await fetch(url, {
          headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
          signal: controller.signal,
          cache: "no-store",
        });
        if (!res.ok) return null;
        const json = await res.json() as {
          chart: { result?: {
            meta: {
              symbol: string; shortName?: string; longName?: string;
              regularMarketPrice: number; chartPreviousClose: number; currency?: string;
              currentTradingPeriod?: { pre?: { start: number; end: number }; regular?: { start: number; end: number }; post?: { start: number; end: number } };
            };
            timestamp?: number[];
            indicators: { quote: { close: (number | null)[] }[] };
          }[] };
        };
        const r = json.chart.result?.[0];
        if (!r) return null;
        const m = r.meta;
        if (!m.regularMarketPrice) return null;

        const regularPrice = m.regularMarketPrice;
        const prevClose = m.chartPreviousClose;
        const change = regularPrice - prevClose;
        const changePercent = prevClose > 0 ? (change / prevClose) * 100 : 0;

        // 取最后一根有 close 的分钟线，按 pre/regular/post 时段分类
        const ts = r.timestamp ?? [];
        const closes = r.indicators.quote[0]?.close ?? [];
        const period = m.currentTradingPeriod;
        const preStart = period?.pre?.start;
        const regStart = period?.regular?.start;
        const regEnd = period?.regular?.end;
        const postEnd = period?.post?.end;

        let extendedSession: "pre" | "post" | undefined;
        let extendedPrice: number | undefined;
        let extendedChangePercent: number | undefined;
        let extendedStale: boolean | undefined;

        if (preStart != null && regStart != null && regEnd != null) {
          let lastTs: number | undefined;
          for (let i = ts.length - 1; i >= 0; i--) {
            const c = closes[i];
            if (c == null) continue;
            const t = ts[i]!;
            lastTs = t;
            // 早于今日 pre.start = 昨日盘后 (或更早)；之间 = 今日盘前；regular 之后 = 盘后
            if (t < preStart) extendedSession = "post";
            else if (t < regStart) extendedSession = "pre";
            else if (t < regEnd) extendedSession = undefined; // 盘中，不展示
            else extendedSession = "post";
            extendedPrice = c;
            break;
          }
          if (extendedPrice != null && regularPrice > 0) {
            extendedChangePercent = ((extendedPrice - regularPrice) / regularPrice) * 100;
          }
          // 当前已收市判定：现在处于昨日 post.end 之后、今日 pre.start 之前
          const now = Math.floor(Date.now() / 1000);
          if (lastTs != null && now > lastTs + 30 * 60 && (now < preStart || (postEnd != null && now > postEnd))) {
            extendedStale = true;
          }
        }

        return {
          symbol,
          // 美股统一只显示 ticker 简写，避免 "Advanced Micro Devices, Inc." 这种长名挤占 UI
          name: yahooSymbol,
          price: regularPrice,
          change,
          changePercent,
          previousClose: prevClose,
          currency: m.currency ?? "USD",
          extendedSession,
          extendedPrice,
          extendedChangePercent,
          extendedStale,
        };
      } catch {
        return null;
      } finally {
        clearTimeout(timeout);
      }
    })
  );

  return results
    .filter((r): r is PromiseFulfilledResult<QuoteItem | null> => r.status === "fulfilled" && r.value !== null)
    .map((r) => r.value!);
}


// Yahoo Finance 批量查询（用于海外指数，v8 chart 接口逐个并发）
export async function fetchYahooQuotesV7(yahooSymbols: string[]): Promise<QuoteItem[]> {
  if (yahooSymbols.length === 0) return [];

  const results = await Promise.allSettled(
    yahooSymbols.map(async (symbol): Promise<QuoteItem | null> => {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
      try {
        const res = await fetch(url, {
          headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
          signal: controller.signal,
          cache: "no-store",
        });
        if (!res.ok) return null;
        const json = await res.json() as {
          chart: { result?: { meta: { symbol: string; shortName?: string; regularMarketPrice: number; chartPreviousClose: number; currency?: string } }[] };
        };
        const meta = json.chart.result?.[0]?.meta;
        if (!meta || !meta.regularMarketPrice) return null;
        const change = meta.regularMarketPrice - meta.chartPreviousClose;
        const changePct = meta.chartPreviousClose > 0 ? change / meta.chartPreviousClose * 100 : 0;
        return {
          symbol,
          name: meta.shortName ?? symbol,
          price: meta.regularMarketPrice,
          change,
          changePercent: changePct,
          previousClose: meta.chartPreviousClose,
          currency: meta.currency ?? "USD",
        };
      } finally {
        clearTimeout(timeout);
      }
    })
  );

  return results
    .filter((r): r is PromiseFulfilledResult<QuoteItem | null> => r.status === "fulfilled")
    .map(r => r.value)
    .filter((v): v is QuoteItem => v != null);
}

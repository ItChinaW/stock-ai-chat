export type QuoteItem = {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  previousClose: number;
  currency?: string;
};

const DEFAULT_TIMEOUT_MS = 8000;

// 转换为新浪格式：600001 -> sh600001，000001 -> sz000001
export function toSinaSymbol(symbol: string): string {
  const s = symbol.toLowerCase();
  if (s.startsWith("sh") || s.startsWith("sz")) return s;
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
    }).filter((v): v is QuoteItem => v !== null);
  } finally {
    clearTimeout(timeout);
  }
}

// 东方财富 secid 映射（目前仅保留确认可用的品种）
const EASTMONEY_SYMBOL_MAP: Record<string, { secid: string; currency: string }> = {};

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
    }).filter((v): v is QuoteItem => v !== null);
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
    }).filter((v): v is QuoteItem => v !== null);
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchYahooQuotes(symbols: string[]): Promise<QuoteItem[]> {
  const emSymbols = symbols.filter((s) => s in EASTMONEY_SYMBOL_MAP);
  const hfFxSymbols = symbols.filter((s) => isHfSymbol(s) || isFxSymbol(s));
  const sinaSymbols = symbols.filter((s) => !(s in EASTMONEY_SYMBOL_MAP) && !isHfSymbol(s) && !isFxSymbol(s));

  const [emResults, hfResults, sinaResults] = await Promise.all([
    fetchEastMoneyQuotes(emSymbols),
    fetchSinaHfQuotes(hfFxSymbols),
    fetchSinaQuotes(sinaSymbols),
  ]);

  const resultMap = new Map([...emResults, ...hfResults, ...sinaResults].map((r) => [r.symbol, r]));
  return symbols.map((s) => resultMap.get(s)).filter((v): v is QuoteItem => v !== null);
}

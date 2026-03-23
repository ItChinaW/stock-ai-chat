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

    return lines.map((line, i) => {
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

export async function fetchYahooQuotes(symbols: string[]): Promise<QuoteItem[]> {
  return fetchSinaQuotes(symbols);
}

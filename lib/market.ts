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

// 判断是否为 A 股纯数字代码
function isAStock(symbol: string): boolean {
  return /^\d{6}$/.test(symbol);
}

// 判断是否为新浪格式的 A 股指数（sh000001 等）
function isAIndex(symbol: string): boolean {
  return /^(sh|sz)\d+$/.test(symbol);
}

// 判断是否为新浪格式的纳斯达克指数（.IXIC 等）
function isNasdaqIndex(symbol: string): boolean {
  return symbol.startsWith(".");
}

// 代码转新浪格式
function toSinaCode(symbol: string): string {
  if (isAIndex(symbol)) return symbol; // 已经是 sh/sz 格式
  if (isNasdaqIndex(symbol)) return `gb_${symbol.slice(1).toLowerCase()}`; // .IXIC -> gb_ixic
  if (isAStock(symbol)) {
    const isSH = symbol.startsWith("6") || symbol.startsWith("5") || symbol.startsWith("11");
    return `${isSH ? "sh" : "sz"}${symbol}`;
  }
  // 美股代码
  return `gb_${symbol.toLowerCase()}`;
}

// 解析新浪 A 股/指数行情字符串
// 格式：名称,今开,昨收,现价,最高,最低,...
function parseAStockLine(symbol: string, fields: string[]): QuoteItem | null {
  const name = fields[0] ?? "";
  const price = Number(fields[3]);
  const previousClose = Number(fields[2]);
  if (!name || !Number.isFinite(price) || price === 0) return null;
  const change = price - previousClose;
  const changePercent = previousClose !== 0 ? (change / previousClose) * 100 : 0;
  return { symbol, name, price, change, changePercent, previousClose, currency: "CNY" };
}

// 解析新浪美股/指数行情字符串
// 格式：名称,现价,涨跌幅%,时间,涨跌额,...
function parseUSStockLine(symbol: string, fields: string[]): QuoteItem | null {
  const name = fields[0] ?? "";
  const price = Number(fields[1]);
  const changePercent = Number(fields[2]);
  const change = Number(fields[4]);
  if (!name || !Number.isFinite(price) || price === 0) return null;
  const previousClose = price - change;
  return { symbol, name, price, change, changePercent, previousClose, currency: "USD" };
}

async function fetchSinaQuotes(symbols: string[]): Promise<QuoteItem[]> {
  if (symbols.length === 0) return [];

  const sinaCodes = symbols.map(toSinaCode);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const res = await fetch(
      `https://hq.sinajs.cn/list=${sinaCodes.join(",")}`,
      {
        cache: "no-store",
        signal: controller.signal,
        headers: { Referer: "https://finance.sina.com.cn" },
      },
    );

    const buf = await res.arrayBuffer();
    const text = new TextDecoder("gbk").decode(buf);
    const results: QuoteItem[] = [];

    for (let i = 0; i < symbols.length; i++) {
      const symbol = symbols[i]!;
      const sinaCode = sinaCodes[i]!;
      // 转义正则特殊字符
      const escaped = sinaCode.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
      const regex = new RegExp(`hq_str_${escaped}="([^"]*)"`);
      const m = text.match(regex);
      if (!m || !m[1]) continue;

      const fields = m[1].split(",");
      const isUS = sinaCode.startsWith("gb_");
      const item = isUS
        ? parseUSStockLine(symbol, fields)
        : parseAStockLine(symbol, fields);

      if (item) results.push(item);
    }

    return results;
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchYahooQuotes(symbols: string[]): Promise<QuoteItem[]> {
  return fetchSinaQuotes(symbols);
}

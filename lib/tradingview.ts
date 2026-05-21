/**
 * TradingView Scanner —— 公开 POST 接口，可批量拿延长时段 / 夜盘价。
 *
 * 字段命名 TradingView 没官方文档；以下列了几个候选 column 名，部署后看 logs
 * 里实际返回哪些字段，再精修映射。
 *
 * 注意：TV 的 "extended_hours_price" 通常是 pre/post 04:00-20:00 ET，
 * BLUO 夜盘 (20:00-04:00) 只在部分 ticker 上有数据。
 */

const SCANNER = "https://scanner.tradingview.com/america/scan";
const SYMBOL_SEARCH = "https://symbol-search.tradingview.com/symbol_search/";

const HEADERS = {
  "Content-Type": "application/json",
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "Origin": "https://www.tradingview.com",
  "Referer": "https://www.tradingview.com/",
};

const TIMEOUT_MS = 8000;
const exchangeCache = new Map<string, string>(); // symbol -> "NASDAQ" | "NYSE" | ...

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T | null> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, headers: { ...HEADERS, ...(init?.headers as Record<string, string>) }, signal: controller.signal, cache: "no-store" });
    if (!res.ok) {
      console.warn(`[tv] ${url.split("?")[0]} -> ${res.status}`);
      return null;
    }
    return await res.json() as T;
  } catch (err) {
    console.warn(`[tv] fetch error ${url}: ${err instanceof Error ? err.message : err}`);
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function resolveExchange(symbol: string): Promise<string | null> {
  const key = symbol.toUpperCase();
  const cached = exchangeCache.get(key);
  if (cached) return cached;

  const url = `${SYMBOL_SEARCH}?text=${encodeURIComponent(symbol)}&exchange=&type=stock&hl=1&domain=production`;
  const json = await fetchJson<{ symbol: string; exchange: string; description?: string; type?: string }[]>(url);
  if (!json) return null;
  // 精确匹配 symbol + exchange 是 NASDAQ/NYSE/AMEX
  const allowed = new Set(["NASDAQ", "NYSE", "AMEX", "BATS"]);
  const match = json.find(d => d.symbol?.toUpperCase() === key && allowed.has(d.exchange?.toUpperCase()))
             ?? json.find(d => d.symbol?.toUpperCase() === key);
  if (!match) {
    console.warn(`[tv] no exchange match for ${symbol}`);
    return null;
  }
  exchangeCache.set(key, match.exchange.toUpperCase());
  return match.exchange.toUpperCase();
}

export type TVOvernight = {
  symbol: string;
  overnightPrice?: number;
  overnightChangePercent?: number;
};

/**
 * 批量获取美股延长时段 / 夜盘价。
 */
export async function fetchTradingViewOvernight(symbols: string[]): Promise<TVOvernight[]> {
  if (symbols.length === 0) return [];

  // 1) 解析交易所
  const resolved = await Promise.all(symbols.map(async s => ({ symbol: s.toUpperCase(), exchange: await resolveExchange(s) })));
  const valid = resolved.filter((r): r is { symbol: string; exchange: string } => r.exchange != null);
  if (valid.length === 0) return [];

  // 2) 多个候选 column 一次性请求；TradingView 会忽略它不认识的字段
  const tickers = valid.map(v => `${v.exchange}:${v.symbol}`);
  const columns = [
    "close",
    "extended_hours_price",
    "extended_hours_change",
    "extended_hours_change_percent",
    "premarket_price",
    "premarket_change",
    "premarket_change_percent",
    "postmarket_price",
    "postmarket_change",
    "postmarket_change_percent",
    "overnight_price",
    "overnight_change",
    "overnight_change_percent",
    "last",
    "last_outside_market_hours",
  ];

  const body = JSON.stringify({
    symbols: { tickers },
    columns,
  });

  const json = await fetchJson<{ totalCount: number; data: { s: string; d: (number | null)[] }[] }>(SCANNER, {
    method: "POST",
    body,
  });

  if (!json || !json.data) return [];

  console.log(`[tv] columns: ${columns.join(",")}`);
  if (json.data[0]) {
    console.log(`[tv] sample ${json.data[0].s}: ${JSON.stringify(json.data[0].d)}`);
  }

  const out: TVOvernight[] = [];
  for (const row of json.data) {
    const bareSymbol = row.s.split(":")[1]?.toUpperCase();
    if (!bareSymbol) continue;
    const d = row.d;
    const get = (col: string): number | undefined => {
      const i = columns.indexOf(col);
      const v = i >= 0 ? d[i] : null;
      return typeof v === "number" ? v : undefined;
    };
    const overnightPrice = get("overnight_price") ?? get("postmarket_price") ?? get("extended_hours_price");
    const overnightChange = get("overnight_change_percent") ?? get("postmarket_change_percent") ?? get("extended_hours_change_percent");
    out.push({ symbol: bareSymbol, overnightPrice, overnightChangePercent: overnightChange });
  }
  return out;
}

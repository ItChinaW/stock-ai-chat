/**
 * Webull 美股夜盘报价 —— 抓公开网页 (无需登录)。
 *
 * 思路：
 *   1) /api/search/pc/tickers 拿 tickerId + 交易所 (search 仍是公开的)
 *   2) https://www.webull.com/quote/{nasdaq|nyse|amex}-{symbol} 拉 HTML
 *   3) 在 HTML 里找 __NEXT_DATA__ / window.__INITIAL_STATE__ / inline JSON
 *      解析出夜盘价
 *
 * Webull quote API (getRealTimeV2 等) 现在都要登录态返回 417，故不再使用。
 */

const WEBULL_API_BASES = [
  "https://quotes-gw.webullfintech.com",
  "https://quotes-gw.webullbroadcast.com",
];
const WEBULL_WEB = "https://www.webull.com";

const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7",
  "Accept-Language": "en-US,en;q=0.9",
};

const TIMEOUT_MS = 8000;
const tickerCache = new Map<string, { tickerId: number; exchange: string }>();

async function fetchOnce(url: string, ms = TIMEOUT_MS): Promise<Response | null> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { headers: BROWSER_HEADERS, signal: controller.signal, cache: "no-store" });
  } catch (err) {
    console.warn(`[webull] fetch ${url} error: ${err instanceof Error ? err.message : err}`);
    return null;
  } finally {
    clearTimeout(t);
  }
}

const EX_MAP: Record<string, string> = {
  NSDQ: "nasdaq", NASDAQ: "nasdaq", NMS: "nasdaq",
  NYSE: "nyse", NYS: "nyse",
  AMEX: "amex", ARCA: "nyse",
};

async function searchSymbol(symbol: string): Promise<{ tickerId: number; exchange: string } | null> {
  const key = symbol.toUpperCase();
  const cached = tickerCache.get(key);
  if (cached) return cached;

  for (const base of WEBULL_API_BASES) {
    const res = await fetchOnce(`${base}/api/search/pc/tickers?keyword=${encodeURIComponent(symbol)}&pageIndex=1&pageSize=10&regionId=6`);
    if (!res?.ok) continue;
    try {
      const json = await res.json() as { data?: { tickerId: number; symbol: string; disExchangeCode?: string; regionId?: number }[] };
      const list = json.data ?? [];
      const match = list.find(d => d.symbol?.toUpperCase() === key && d.regionId === 6) ?? list.find(d => d.symbol?.toUpperCase() === key);
      if (match) {
        const exchange = EX_MAP[(match.disExchangeCode ?? "").toUpperCase()] ?? "nasdaq";
        const value = { tickerId: match.tickerId, exchange };
        tickerCache.set(key, value);
        return value;
      }
    } catch { /* try next */ }
  }
  console.warn(`[webull] search ${symbol} no match`);
  return null;
}

export type WebullOvernight = {
  symbol: string;
  overnightPrice?: number;
  overnightChangePercent?: number;
};

// HTML 里把夜盘字段挖出来 —— Webull 用过多种字段名，全部兼容
function extractOvernight(html: string, symbol: string): { price?: number; changePercent?: number } {
  // 1) 优先找 __NEXT_DATA__
  const nextMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (nextMatch?.[1]) {
    try {
      const obj = JSON.parse(nextMatch[1]);
      const found = walk(obj);
      if (found) return found;
    } catch { /* fall through */ }
  }

  // 2) 兜底正则：找 "overnight" 附近的 price/changeRatio
  // 形如 "overnight":{"price":"7.40","changeRatio":"-0.0234",...}
  const reg = /"overnight(?:Trade)?"\s*:\s*\{[^}]*?"(?:price|close)"\s*:\s*"?([0-9.]+)"?[^}]*?"changeRatio"\s*:\s*"?(-?[0-9.]+)"?/;
  const m = html.match(reg);
  if (m) {
    return { price: Number(m[1]), changePercent: Number(m[2]) * 100 };
  }

  // 3) 找 otPrice / overnightPrice 直接字段
  const m2 = html.match(/"(?:overnightPrice|otPrice)"\s*:\s*"?(-?[0-9.]+)"?/);
  if (m2) {
    const price = Number(m2[1]);
    const m3 = html.match(/"(?:overnightChangeRatio|otChangeRatio)"\s*:\s*"?(-?[0-9.]+)"?/);
    return { price, changePercent: m3 ? Number(m3[1]) * 100 : undefined };
  }

  return {};

  // 递归找 JSON 里包含 overnight 信息的对象
  function walk(node: unknown): { price?: number; changePercent?: number } | null {
    if (!node || typeof node !== "object") return null;
    if (Array.isArray(node)) {
      for (const item of node) {
        const r = walk(item);
        if (r) return r;
      }
      return null;
    }
    const obj = node as Record<string, unknown>;

    // 命中：对象自身就有 overnight 字段
    const ot = obj.overnight ?? obj.overnightTrade;
    if (ot && typeof ot === "object") {
      const o = ot as Record<string, unknown>;
      const p = o.price ?? o.close;
      const r = o.changeRatio ?? o.changePercent;
      if (p != null) return { price: Number(p), changePercent: r != null ? Number(r) * 100 : undefined };
    }
    // 命中：扁平字段
    if (obj.overnightPrice != null || obj.otPrice != null) {
      const p = (obj.overnightPrice ?? obj.otPrice) as number | string;
      const r = (obj.overnightChangeRatio ?? obj.otChangeRatio) as number | string | undefined;
      return { price: Number(p), changePercent: r != null ? Number(r) * 100 : undefined };
    }
    // 递归
    for (const v of Object.values(obj)) {
      const r = walk(v);
      if (r) return r;
    }
    return null;
  }
}

export async function fetchWebullOvernight(symbols: string[]): Promise<WebullOvernight[]> {
  if (symbols.length === 0) return [];

  return (await Promise.all(symbols.map(async (sym): Promise<WebullOvernight | null> => {
    const meta = await searchSymbol(sym);
    if (!meta) return null;
    const url = `${WEBULL_WEB}/quote/${meta.exchange}-${sym.toLowerCase()}`;
    const res = await fetchOnce(url);
    if (!res?.ok) {
      console.warn(`[webull] page ${url} -> ${res?.status ?? "no response"}`);
      return null;
    }
    const html = await res.text();

    const parsed = extractOvernight(html, sym);
    if (parsed.price == null) {
      // 没拿到 —— 头一次部署留个 sample 给我对结构
      console.log(`[webull-page] ${sym} no overnight match. head:\n${html.slice(0, 1500)}`);
      return null;
    }
    console.log(`[webull-page] ${sym} overnight=${parsed.price} change=${parsed.changePercent}`);
    return { symbol: sym.toUpperCase(), overnightPrice: parsed.price, overnightChangePercent: parsed.changePercent };
  }))).filter((v): v is WebullOvernight => v != null);
}

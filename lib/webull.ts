/**
 * Webull 非官方行情接口 —— 仅用于获取美股 20:00-04:00 ET 夜盘 (Blue Ocean ATS) 报价。
 *
 * 走两步：
 *   1) /api/search/pc/tickers 解析 symbol → tickerId（在内存里缓存）
 *   2) /api/quotes/ticker/getRealTimeV2 拿到 close / pPrice / overnight* 等字段
 *
 * 字段名是基于公开 webull-sdk 反推；Webull 没有官方文档，字段可能随版本变化。
 * 部署到海外环境（Vercel）应可正常访问；国内出口大多被劫持，本地调试会失败。
 */

const WEBULL_BASES = [
  "https://quotes-gw.webullfintech.com",
  "https://quotes-gw.webullbroadcast.com",
];
const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "Origin": "https://www.webull.com",
  "Referer": "https://www.webull.com/",
  "platform": "web",
  "hl": "en",
  "os": "web",
  "osv": "i9zh",
  "app": "global",
  "appid": "wb_web_app",
  "ver": "3.39.18",
  "lzone": "dc_core_r001",
  "ph": "MacOS Firefox",
  "locale": "eng",
  "device-type": "Web",
  "did": "gldaboazf4y28thligawz4a7xamqu91g",
};
const TIMEOUT_MS = 8000;

// 内存 tickerId 缓存（serverless 冷启动会清空，但每次冷启动只多 1 次 search 调用，可接受）
const tickerIdCache = new Map<string, number>();

async function fetchOnce(url: string, ms = TIMEOUT_MS): Promise<Response | null> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, {
      headers: BROWSER_HEADERS,
      signal: controller.signal,
      cache: "no-store",
    });
  } catch (err) {
    console.warn(`[webull] fetch error: ${err instanceof Error ? err.message : err}`);
    return null;
  } finally {
    clearTimeout(t);
  }
}

// 走两个域名兜底
async function fetchWithFallback(path: string, query: string): Promise<Response | null> {
  for (const base of WEBULL_BASES) {
    const res = await fetchOnce(`${base}${path}?${query}`);
    if (res?.ok) return res;
    if (res) console.warn(`[webull] ${base}${path} -> ${res.status}`);
  }
  return null;
}

async function searchTickerId(symbol: string): Promise<number | null> {
  const key = symbol.toUpperCase();
  const cached = tickerIdCache.get(key);
  if (cached) return cached;

  const res = await fetchWithFallback(
    "/api/search/pc/tickers",
    `keyword=${encodeURIComponent(symbol)}&pageIndex=1&pageSize=10&regionId=6`,
  );
  if (!res) {
    console.warn(`[webull] search ${symbol} no response from any base`);
    return null;
  }

  try {
    const json = await res.json() as { data?: { tickerId: number; symbol: string; disExchangeCode?: string; regionId?: number }[] };
    const list = json.data ?? [];
    // 优先匹配美股交易所（regionId=6 美区）
    const match = list.find(d => d.symbol?.toUpperCase() === key && (d.regionId === 6 || ["NSDQ", "NYSE", "AMEX", "NASDAQ"].includes(d.disExchangeCode ?? "")))
               ?? list.find(d => d.symbol?.toUpperCase() === key);
    if (!match) return null;
    tickerIdCache.set(key, match.tickerId);
    return match.tickerId;
  } catch {
    return null;
  }
}

export type WebullOvernight = {
  symbol: string;
  overnightPrice?: number;
  overnightChangePercent?: number;
  overnightTradeTime?: string;
};

/**
 * 批量获取美股夜盘报价。symbols 是裸 ticker（不带 gb_）。
 */
export async function fetchWebullOvernight(symbols: string[]): Promise<WebullOvernight[]> {
  if (symbols.length === 0) return [];

  // 1) 并发解析 tickerId
  const resolved = await Promise.all(
    symbols.map(async (s) => ({ symbol: s.toUpperCase(), id: await searchTickerId(s) }))
  );
  const valid = resolved.filter((r): r is { symbol: string; id: number } => r.id != null);
  if (valid.length === 0) return [];

  // 2) 批量拉取实时报价
  const ids = valid.map(v => v.id).join(",");
  const res = await fetchWithFallback(
    "/api/quotes/ticker/getRealTimeV2",
    `tickerIds=${ids}&includeSecu=1&includeQuote=1&more=1`,
  );
  if (!res) return [];

  try {
    // 响应通常是数组；某些版本包了一层 { data: [...] }
    const raw = await res.json() as unknown;
    // 调试用：打印第一条原始数据，方便对齐字段名
    if (process.env.WEBULL_DEBUG === "1" || process.env.NODE_ENV !== "production") {
      const sample = Array.isArray(raw) ? raw[0] : (raw as { data?: unknown[] }).data?.[0];
      console.log("[webull] raw[0]:", JSON.stringify(sample).slice(0, 1500));
    }
    const list = Array.isArray(raw) ? raw : (raw as { data?: unknown[] }).data ?? [];

    const idToSymbol = new Map(valid.map(v => [v.id, v.symbol]));

    return (list as Record<string, unknown>[]).map((q): WebullOvernight | null => {
      const tickerId = Number(q.tickerId);
      const symbol = idToSymbol.get(tickerId) ?? (q.symbol as string | undefined)?.toUpperCase();
      if (!symbol) return null;

      // 兼容几种可能的字段名 —— Webull 在不同接口/版本中给夜盘的字段命名不一致
      const overnightObj = (q.overnight ?? q.overnightTrade) as Record<string, unknown> | undefined;
      const priceRaw = overnightObj?.price ?? q.overnightPrice ?? q.otPrice;
      const ratioRaw = overnightObj?.changeRatio ?? q.overnightChangeRatio ?? q.otChangeRatio;
      const timeRaw = overnightObj?.tradeTime ?? overnightObj?.mktradeTime ?? q.overnightTradeTime;

      const price = priceRaw != null ? Number(priceRaw) : NaN;
      const ratio = ratioRaw != null ? Number(ratioRaw) : NaN;
      if (!Number.isFinite(price)) return { symbol };

      return {
        symbol,
        overnightPrice: price,
        // Webull 的 changeRatio 通常是小数（0.0123 = +1.23%），换成百分比
        overnightChangePercent: Number.isFinite(ratio) ? ratio * 100 : undefined,
        overnightTradeTime: typeof timeRaw === "string" ? timeRaw : undefined,
      };
    }).filter((v): v is WebullOvernight => v != null);
  } catch {
    return [];
  }
}

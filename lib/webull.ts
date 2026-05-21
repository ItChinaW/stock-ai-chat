/**
 * Webull 美股夜盘报价 —— 先抓 webull.com 网页里的 <meta name="token">,
 * 再带着这个 token 调 getRealTimeV2。
 *
 * 之前直接调 quote API 全部 417，疑因缺少 SPA 通过 meta token 注入的鉴权 header。
 */

const WEBULL_API_BASES = [
  "https://quotes-gw.webullfintech.com",
  "https://quotes-gw.webullbroadcast.com",
];
const WEBULL_WEB = "https://www.webull.com";

const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "Origin": "https://www.webull.com",
  "Referer": "https://www.webull.com/",
};

const TIMEOUT_MS = 8000;
const tickerCache = new Map<string, { tickerId: number; exchange: string }>();

async function fetchWithHeaders(url: string, headers: Record<string, string> = {}, ms = TIMEOUT_MS): Promise<Response | null> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { headers: { ...BROWSER_HEADERS, ...headers }, signal: controller.signal, cache: "no-store" });
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
    const res = await fetchWithHeaders(`${base}/api/search/pc/tickers?keyword=${encodeURIComponent(symbol)}&pageIndex=1&pageSize=10&regionId=6`);
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
  return null;
}

// 从一个 quote 页面拿 <meta name="token"> 的内容
let cachedToken: { value: string; expires: number } | null = null;
async function getWebullToken(): Promise<string | null> {
  if (cachedToken && Date.now() < cachedToken.expires) return cachedToken.value;

  // 任何一个 quote 页面都行，用 AAPL 当探针
  const res = await fetchWithHeaders(`${WEBULL_WEB}/quote/nasdaq-aapl`, {
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.7",
  });
  if (!res?.ok) {
    console.warn(`[webull] fetch token page -> ${res?.status ?? "no response"}`);
    return null;
  }
  const html = await res.text();
  const m = html.match(/<meta\s+name="token"\s+content="([^"]+)"/);
  if (!m) {
    console.warn("[webull] no <meta name='token'> in HTML");
    return null;
  }
  cachedToken = { value: m[1]!, expires: Date.now() + 5 * 60_000 }; // 5min 缓存
  console.log(`[webull] got token (${cachedToken.value.length} chars)`);
  return cachedToken.value;
}

export type WebullOvernight = {
  symbol: string;
  overnightPrice?: number;
  overnightChangePercent?: number;
};

export async function fetchWebullOvernight(symbols: string[]): Promise<WebullOvernight[]> {
  if (symbols.length === 0) return [];

  const token = await getWebullToken();
  if (!token) return [];

  // 解析 tickerId
  const resolved = await Promise.all(symbols.map(async s => ({ symbol: s.toUpperCase(), meta: await searchSymbol(s) })));
  const valid = resolved.filter((r): r is { symbol: string; meta: { tickerId: number; exchange: string } } => r.meta != null);
  if (valid.length === 0) return [];

  const ids = valid.map(v => v.meta.tickerId).join(",");
  const headers: Record<string, string> = {
    "t_token": token,
    "access_token": token,
    "App-Token": token,
    "platform": "web",
    "hl": "en",
    "os": "web",
    "app": "global",
    "appid": "wb_web_app",
    "device-type": "Web",
    "did": "gldaboazf4y28thligawz4a7xamqu91g",
  };

  // 试若干 endpoint
  const candidates = [
    `/api/quotes/ticker/getRealTimeV2?tickerIds=${ids}&includeSecu=1&includeQuote=1&more=1`,
    `/api/quotes/ticker/getRealTimePcv2?tickerIds=${ids}`,
    `/api/quote/v4/charts/realtime?tickerIds=${ids}`,
  ];

  for (const base of WEBULL_API_BASES) {
    for (const path of candidates) {
      const res = await fetchWithHeaders(`${base}${path}`, headers);
      if (!res) continue;
      if (!res.ok) {
        console.warn(`[webull] ${base}${path.split("?")[0]} -> ${res.status}`);
        continue;
      }

      console.log(`[webull] using ${base}${path.split("?")[0]}`);
      const raw = await res.json() as unknown;
      const list = Array.isArray(raw) ? raw : (raw as { data?: unknown[] }).data ?? [];

      // 打印第一条样本
      console.log(`[webull] raw[0] keys: ${Object.keys((list[0] ?? {}) as object).join(",")}`);
      console.log(`[webull] raw[0]: ${JSON.stringify(list[0]).slice(0, 1200)}`);

      const idToSymbol = new Map(valid.map(v => [v.meta.tickerId, v.symbol]));
      return (list as Record<string, unknown>[]).map((q): WebullOvernight | null => {
        const tickerId = Number(q.tickerId ?? (q as { ticker?: { tickerId?: number } }).ticker?.tickerId);
        const symbol = idToSymbol.get(tickerId) ?? (q.symbol as string | undefined)?.toUpperCase();
        if (!symbol) return null;

        const otObj = (q.overnight ?? q.overnightTrade ?? q.overnightInfo) as Record<string, unknown> | undefined;
        const priceRaw = otObj?.price ?? otObj?.close ?? q.overnightPrice ?? q.otPrice;
        const ratioRaw = otObj?.changeRatio ?? otObj?.changePercent ?? q.overnightChangeRatio ?? q.otChangeRatio;
        const price = priceRaw != null ? Number(priceRaw) : NaN;
        if (!Number.isFinite(price)) return { symbol };
        const ratio = ratioRaw != null ? Number(ratioRaw) : NaN;
        return {
          symbol,
          overnightPrice: price,
          overnightChangePercent: Number.isFinite(ratio) ? ratio * 100 : undefined,
        };
      }).filter((v): v is WebullOvernight => v != null);
    }
  }

  console.warn("[webull] all quote endpoints failed");
  return [];
}

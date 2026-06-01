/**
 * Yahoo Finance 页面抓取（美股盘前 / 盘中 / 盘后 / 夜盘 Overnight）
 * =================================================================
 *
 * Yahoo 的 v8 chart API 只有 pre/post，没有 20:00-04:00 ET 的夜盘(Overnight，
 * 即 Blue Ocean ATS / BOATS)。但 Yahoo 个股网页的报价头部会显示 Overnight 价，
 * 所以这里用常驻无头浏览器打开页面、解析报价头部文本，把真夜盘也抓出来。
 *
 *   subscribeYahoo(symbols)  : 登记订阅（惰性启动后台轮询器）
 *   getYahooScrapeQuotes(..) : 从内存缓存瞬时读取，给 /api/market/quotes 用
 *
 * 浏览器、缓存、订阅集挂在 globalThis 上保证单例。无 playwright 时安全降级。
 */

import type { Browser, BrowserContext } from "playwright";

export type ScrapeQuote = {
  symbol: string; // 纯 ticker，大写
  name: string;
  price: number;
  change: number;
  changePercent: number;
  previousClose: number;
  extendedSession?: "pre" | "post" | "overnight";
  extendedPrice?: number;
  extendedChangePercent?: number;
  extendedStale?: boolean;
  updatedAt: number;
};

const POLL_INTERVAL_MS = 30_000;
const CONCURRENCY = 3;
const BATCH_GAP_MS = 800;
const SETTLE_MS = 3_500;
const STALE_MS = 5 * 60_000;
const MAX_BACKOFF_MS = 10 * 60_000;

const RATE_LIMITED_RE = /Too Many Requests|Will be right back|temporarily unavailable/i;

const g = globalThis as unknown as {
  yScrapeBrowser?: Browser;
  yScrapeCtx?: BrowserContext;
  yScrapeCache?: Map<string, ScrapeQuote>;
  yScrapeSubs?: Set<string>;
  yScrapePollerStarted?: boolean;
  yScrapeTimer?: ReturnType<typeof setTimeout>;
  yScrapeUnavailable?: boolean;
  yScrapeBackoffMs?: number;
};

g.yScrapeCache ??= new Map();
g.yScrapeSubs ??= new Set();

function normalizeTicker(symbol: string): string {
  let s = symbol.trim();
  if (s.toLowerCase().startsWith("gb_")) s = s.slice(3);
  s = s.replace(/-US$/i, "");
  return s.toUpperCase();
}

export function subscribeYahoo(symbols: string[]): void {
  if (g.yScrapeUnavailable) return;
  for (const s of symbols) g.yScrapeSubs!.add(normalizeTicker(s));
  startYahooPoller();
}

export function getYahooScrapeQuotes(symbols: string[]): Map<string, ScrapeQuote> {
  const out = new Map<string, ScrapeQuote>();
  const now = Date.now();
  for (const s of symbols) {
    const t = normalizeTicker(s);
    const q = g.yScrapeCache!.get(t);
    if (q && now - q.updatedAt < STALE_MS) out.set(t, q);
  }
  return out;
}

// ── 解析 Yahoo 报价头部文本 ───────────────────────────────────────────────
// 文本形如：
//   NVIDIA Corporation (NVDA)
//   211.14
//   -3.11
//   (-1.45%)
//   At close: May 29 at 4:00:01 PM EDT
//   214.60
//   +3.46
//   (+1.64%)
//   Overnight: 10:18:26 PM EDT
const NUM_RE = /^-?[\d,]+\.\d+$/;
const PCT_RE = /^\(([+-][\d.]+)%\)$/;
const SESS_RE = /(At close|Overnight|Pre-Market|Pre-market|After hours|After-hours|As of|Market open|Live|Closed)/i;
const num = (s: string) => parseFloat(s.replace(/,/g, ""));

type Block = { price: number; pct: number; label: string };

export function parseYahooHeader(ticker: string, text: string): ScrapeQuote | null {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const nameLine = lines.find((l) => l.includes(`(${ticker})`));
  const name = nameLine ? nameLine.replace(/\s*\([^)]*\)\s*$/, "").trim() || ticker : ticker;

  const blocks: Block[] = [];
  let price: number | null = null;
  let pct: number | null = null;
  for (const l of lines) {
    if (NUM_RE.test(l)) {
      if (price === null) price = num(l); // 第一个数字=价格，后续涨跌额跳过
      continue;
    }
    const mp = l.match(PCT_RE);
    if (mp && price !== null) {
      pct = num(mp[1]!);
      continue;
    }
    if (SESS_RE.test(l) && price !== null) {
      blocks.push({ price, pct: pct ?? 0, label: l });
      price = null;
      pct = null;
    }
  }
  if (!blocks.length) return null;

  const regular =
    blocks.find((b) => /At close|As of|Market open|Live|Closed/i.test(b.label)) ?? blocks[0]!;
  const overnight = blocks.find((b) => /Overnight/i.test(b.label));
  const pre = blocks.find((b) => /Pre-Market|Pre-market/i.test(b.label));
  const post = blocks.find((b) => /After hours|After-hours/i.test(b.label));
  const ext = overnight ?? post ?? pre;

  const previousClose =
    regular.pct !== 0 ? regular.price / (1 + regular.pct / 100) : regular.price;

  const q: ScrapeQuote = {
    symbol: ticker,
    name,
    price: regular.price,
    change: regular.price - previousClose,
    changePercent: regular.pct,
    previousClose,
    updatedAt: Date.now(),
  };

  if (ext && ext.price !== regular.price) {
    q.extendedSession = overnight
      ? "overnight"
      : pre && ext === pre
      ? "pre"
      : "post";
    q.extendedPrice = ext.price;
    q.extendedChangePercent = ext.pct;
    // 页面给的就是当前会话的实时值；不另算 stale（Yahoo 会自己切换标签）
    q.extendedStale = false;
  }

  return q;
}

// ── 浏览器单例 ────────────────────────────────────────────────────────────
async function getContext(): Promise<BrowserContext | null> {
  if (g.yScrapeUnavailable) return null;
  if (g.yScrapeCtx) return g.yScrapeCtx;
  try {
    const { chromium } = await import("playwright");
    g.yScrapeBrowser = await chromium.launch({ headless: true });
    g.yScrapeCtx = await g.yScrapeBrowser.newContext({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      locale: "en-US",
      timezoneId: "America/New_York",
    });
    return g.yScrapeCtx;
  } catch (err) {
    g.yScrapeUnavailable = true;
    console.warn(
      "[yahoo-scrape] playwright 不可用，页面抓取已禁用，回退 Yahoo API:",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

async function scrapeOne(ticker: string): Promise<boolean> {
  const ctx = await getContext();
  if (!ctx) return false;
  const page = await ctx.newPage();
  try {
    await page.goto(`https://finance.yahoo.com/quote/${ticker}/`, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    await page.waitForTimeout(SETTLE_MS);

    const text: string = await page.evaluate(() => {
      const region =
        document.querySelector(
          '[data-testid="quote-hdr"], [data-testid="quote-price"]'
        ) || document.body;
      return (region as HTMLElement).innerText.slice(0, 600);
    });

    if (RATE_LIMITED_RE.test(text)) {
      console.warn(`[yahoo-scrape] ${ticker} 被限流，保留旧缓存`);
      return true;
    }

    const q = parseYahooHeader(ticker, text);
    if (q) g.yScrapeCache!.set(ticker, q);
    return false;
  } catch (err) {
    console.warn(
      `[yahoo-scrape] 抓取 ${ticker} 失败:`,
      err instanceof Error ? err.message : err
    );
    return false;
  } finally {
    await page.close().catch(() => {});
  }
}

async function pollOnce(): Promise<boolean> {
  const tickers = [...g.yScrapeSubs!];
  if (!tickers.length) return false;
  let rateLimited = false;
  for (let i = 0; i < tickers.length; i += CONCURRENCY) {
    const batch = tickers.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(batch.map(scrapeOne));
    if (results.some((r) => r.status === "fulfilled" && r.value)) rateLimited = true;
    if (i + CONCURRENCY < tickers.length) {
      await new Promise((r) => setTimeout(r, BATCH_GAP_MS));
    }
  }
  return rateLimited;
}

async function pollLoop(): Promise<void> {
  let nextDelay = POLL_INTERVAL_MS;
  try {
    const rateLimited = await pollOnce();
    if (rateLimited) {
      g.yScrapeBackoffMs = Math.min(
        (g.yScrapeBackoffMs ?? POLL_INTERVAL_MS) * 2,
        MAX_BACKOFF_MS
      );
      nextDelay = g.yScrapeBackoffMs;
      console.warn(`[yahoo-scrape] 遭遇限流，退避到 ${Math.round(nextDelay / 1000)}s`);
    } else {
      g.yScrapeBackoffMs = POLL_INTERVAL_MS;
    }
  } catch (err) {
    console.warn("[yahoo-scrape] 轮询异常:", err instanceof Error ? err.message : err);
  }
  g.yScrapeTimer = setTimeout(() => void pollLoop(), nextDelay);
}

export function startYahooPoller(): void {
  if (g.yScrapePollerStarted || g.yScrapeUnavailable) return;
  g.yScrapePollerStarted = true;
  g.yScrapeBackoffMs = POLL_INTERVAL_MS;
  console.log(
    `[yahoo-scrape] 页面抓取轮询启动，间隔 ${POLL_INTERVAL_MS / 1000}s，并发 ${CONCURRENCY}`
  );
  void pollLoop();
}

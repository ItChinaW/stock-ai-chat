import crypto from "crypto";

const BASE = "https://api.binance.com";
const API_KEY = process.env.BIAN_API_KEY ?? "";
const SECRET = process.env.BIAN_API_SECRET ?? "";

function sign(params: Record<string, string | number>): string {
  const qs = new URLSearchParams(
    Object.entries(params).map(([k, v]) => [k, String(v)])
  ).toString();
  return crypto.createHmac("sha256", SECRET).update(qs).digest("hex");
}

async function publicGet(path: string, params: Record<string, string | number> = {}) {
  const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString();
  const res = await fetch(`${BASE}${path}${qs ? "?" + qs : ""}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Binance ${path} ${res.status}: ${await res.text()}`);
  return res.json();
}

async function privateGet(path: string, params: Record<string, string | number> = {}) {
  const ts = Date.now();
  const p = { ...params, timestamp: ts };
  const signature = sign(p);
  const qs = new URLSearchParams(Object.entries({ ...p, signature }).map(([k, v]) => [k, String(v)])).toString();
  const res = await fetch(`${BASE}${path}?${qs}`, {
    headers: { "X-MBX-APIKEY": API_KEY },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Binance ${path} ${res.status}: ${await res.text()}`);
  return res.json();
}

async function privatePost(path: string, params: Record<string, string | number> = {}) {
  const ts = Date.now();
  const p = { ...params, timestamp: ts };
  const signature = sign(p);
  const body = new URLSearchParams(Object.entries({ ...p, signature }).map(([k, v]) => [k, String(v)])).toString();
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "X-MBX-APIKEY": API_KEY, "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Binance ${path} ${res.status}: ${await res.text()}`);
  return res.json();
}

// ── 公开接口 ──────────────────────────────────────────────

export type Kline = { time: string; open: number; high: number; low: number; close: number; volume: number };

export async function getKlines(symbol: string, interval: string, limit = 200): Promise<Kline[]> {
  const data = await publicGet("/api/v3/klines", { symbol, interval, limit }) as unknown[][];
  return data.map((k) => ({
    time: new Date(k[0] as number).toISOString().slice(0, 10),
    open: parseFloat(k[1] as string),
    high: parseFloat(k[2] as string),
    low: parseFloat(k[3] as string),
    close: parseFloat(k[4] as string),
    volume: parseFloat(k[5] as string),
  }));
}

// 按时间范围分批拉取 K 线（自动处理 1000 根/次的限制）
export async function getKlinesByRange(symbol: string, interval: string, startDate: string, endDate: string): Promise<Kline[]> {
  const intervalMs: Record<string, number> = {
    "1m": 60_000, "3m": 180_000, "5m": 300_000, "15m": 900_000, "30m": 1_800_000,
    "1h": 3_600_000, "2h": 7_200_000, "4h": 14_400_000, "6h": 21_600_000, "8h": 28_800_000, "12h": 43_200_000,
    "1d": 86_400_000, "3d": 259_200_000, "1w": 604_800_000,
  };
  const ms = intervalMs[interval] ?? 86_400_000;
  const startMs = new Date(startDate).getTime();
  const endMs = new Date(endDate).getTime() + 86_400_000; // 包含结束当天
  const totalBars = Math.ceil((endMs - startMs) / ms);

  // 数据量在 1000 根以内直接拉
  if (totalBars <= 1000) {
    const data = await publicGet("/api/v3/klines", { symbol, interval, startTime: startMs, endTime: endMs, limit: 1000 }) as unknown[][];
    return data.map(k => ({
      time: new Date(k[0] as number).toISOString().slice(0, 10),
      open: parseFloat(k[1] as string), high: parseFloat(k[2] as string),
      low: parseFloat(k[3] as string), close: parseFloat(k[4] as string),
      volume: parseFloat(k[5] as string),
    }));
  }

  // 分批拉取，每批 1000 根
  const all: Kline[] = [];
  let cursor = startMs;
  while (cursor < endMs) {
    const data = await publicGet("/api/v3/klines", { symbol, interval, startTime: cursor, endTime: endMs, limit: 1000 }) as unknown[][];
    if (!data.length) break;
    const batch = data.map(k => ({
      time: new Date(k[0] as number).toISOString().slice(0, 10),
      open: parseFloat(k[1] as string), high: parseFloat(k[2] as string),
      low: parseFloat(k[3] as string), close: parseFloat(k[4] as string),
      volume: parseFloat(k[5] as string),
    }));
    all.push(...batch);
    cursor = (data[data.length - 1] as unknown[])[0] as number + ms;
    if (data.length < 1000) break;
  }
  return all;
}

export async function getTicker(symbol: string): Promise<{ price: number; change: number; changePct: number }> {
  const data = await publicGet("/api/v3/ticker/24hr", { symbol }) as { lastPrice: string; priceChange: string; priceChangePercent: string };
  return {
    price: parseFloat(data.lastPrice),
    change: parseFloat(data.priceChange),
    changePct: parseFloat(data.priceChangePercent),
  };
}

export async function getMultiTicker(symbols: string[]): Promise<Record<string, { price: number; change: number; changePct: number }>> {
  const data = await publicGet("/api/v3/ticker/24hr") as { symbol: string; lastPrice: string; priceChange: string; priceChangePercent: string }[];
  const set = new Set(symbols);
  const result: Record<string, { price: number; change: number; changePct: number }> = {};
  for (const d of data) {
    if (set.has(d.symbol)) {
      result[d.symbol] = {
        price: parseFloat(d.lastPrice),
        change: parseFloat(d.priceChange),
        changePct: parseFloat(d.priceChangePercent),
      };
    }
  }
  return result;
}

// ── 私有接口 ──────────────────────────────────────────────

export type Balance = { asset: string; free: number; locked: number };

export async function getAccount(): Promise<{ balances: Balance[] }> {
  const data = await privateGet("/api/v3/account") as { balances: { asset: string; free: string; locked: string }[] };
  return {
    balances: data.balances
      .map((b) => ({ asset: b.asset, free: parseFloat(b.free), locked: parseFloat(b.locked) }))
      .filter((b) => b.free + b.locked > 0),
  };
}

// 市价买入（按 USDT 金额）
export async function marketBuy(symbol: string, quoteOrderQty: number) {
  return privatePost("/api/v3/order", {
    symbol,
    side: "BUY",
    type: "MARKET",
    quoteOrderQty: quoteOrderQty.toFixed(2),
  });
}

// 市价卖出（按持仓数量）
export async function marketSell(symbol: string, quantity: number) {
  // 获取精度
  const info = await publicGet("/api/v3/exchangeInfo", { symbol }) as {
    symbols: { symbol: string; filters: { filterType: string; stepSize: string }[] }[]
  };
  const lotFilter = info.symbols[0]?.filters.find(f => f.filterType === "LOT_SIZE");
  const step = parseFloat(lotFilter?.stepSize ?? "0.00001");
  const precision = step < 1 ? Math.round(-Math.log10(step)) : 0;
  const qty = parseFloat(quantity.toFixed(precision));

  return privatePost("/api/v3/order", {
    symbol,
    side: "SELL",
    type: "MARKET",
    quantity: qty,
  });
}

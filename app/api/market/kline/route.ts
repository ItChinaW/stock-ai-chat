import { NextRequest, NextResponse } from "next/server";

function toSinaCode(symbol: string): string {
  if (/^(sh|sz)\d+$/.test(symbol)) return symbol;
  if (/^\d{6}$/.test(symbol)) {
    const isSH = symbol.startsWith("6") || symbol.startsWith("5") || symbol.startsWith("11");
    return `${isSH ? "sh" : "sz"}${symbol}`;
  }
  return `gb_${symbol.toLowerCase()}`;
}

// period -> sina scale + datalen
const PERIOD_MAP: Record<string, { scale: number; datalen: number }> = {
  realtime: { scale: 5,   datalen: 48  }, // 5分钟，近2日
  day:      { scale: 240, datalen: 90  }, // 日线，近90日
  week:     { scale: 240, datalen: 365 }, // 用日线数据，前端聚合成周
  month:    { scale: 240, datalen: 730 }, // 用日线数据，前端聚合成月
};

export async function GET(request: NextRequest) {
  const symbol  = request.nextUrl.searchParams.get("symbol") ?? "";
  const period  = request.nextUrl.searchParams.get("period") ?? "day";
  if (!symbol) return NextResponse.json({ error: "symbol required" }, { status: 400 });

  const cfg = PERIOD_MAP[period] ?? PERIOD_MAP.day!;
  const sinaCode = toSinaCode(symbol);
  const url = `https://quotes.sina.cn/cn/api/jsonp_v2.php/var%20_kline=/CN_MarketDataService.getKLineData?symbol=${sinaCode}&scale=${cfg.scale}&datalen=${cfg.datalen}`;

  try {
    const res = await fetch(url, {
      headers: { Referer: "https://finance.sina.com.cn" },
      next: { revalidate: period === "realtime" ? 60 : 300 },
    });
    const text = await res.text();
    const m = text.match(/\(\[(.*)\]\)/s);
    if (!m) return NextResponse.json([]);

    const raw = JSON.parse(`[${m[1]}]`) as {
      day: string; open: string; high: string; low: string; close: string; volume: string;
    }[];

    const candles = raw.map((d) => ({
      time:   d.day,
      open:   Number(d.open),
      high:   Number(d.high),
      low:    Number(d.low),
      close:  Number(d.close),
      volume: Number(d.volume),
    }));

    return NextResponse.json(candles);
  } catch {
    return NextResponse.json([]);
  }
}

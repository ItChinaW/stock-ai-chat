import { isOverseasSymbol, toSinaSymbol, fetchYahooKlineRecent } from "@/lib/market";
import { NextRequest, NextResponse } from "next/server";

// 新浪 K 线接口
// period: day/week/month/realtime
const PERIOD_MAP: Record<string, { scale: number; datalen: number }> = {
  realtime: { scale: 5,    datalen: 48  },
  day:      { scale: 240,  datalen: 90  },
  week:     { scale: 1680, datalen: 52  },
  month:    { scale: 7200, datalen: 24  },
};

export async function GET(request: NextRequest) {
  const symbol = request.nextUrl.searchParams.get("symbol") ?? "";
  const period = request.nextUrl.searchParams.get("period") ?? "day";
  if (!symbol) return NextResponse.json({ error: "symbol required" }, { status: 400 });

  // 海外股票走 Yahoo Finance
  if (isOverseasSymbol(symbol) && period === "day") {
    try {
      const candles = await fetchYahooKlineRecent(symbol, 90);
      return NextResponse.json(candles);
    } catch {
      return NextResponse.json([]);
    }
  }

  const cfg = PERIOD_MAP[period] ?? PERIOD_MAP.day!;
  const sinaSymbol = toSinaSymbol(symbol);

  const url = `https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=${sinaSymbol}&scale=${cfg.scale}&ma=no&datalen=${cfg.datalen}`;

  try {
    const res = await fetch(url, {
      headers: { Referer: "https://finance.sina.com.cn" },
      next: { revalidate: period === "realtime" ? 60 : 300 },
    });
    const json = await res.json() as { day: string; open: string; high: string; low: string; close: string; volume: string }[];

    const candles = (Array.isArray(json) ? json : []).map((item) => ({
      time:   item.day,
      open:   Number(item.open),
      high:   Number(item.high),
      low:    Number(item.low),
      close:  Number(item.close),
      volume: Number(item.volume),
    }));

    return NextResponse.json(candles);
  } catch {
    return NextResponse.json([]);
  }
}

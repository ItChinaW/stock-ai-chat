import { fetchYahooQuotes, fetchYahooQuotesV7 } from "@/lib/market";
import { NextResponse } from "next/server";

// A股指数用新浪，海外用 Yahoo Finance
const SINA_INDICES = [
  { key: "sse",    label: "上证",   symbol: "sh000001" },
  { key: "hs300",  label: "沪深300", symbol: "sh000300" },
  { key: "bj50",   label: "北证50",  symbol: "bj899050" },
  { key: "kc50",   label: "科创50",  symbol: "sh000688" },
  { key: "cyb",    label: "创业板",  symbol: "sz399006" },
  { key: "szse",   label: "深证",    symbol: "sz399001" },
];

const YAHOO_INDICES = [
  { key: "ndx",  label: "纳指",     symbol: "^NDX"   },
  { key: "n225", label: "日经225",  symbol: "^N225"  },
  { key: "ks11", label: "韩国综合", symbol: "^KS11"  },
  { key: "twii", label: "台湾加权", symbol: "^TWII"  },
  { key: "hsi",  label: "恒生指数", symbol: "^HSI"   },
  { key: "ftse", label: "英国富时", symbol: "^FTSE"  },
];

export async function GET() {
  try {
    const [sinaResults, yahooResults] = await Promise.all([
      fetchYahooQuotes(SINA_INDICES.map(i => i.symbol)),
      fetchYahooQuotesV7(YAHOO_INDICES.map(i => i.symbol)),
    ]);

    const sinaMap = new Map(sinaResults.map(q => [q.symbol, q]));
    const yahooMap = new Map(yahooResults.map(q => [q.symbol, q]));

    const indices = [
      ...SINA_INDICES.map(idx => {
        const q = sinaMap.get(idx.symbol);
        return { ...idx, price: q?.price ?? 0, change: q?.change ?? 0, changePercent: q?.changePercent ?? 0, currency: "CNY" };
      }),
      ...YAHOO_INDICES.map(idx => {
        const q = yahooMap.get(idx.symbol);
        return { ...idx, price: q?.price ?? 0, change: q?.change ?? 0, changePercent: q?.changePercent ?? 0, currency: q?.currency ?? "USD" };
      }),
    ];

    return NextResponse.json({ updatedAt: new Date().toISOString(), indices });
  } catch (error) {
    console.error("[indices] error:", error);
    return NextResponse.json({ message: "Failed to fetch indices", error: String(error) }, { status: 500 });
  }
}

import { getMultiTicker } from "@/lib/binance";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const symbols = (req.nextUrl.searchParams.get("symbols") ?? "BTCUSDT,ETHUSDT,BNBUSDT,SOLUSDT,XRPUSDT")
    .split(",").map(s => s.trim()).filter(Boolean);
  try {
    const data = await getMultiTicker(symbols);
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "failed" }, { status: 500 });
  }
}

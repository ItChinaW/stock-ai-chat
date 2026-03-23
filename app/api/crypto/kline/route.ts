import { getKlines } from "@/lib/binance";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get("symbol") ?? "BTCUSDT";
  const interval = req.nextUrl.searchParams.get("interval") ?? "1d";
  const limit = parseInt(req.nextUrl.searchParams.get("limit") ?? "200");
  try {
    const data = await getKlines(symbol, interval, limit);
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "failed" }, { status: 500 });
  }
}

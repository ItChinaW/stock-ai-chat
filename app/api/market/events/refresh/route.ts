import { NextResponse } from "next/server";
import { getUpcomingEvents, ingestEvents } from "@/lib/market-events";

// 强制刷新未来大事时间线（手动按钮 / 定时任务调用）。
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const origin = new URL(req.url).origin;
    const count = await ingestEvents(origin);
    return NextResponse.json({ ok: true, ingested: count, data: await getUpcomingEvents() });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "failed" }, { status: 500 });
  }
}

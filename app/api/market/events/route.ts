import { NextResponse } from "next/server";
import { getUpcomingEvents, ingestEvents, isIngestStale } from "@/lib/market-events";

// 未来一周大事时间线：从数据库读取（market_events）。
// 数据陈旧时后台触发一次采集（财经日历 + 多源新闻 AI 归纳 + 人工精选），
// 当前请求直接返回库里现有数据，不阻塞。

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  try {
    const origin = new URL(req.url).origin;
    const data = await getUpcomingEvents();

    // 库空 → 同步采集一次再返回；否则陈旧时后台刷新
    if (data.length === 0) {
      await ingestEvents(origin);
      return NextResponse.json(await getUpcomingEvents());
    }
    if (isIngestStale()) void ingestEvents(origin);

    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "failed" }, { status: 500 });
  }
}

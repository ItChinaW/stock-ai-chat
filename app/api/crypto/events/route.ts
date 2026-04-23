import { botEventBus } from "@/lib/bot-events";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      // 发送初始连接确认
      controller.enqueue(encoder.encode("data: {\"type\":\"connected\"}\n\n"));

      // 订阅事件总线
      const unsub = botEventBus.subscribe((event) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          unsub();
        }
      });

      // 每 25 秒发一次心跳，防止连接超时
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          clearInterval(heartbeat);
          unsub();
        }
      }, 25_000);

      // 客户端断开时清理
      return () => {
        clearInterval(heartbeat);
        unsub();
      };
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no", // 禁用 nginx 缓冲
    },
  });
}

import { getSchedulerStatus, forceRestartScheduler } from "@/lib/scheduler";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

const INTERVAL_LABEL: Record<string, string> = {
  "1m": "1分钟", "5m": "5分钟", "15m": "15分钟",
  "1h": "1小时", "4h": "4小时", "1d": "日线",
};
const INTERVAL_MS: Record<string, number> = {
  "1m": 60_000, "5m": 300_000, "15m": 900_000,
  "1h": 3_600_000, "4h": 14_400_000, "1d": 86_400_000,
};

export async function GET() {
  const status = getSchedulerStatus();

  if (!status.started || status.lastRun === 0) {
    forceRestartScheduler();
    return NextResponse.json({ started: true, restarted: true, bots: [] });
  }

  const now = Date.now();
  const bots = await prisma.cryptoBot.findMany({
    where: { status: "running" },
    select: {
      id: true, symbol: true, strategyCode: true, interval: true,
      inPosition: true, entryPrice: true, lastChecked: true,
      leverage: true, positionSide: true,
    },
    orderBy: { id: "asc" },
  });

  const list = bots.map(b => {
    const intervalMs = INTERVAL_MS[b.interval] ?? 3_600_000;
    const lastMs = b.lastChecked ? new Date(b.lastChecked).getTime() : 0;
    const elapsed = now - lastMs;
    const nextInMs = Math.max(0, intervalMs - elapsed);
    return {
      id: b.id,
      symbol: b.symbol,
      strategy: b.strategyCode,
      interval: INTERVAL_LABEL[b.interval] ?? b.interval,
      leverage: b.leverage,
      positionSide: b.positionSide,
      inPosition: b.inPosition,
      entryPrice: b.entryPrice,
      lastChecked: b.lastChecked ? new Date(b.lastChecked).toLocaleString("zh-CN") : "从未",
      lastCheckedAgo: lastMs ? `${Math.round(elapsed / 1000)}s 前` : "从未",
      nextCheckIn: nextInMs < 1000 ? "即将执行" : `${Math.round(nextInMs / 1000)}s 后`,
    };
  });

  return NextResponse.json({
    started: true,
    restarted: false,
    schedulerLastRun: status.lastRun ? `${Math.round((now - status.lastRun) / 1000)}s 前` : "从未",
    pollInterval: "30s",
    runningBots: list.length,
    bots: list,
  });
}

import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { AI_MODE_CONFIG, type AiMode } from "@/lib/ai-strategy-selector";

export async function GET() {
  const bots = await prisma.cryptoBot.findMany({
    where: { userId: 1 },
    include: { trades: { orderBy: { createdAt: "desc" }, take: 20 } },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(bots);
}

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    symbol: string;
    aiMode?: AiMode;           // AI 自动模式
    strategyCode?: string;     // 手动模式
    params?: Record<string, number>;
    quoteQty: number;
  };

  // AI 模式：自动设置 interval 和初始策略
  const aiMode = body.aiMode ?? null;
  const modeConfig = aiMode ? AI_MODE_CONFIG[aiMode] : null;

  const bot = await prisma.cryptoBot.create({
    data: {
      userId: 1,
      symbol: body.symbol.toUpperCase(),
      strategyCode: modeConfig ? modeConfig.strategies[0]!.code : (body.strategyCode ?? "ma_cross"),
      params: JSON.stringify(modeConfig ? modeConfig.strategies[0]!.params : (body.params ?? {})),
      interval: modeConfig ? modeConfig.interval : "1d",
      quoteQty: body.quoteQty,
      status: "stopped",
      aiMode,
    },
  });
  return NextResponse.json(bot, { status: 201 });
}

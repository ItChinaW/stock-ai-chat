import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

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
    symbol: string; strategyCode: string; params?: Record<string, number>;
    interval?: string; quoteQty: number;
  };
  const bot = await prisma.cryptoBot.create({
    data: {
      userId: 1,
      symbol: body.symbol.toUpperCase(),
      strategyCode: body.strategyCode,
      params: JSON.stringify(body.params ?? {}),
      interval: body.interval ?? "1d",
      quoteQty: body.quoteQty,
      status: "stopped",
    },
  });
  return NextResponse.json(bot, { status: 201 });
}

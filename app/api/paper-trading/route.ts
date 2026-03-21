import { getCurrentUserId } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function GET() {
  const userId = await getCurrentUserId();
  const trades = await prisma.paperTrade.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(trades);
}

export async function POST(req: NextRequest) {
  const userId = await getCurrentUserId();
  const body = (await req.json()) as {
    symbol: string;
    name?: string;
    strategyCode: string;
    initCapital: number;
    startDate: string;
  };

  const trade = await prisma.paperTrade.create({
    data: {
      userId,
      symbol: body.symbol.toUpperCase(),
      name: body.name ?? "",
      strategyCode: body.strategyCode,
      initCapital: body.initCapital,
      startDate: body.startDate,
      currentValue: body.initCapital,
    },
  });
  return NextResponse.json(trade, { status: 201 });
}

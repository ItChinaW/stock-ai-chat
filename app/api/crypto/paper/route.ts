import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function GET() {
  const list = await prisma.paperTrade.findMany({
    where: { userId: 1, symbol: { contains: "USDT" } },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(list);
}

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    symbol: string;
    strategyCode: string;
    params?: Record<string, number>;
    initCapital: number;
    interval: string;
    startDate: string;
  };

  const record = await prisma.paperTrade.create({
    data: {
      userId: 1,
      symbol: body.symbol.toUpperCase(),
      name: JSON.stringify({ interval: body.interval, params: body.params ?? {} }),
      strategyCode: body.strategyCode,
      initCapital: body.initCapital,
      startDate: body.startDate,
      currentValue: body.initCapital,
    },
  });
  return NextResponse.json(record, { status: 201 });
}

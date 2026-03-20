import { getCurrentUserId } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const userId = await getCurrentUserId();
  const code = request.nextUrl.searchParams.get("code");
  const logs = await prisma.tradeLog.findMany({
    where: { userId, ...(code ? { code: code.toUpperCase() } : {}) },
    include: { strategy: true },
    orderBy: { date: "desc" },
    take: 100,
  });
  return NextResponse.json(logs);
}

export async function POST(request: NextRequest) {
  const userId = await getCurrentUserId();
  const body = (await request.json()) as {
    code: string;
    aiSuggestion: string;
    userAction: string;
    strategyId?: number;
    pnlAfterAction?: number;
  };

  const log = await prisma.tradeLog.create({
    data: {
      userId,
      code: body.code.trim().toUpperCase(),
      aiSuggestion: body.aiSuggestion,
      userAction: body.userAction,
      strategyId: body.strategyId ?? null,
      pnlAfterAction: body.pnlAfterAction ?? null,
    },
    include: { strategy: true },
  });
  return NextResponse.json(log, { status: 201 });
}

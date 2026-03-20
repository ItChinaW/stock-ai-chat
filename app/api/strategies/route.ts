import { getCurrentUserId } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function GET() {
  const userId = await getCurrentUserId();
  const strategies = await prisma.strategy.findMany({
    where: { userId },
    orderBy: { id: "asc" },
  });
  return NextResponse.json(strategies);
}

export async function POST(request: NextRequest) {
  const userId = await getCurrentUserId();
  const body = (await request.json()) as { name?: string; description?: string };
  if (!body.name?.trim()) return NextResponse.json({ message: "name required" }, { status: 400 });
  const strategy = await prisma.strategy.create({
    data: { userId, name: body.name.trim(), description: body.description ?? "" },
  });
  return NextResponse.json(strategy, { status: 201 });
}

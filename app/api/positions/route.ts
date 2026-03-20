import { getCurrentUserId } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

function normalizePositionInput(body: unknown) {
  const input = body as { code?: string; costPrice?: number; amount?: number };
  return {
    code: input.code?.trim().toUpperCase() ?? "",
    costPrice: Number(input.costPrice ?? 0),
    amount: Number(input.amount ?? 0),
  };
}

export async function GET() {
  const userId = await getCurrentUserId();
  const positions = await prisma.position.findMany({
    where: { userId },
    orderBy: { id: "asc" },
  });
  return NextResponse.json(positions);
}

export async function POST(request: NextRequest) {
  try {
    const userId = await getCurrentUserId();
    const body = normalizePositionInput(await request.json());
    if (!body.code || body.amount <= 0) {
      return NextResponse.json({ message: "Invalid payload" }, { status: 400 });
    }
    const created = await prisma.position.create({ data: { ...body, userId } });
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return NextResponse.json({ message: "Failed to create position", error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}

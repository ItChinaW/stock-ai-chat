import { getCurrentUserId } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

function parseId(id: string) {
  const parsed = Number(id);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const positionId = parseId(id);
  if (!positionId) return NextResponse.json({ message: "Invalid id" }, { status: 400 });

  const userId = await getCurrentUserId();
  const position = await prisma.position.findFirst({ where: { id: positionId, userId } });
  if (!position) return NextResponse.json({ message: "Not found" }, { status: 404 });
  return NextResponse.json(position);
}

export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const positionId = parseId(id);
  if (!positionId) return NextResponse.json({ message: "Invalid id" }, { status: 400 });

  try {
    const userId = await getCurrentUserId();
    const payload = (await request.json()) as { code?: string; costPrice?: number; amount?: number; name?: string };
    const updated = await prisma.position.updateMany({
      where: { id: positionId, userId },
      data: {
        code: payload.code?.trim().toUpperCase(),
        costPrice: Number(payload.costPrice ?? 0),
        amount: Number(payload.amount ?? 0),
        ...(payload.name ? { name: payload.name } : {}),
      },
    });
    if (updated.count === 0) return NextResponse.json({ message: "Not found" }, { status: 404 });
    const result = await prisma.position.findUnique({ where: { id: positionId } });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ message: "Failed to update", error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const positionId = parseId(id);
  if (!positionId) return NextResponse.json({ message: "Invalid id" }, { status: 400 });

  const userId = await getCurrentUserId();
  await prisma.position.deleteMany({ where: { id: positionId, userId } });
  return NextResponse.json({ success: true });
}

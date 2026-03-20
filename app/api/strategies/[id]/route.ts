import { getCurrentUserId } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  const { id } = await params;
  const body = (await request.json()) as { name?: string; description?: string };
  const strategy = await prisma.strategy.update({
    where: { id: Number(id), userId },
    data: { name: body.name?.trim(), description: body.description },
  });
  return NextResponse.json(strategy);
}

export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  const { id } = await params;
  await prisma.strategy.delete({ where: { id: Number(id), userId } });
  return NextResponse.json({ ok: true });
}

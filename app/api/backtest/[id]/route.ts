import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

type Params = Promise<{ id: string }>;

export async function GET(_req: NextRequest, { params }: { params: Params }) {
  const { id } = await params;
  const record = await prisma.backtest.findUnique({ where: { id: Number(id) } });
  if (!record) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(record);
}

export async function DELETE(_req: NextRequest, { params }: { params: Params }) {
  const { id } = await params;
  await prisma.backtest.delete({ where: { id: Number(id) } });
  return NextResponse.json({ ok: true });
}

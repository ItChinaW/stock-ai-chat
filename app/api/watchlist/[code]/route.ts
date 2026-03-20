import { getCurrentUserId } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const userId = await getCurrentUserId();
  await prisma.watchlist.deleteMany({ where: { userId, code: code.toUpperCase() } });
  return new NextResponse(null, { status: 204 });
}

import { getCurrentUserId } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function GET() {
  const userId = await getCurrentUserId();
  const items = await prisma.watchlist.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json(items);
}

export async function POST(request: NextRequest) {
  const userId = await getCurrentUserId();
  const body = (await request.json()) as { code?: string; name?: string };
  const code = body.code?.trim().toUpperCase();
  if (!code) return NextResponse.json({ message: "code required" }, { status: 400 });

  const item = await prisma.watchlist.upsert({
    where: { userId_code: { userId, code } },
    update: { name: body.name ?? "" },
    create: { userId, code, name: body.name ?? "" },
  });
  return NextResponse.json(item, { status: 201 });
}

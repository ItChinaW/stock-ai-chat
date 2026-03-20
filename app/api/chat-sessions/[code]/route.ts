import { getCurrentUserId } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

type Params = { params: Promise<{ code: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { code } = await params;
  const userId = await getCurrentUserId();
  const session = await prisma.chatSession.findUnique({
    where: { userId_code: { userId, code: code.toUpperCase() } },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
  return NextResponse.json(session?.messages ?? []);
}

export async function POST(req: NextRequest, { params }: Params) {
  const { code } = await params;
  const userId = await getCurrentUserId();
  const body = (await req.json()) as { role: string; content: string };

  const session = await prisma.chatSession.upsert({
    where: { userId_code: { userId, code: code.toUpperCase() } },
    update: {},
    create: { userId, code: code.toUpperCase() },
  });

  const message = await prisma.chatMessage.create({
    data: { sessionId: session.id, role: body.role, content: body.content },
  });
  return NextResponse.json(message, { status: 201 });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { code } = await params;
  const userId = await getCurrentUserId();
  const session = await prisma.chatSession.findUnique({
    where: { userId_code: { userId, code: code.toUpperCase() } },
  });
  if (session) {
    await prisma.chatMessage.deleteMany({ where: { sessionId: session.id } });
  }
  return new NextResponse(null, { status: 204 });
}

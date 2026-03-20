import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function GET() {
  const strategies = await prisma.strategy.findMany({ orderBy: { id: "asc" } });
  return NextResponse.json(strategies);
}

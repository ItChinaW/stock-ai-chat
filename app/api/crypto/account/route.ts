import { getAccount } from "@/lib/binance";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const account = await getAccount();
    return NextResponse.json(account);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "failed" }, { status: 500 });
  }
}

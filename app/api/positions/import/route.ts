import { recognizePositionsFromImage } from "@/lib/vision";
import { NextRequest, NextResponse } from "next/server";

async function resolveCodeByName(name: string): Promise<string> {
  try {
    const url = `https://suggest3.sinajs.cn/suggest/type=11,12,13,14,15&key=${encodeURIComponent(name)}&name=suggestvalue`;
    const res = await fetch(url, { headers: { Referer: "https://finance.sina.com.cn" } });
    const buf = await res.arrayBuffer();
    const text = new TextDecoder("gbk").decode(buf);
    const match = text.match(/suggestvalue="([^"]+)"/);
    if (!match) return "";
    const first = match[1]!.split(";")[0] ?? "";
    const parts = first.split(",");
    return parts[2] ?? ""; // 新浪 suggest 第3字段是代码
  } catch {
    return "";
  }
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as { image: string; mimeType?: string };
  if (!body.image) return NextResponse.json({ message: "image required" }, { status: 400 });

  try {
    const positions = await recognizePositionsFromImage(body.image, body.mimeType);

    const resolved = await Promise.all(
      positions.map(async (p) => {
        if (p.code) return p;
        return { ...p, code: await resolveCodeByName(p.name) };
      }),
    );

    return NextResponse.json({ positions: resolved });
  } catch (err) {
    return NextResponse.json(
      { message: err instanceof Error ? err.message : "识别失败" },
      { status: 500 },
    );
  }
}

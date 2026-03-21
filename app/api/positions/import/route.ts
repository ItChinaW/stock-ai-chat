import { recognizePositionsFromImage } from "@/lib/vision";
import { NextRequest, NextResponse } from "next/server";

async function resolveCodeByName(name: string): Promise<string> {
  try {
    const res = await fetch(
      `https://suggest3.sinajs.cn/suggest/key=${encodeURIComponent(name)}`,
      { headers: { Referer: "https://finance.sina.com.cn" } },
    );
    const buf = await res.arrayBuffer();
    const text = new TextDecoder("gbk").decode(buf);
    const m = text.match(/suggestvalue="([^"]*)"/);
    if (!m) return "";
    const items = m[1]!.split(";").filter(Boolean);
    // 优先取 sh/sz 前缀的条目（type=203），避免取到 of 基金代码
    const shsz = items.find((item) => {
      const f = item.split(",");
      return f[3]?.startsWith("sh") || f[3]?.startsWith("sz");
    });
    const fields = (shsz ?? items[0] ?? "").split(",");
    return fields[2] ?? "";
  } catch {
    return "";
  }
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as { image: string; mimeType?: string };
  if (!body.image) return NextResponse.json({ message: "image required" }, { status: 400 });

  try {
    const positions = await recognizePositionsFromImage(body.image, body.mimeType);

    // code 为空时通过新浪搜索补全
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

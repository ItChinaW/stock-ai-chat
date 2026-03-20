import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.DASHSCOPE_API_KEY ?? "",
  baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
});

// 通过新浪搜索接口，按股票名称查询代码
async function resolveCodeByName(name: string): Promise<string> {
  try {
    const res = await fetch(
      `https://suggest3.sinajs.cn/suggest/type=11,12&key=${encodeURIComponent(name)}`,
      { headers: { Referer: "https://finance.sina.com.cn" } },
    );
    const buf = await res.arrayBuffer();
    const text = new TextDecoder("gbk").decode(buf);
    // 格式：var suggestvalue="名称,类型,代码,sina代码,...";
    const m = text.match(/suggestvalue="([^"]*)"/);
    if (!m) return "";
    const first = m[1]!.split(";")[0]!; // 取第一条结果
    const fields = first.split(",");
    return fields[2] ?? ""; // 第三个字段是6位代码
  } catch {
    return "";
  }
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as { image: string; mimeType?: string };
  if (!body.image) return NextResponse.json({ message: "image required" }, { status: 400 });

  const mimeType = body.mimeType ?? "image/jpeg";

  try {
    const response = await client.chat.completions.create({
      model: "qwen-vl-plus-latest",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: { url: `data:${mimeType};base64,${body.image}` },
            },
            {
              type: "text",
              text: `这是一张股票持仓截图。请提取所有持仓股票的信息，以 JSON 数组返回，格式如下：
[{"name":"股票名称","code":"股票代码（6位数字，如果图中没有代码则留空字符串）","costPrice":成本价数字,"amount":持仓数量数字}]
注意：
- 只返回 JSON 数组，不要任何其他文字
- 成本价取"成本"或"成本价"列，数量取"持仓"或"可用"中较大的那个
- 如果某字段无法识别，costPrice 填 0，amount 填 0`,
            },
          ],
        },
      ],
    });

    const text = response.choices[0]?.message?.content ?? "";
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) return NextResponse.json({ message: "识别失败，未找到持仓数据" }, { status: 422 });

    const positions = JSON.parse(match[0]) as { name: string; code: string; costPrice: number; amount: number }[];

    // 对 code 为空的股票，通过名称查询代码
    const resolved = await Promise.all(
      positions.map(async (p) => {
        if (p.code) return p;
        const code = await resolveCodeByName(p.name);
        return { ...p, code };
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

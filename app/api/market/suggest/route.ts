import { NextRequest, NextResponse } from "next/server";

// 新浪行情接口不会被封，直接用来查名称
export async function GET(req: NextRequest) {
  const key = (req.nextUrl.searchParams.get("key") ?? "").trim();
  if (!key) return new NextResponse(`var suggestvalue=""`, { headers: { "Content-Type": "text/plain; charset=utf-8" } });

  try {
    // 如果是纯数字代码，直接查行情拿名称
    if (/^\d{5,6}$/.test(key)) {
      const isSH = /^(6|5|11)/.test(key);
      const sinaCode = `${isSH ? "sh" : "sz"}${key}`;
      const res = await fetch(`https://hq.sinajs.cn/list=${sinaCode}`, {
        headers: { Referer: "https://finance.sina.com.cn" },
      });
      const buf = await res.arrayBuffer();
      const text = new TextDecoder("gbk").decode(buf);
      const match = text.match(/="([^"]+)"/);
      if (match) {
        const parts = match[1]!.split(",");
        const name = parts[0] ?? "";
        if (name) {
          // 构造 suggest 格式，前端用 parts[4]
          return new NextResponse(`var suggestvalue="${key},,,,${name},"`, {
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          });
        }
      }
    }
  } catch { /* ignore */ }

  return new NextResponse(`var suggestvalue=""`, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

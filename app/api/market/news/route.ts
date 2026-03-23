import { NextResponse } from "next/server";
import OpenAI from "openai";

type NewsItem = { title: string; url: string; digest: string; tag: string; hot: number; time: number };

// ── 同花顺 ──────────────────────────────────────────────
async function fetchThs(): Promise<NewsItem[]> {
  const res = await fetch("https://news.10jqka.com.cn/tapp/news/push/stock?page=1&tag=&track=website&pagesize=30", {
    headers: { "User-Agent": "Mozilla/5.0", Referer: "https://news.10jqka.com.cn/" },
    next: { revalidate: 60 },
  });
  const json = await res.json() as { data: { list: { title: string; url: string; digest: string; tag: string; import: string; ctime: string }[] } };
  return (json.data?.list ?? []).map(item => ({
    title: item.title, url: item.url,
    digest: item.digest?.slice(0, 80) ?? "",
    tag: item.tag || "A股",
    hot: parseInt(item.import || "0"),
    time: parseInt(item.ctime || "0"),
  }));
}

// ── 东方财富 ─────────────────────────────────────────────
async function fetchEm(): Promise<NewsItem[]> {
  const res = await fetch(
    "https://np-listapi.eastmoney.com/comm/web/getNewsByColumns?columns=294&pageSize=30&startPage=1&order=1&orderby=2&client=web&biz=web_news_col&column=294&req_trace=kiro123",
    { headers: { "User-Agent": "Mozilla/5.0", Referer: "https://finance.eastmoney.com/" }, next: { revalidate: 60 } }
  );
  const json = await res.json() as { data: { list: { title: string; url: string; summary: string; showTime: string }[] } };
  return (json.data?.list ?? []).map(item => ({
    title: item.title, url: item.url,
    digest: item.summary?.slice(0, 80) ?? "",
    tag: "要闻", hot: 0,
    time: new Date(item.showTime).getTime() / 1000,
  }));
}

// ── 新浪财经 ─────────────────────────────────────────────
async function fetchSina(): Promise<NewsItem[]> {
  const lids = [{ lid: "2516", tag: "财经" }, { lid: "2518", tag: "综合" }];
  const results = await Promise.allSettled(lids.map(ch =>
    fetch(`https://feed.mix.sina.com.cn/api/roll/get?pageid=153&lid=${ch.lid}&num=20&page=1`, {
      headers: { "User-Agent": "Mozilla/5.0", Referer: "https://finance.sina.com.cn/" },
      next: { revalidate: 60 },
    }).then(r => r.json() as Promise<{ result: { status: { code: number }; data: { title: string; url: string; ctime: string; comment_total: string }[] } }>)
      .then(d => d.result?.status?.code !== 0 ? [] : (d.result.data ?? []).map(item => ({
        title: item.title, url: item.url, digest: "",
        tag: ch.tag, hot: parseInt(item.comment_total || "0"),
        time: parseInt(item.ctime || "0"),
      })))
  ));
  const all: NewsItem[] = [];
  for (const r of results) if (r.status === "fulfilled") all.push(...r.value);
  const seen = new Set<string>();
  return all.filter(item => { if (seen.has(item.url)) return false; seen.add(item.url); return true; });
}

// ── 全球 RSS ─────────────────────────────────────────────
const RSS_FEEDS = [
  { url: "https://feeds.reuters.com/reuters/businessNews", tag: "路透" },
  { url: "https://feeds.reuters.com/reuters/topNews", tag: "路透" },
  { url: "https://feeds.bbci.co.uk/news/business/rss.xml", tag: "BBC" },
  { url: "https://rss.nytimes.com/services/xml/rss/nyt/Business.xml", tag: "NYT" },
];

function parseRss(xml: string, tag: string): { title: string; url: string; time: number; tag: string }[] {
  const items: { title: string; url: string; time: number; tag: string }[] = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(xml)) !== null) {
    const block = m[1];
    const title = (/<title><!\[CDATA\[(.+?)\]\]><\/title>/.exec(block) ?? /<title>(.+?)<\/title>/.exec(block))?.[1]?.trim() ?? "";
    const link = (/<link>(.+?)<\/link>/.exec(block) ?? /<guid[^>]*>(.+?)<\/guid>/.exec(block))?.[1]?.trim() ?? "";
    const pubDate = (/<pubDate>(.+?)<\/pubDate>/.exec(block))?.[1]?.trim() ?? "";
    if (title && link) {
      items.push({ title, url: link, time: pubDate ? new Date(pubDate).getTime() / 1000 : 0, tag });
    }
  }
  return items;
}

// 内存翻译缓存（key=原文, value=译文）
const translateCache = new Map<string, string>();

async function translateTitles(titles: string[]): Promise<string[]> {
  const toTranslate = titles.filter(t => !translateCache.has(t));
  if (toTranslate.length === 0) return titles.map(t => translateCache.get(t) ?? t);

  try {
    const client = new OpenAI({
      apiKey: process.env.ZHIPU_API_KEY ?? "",
      baseURL: "https://open.bigmodel.cn/api/paas/v4",
    });
    const prompt = `将以下新闻标题翻译成中文，保持简洁，每行一个，按原顺序输出，只输出译文不要编号：\n${toTranslate.join("\n")}`;
    const res = await client.chat.completions.create({
      model: "glm-4-flash",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 1000,
      temperature: 0.1,
    });
    const lines = (res.choices[0]?.message?.content ?? "").split("\n").map(l => l.trim()).filter(Boolean);
    toTranslate.forEach((orig, i) => {
      if (lines[i]) translateCache.set(orig, lines[i]);
    });
  } catch {
    // 翻译失败保留原文
  }

  return titles.map(t => translateCache.get(t) ?? t);
}

async function fetchGlobal(): Promise<NewsItem[]> {
  const results = await Promise.allSettled(RSS_FEEDS.map(feed =>
    fetch(feed.url, {
      headers: { "User-Agent": "Mozilla/5.0", Accept: "application/rss+xml, application/xml" },
      next: { revalidate: 300 },
    }).then(r => r.text()).then(xml => parseRss(xml, feed.tag))
  ));

  const all: { title: string; url: string; time: number; tag: string }[] = [];
  for (const r of results) if (r.status === "fulfilled") all.push(...r.value);

  // 去重 + 按时间排序，取前30
  const seen = new Set<string>();
  const deduped = all
    .filter(item => { if (seen.has(item.url)) return false; seen.add(item.url); return true; })
    .sort((a, b) => b.time - a.time)
    .slice(0, 30);

  // 批量翻译标题
  const translated = await translateTitles(deduped.map(i => i.title));

  return deduped.map((item, i) => ({
    title: translated[i],
    url: item.url,
    digest: "",
    tag: item.tag,
    hot: 0,
    time: item.time,
  }));
}

// ── 路由 ─────────────────────────────────────────────────
export const revalidate = 60;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const source = searchParams.get("source") ?? "ths";

  try {
    let items: NewsItem[] = [];
    if (source === "em") items = await fetchEm();
    else if (source === "sina") items = await fetchSina();
    else if (source === "global") items = await fetchGlobal();
    else items = await fetchThs();

    if (source !== "global") items.sort((a, b) => b.hot - a.hot || b.time - a.time);
    return NextResponse.json(items.slice(0, 25));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "failed" }, { status: 500 });
  }
}

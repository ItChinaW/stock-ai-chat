import { prisma } from "@/lib/prisma";
import OpenAI from "openai";
import dayjs from "dayjs";

// 未来一周大事时间线 —— 数据采集与入库。
// 三路数据源合并后写入 market_events 表，前端从库读取：
//   1) 人工精选 CURATED_EVENTS（已核实日期的确定性大事，如世界杯/重大IPO）
//   2) 财经日历 API（金十数据，best-effort，部分网络不可达时自动降级）
//   3) AI 从多家实时财经新闻里归纳（同花顺/东财/新浪/全球RSS/华尔街见闻）

export type EventDTO = {
  date: string;       // YYYY-MM-DD
  time?: string;      // HH:mm
  title: string;
  category: "宏观" | "公司" | "行业" | "综合";
  region: string;
  importance: 1 | 2 | 3;
  note?: string;
  source: string;
  url?: string;
};

const WINDOW_DAYS = 7;
const CATS = new Set(["宏观", "公司", "行业", "综合"]);

// ── 人工精选大事 ────────────────────────────────────────────────
// 维护方式：直接在此数组增删即可，ingest 时 upsert 进库（pinned）。
// 日期已人工核实；过期后会被自动清理。
const CURATED_EVENTS: EventDTO[] = [
  {
    date: "2026-06-11",
    title: "2026世界杯揭幕战",
    category: "综合",
    region: "全球",
    importance: 3,
    note: "墨西哥vs南非·墨西哥城阿兹特克球场",
    source: "manual",
    url: "https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026",
  },
  {
    date: "2026-06-12",
    title: "SpaceX 纳斯达克上市",
    category: "公司",
    region: "美国",
    importance: 3,
    note: "代码SPCX·或为史上最大IPO·6/11盘后定价",
    source: "manual",
    url: "https://www.cnbc.com/2026/05/20/spacex-ipo-live-updates.html",
  },
];

// ── AI 供应商 ──────────────────────────────────────────────────
function resolveProvider(): { apiKey: string; baseURL?: string; model: string } | null {
  if (process.env.DEEPSEEK_API_KEY)
    return { apiKey: process.env.DEEPSEEK_API_KEY, baseURL: "https://api.deepseek.com", model: "deepseek-chat" };
  if (process.env.DASHSCOPE_API_KEY)
    return { apiKey: process.env.DASHSCOPE_API_KEY, baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-plus" };
  if (process.env.ZHIPU_API_KEY)
    return { apiKey: process.env.ZHIPU_API_KEY, baseURL: "https://open.bigmodel.cn/api/paas/v4", model: "glm-4-flash" };
  if (process.env.OPENAI_API_KEY)
    return { apiKey: process.env.OPENAI_API_KEY, model: "gpt-4o-mini" };
  return null;
}

function normalizeTitle(t: string): string {
  return t.replace(/[\s　，,。.、:：()（）「」"'%·\-—()]/g, "").toLowerCase();
}

// 更激进的「核心标题」：去括号内容 + 去常见限定词，用于跨日期去重
// （AI 常把同一事件以"（预计）/数据/公布"等不同措辞或不同日期重复输出）
function coreTitle(t: string): string {
  return t
    .replace(/[（(](?:预计|预期|预估|初值|终值|暂定|待定|月率|年率|环比|同比)[）)]/g, "") // 去限定性括号
    .replace(/[（()）]/g, "") // 其余括号仅去符号、保留内容（如 WWDC）
    .replace(/20\d{2}年?/g, "") // 去年份前缀（2026 / 2026年）
    .replace(/\d+月份?/g, "")
    .replace(/(利率决议|利率决定|议息会议|货币政策会议|货币政策决议|议息)/g, "议息")
    .replace(/(揭幕战|揭幕式|揭幕|开幕式|开幕)/g, "揭幕")
    .replace(/(预计|前瞻|初值|终值|或|约|数据|公布|发布|举行|召开|相关|进展|长期|多年期|多年)/g, "")
    .replace(/[\s　，,。.、:：「」"'%·\-—]/g, "")
    .toLowerCase();
}

function clampImportance(n: unknown): 1 | 2 | 3 {
  const v = Number(n);
  return (v >= 3 ? 3 : v === 2 ? 2 : 1) as 1 | 2 | 3;
}

// 是否中国相关（按用户要求过滤掉）：地区为中国/港澳，或标题含明显中国本地关键词
const CHINA_REGIONS = new Set(["中国", "中国大陆", "大陆", "香港", "中国香港", "港股", "A股"]);
const CHINA_KW = /(A股|沪深|人民币|央行逆回购|逆回购|中间价|科创板|创业板|港股|沪指|深成指|北向|证监会|国务院|发改委|工信部)/;
function isChinaRelated(e: { region: string; title: string; note?: string | null }): boolean {
  if (CHINA_REGIONS.has(e.region.trim())) return true;
  return CHINA_KW.test(e.title) || (e.note ? CHINA_KW.test(e.note) : false);
}

// 只保留「可预计的日程型事件」（数据公布/议息/财报/发布会/IPO/赛事等）。
// 过滤：评论表态、已发生的突发/灾害、行情异动——这些不是未来可预计事件，
// 且常被 AI 安上错误日期（如把旧闻/观点当成本周事件）。
const NON_EVENT_KW = /(谈|认为|表示|声称|宣称|称与|称将|警告|看好|看涨|看跌|唱多|唱空|呼吁|评论|质疑|抨击|批评|回应|讲话|表态|访问|出访|攻击|袭击|空袭|爆炸|轰炸|坠毁|地震|海啸|事故|遇袭|交火|冲突|抛售|飙升|暴跌|暴涨|大涨|大跌|跳水|拉升|异动|上行|下行|持仓变动|筹备|进展|相关活动|相关会议)/;
function isNonEvent(e: { title: string }): boolean {
  return NON_EVENT_KW.test(e.title);
}

// ── 财经日历（金十数据 CDN，best-effort）────────────────────────
type Jin10Row = {
  country?: string; name?: string; indicator_name?: string; event_content?: string; title?: string;
  pub_time?: string; event_time?: string; time?: string;
  star?: number | string; importance?: number | string;
  previous?: string; consensus?: string; forecast?: string;
};

async function fetchJin10Day(d: dayjs.Dayjs, kind: "economics" | "event"): Promise<EventDTO[]> {
  const url = `https://cdn-rili.jin10.com/web_data/${d.format("YYYY")}/daily/${d.format("MM")}/${d.format("DD")}/${kind}.json`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0", Referer: "https://rili.jin10.com/" },
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) return [];
    const rows = (await res.json()) as Jin10Row[];
    if (!Array.isArray(rows)) return [];
    return rows
      .map((r): EventDTO | null => {
        const title = (r.name ?? r.indicator_name ?? r.event_content ?? r.title ?? "").trim();
        if (!title) return null;
        const ts = r.pub_time ?? r.event_time ?? r.time ?? "";
        const time = /\d{2}:\d{2}/.exec(ts)?.[0];
        const fc = r.consensus ?? r.forecast;
        return {
          date: d.format("YYYY-MM-DD"),
          time,
          title: title.slice(0, 30),
          category: "宏观",
          region: r.country?.trim() || "全球",
          importance: clampImportance(r.star ?? r.importance ?? 1),
          note: [r.previous && `前值 ${r.previous}`, fc && `预测 ${fc}`].filter(Boolean).join(" · ") || undefined,
          source: "calendar",
        };
      })
      .filter((x): x is EventDTO => x !== null && x.importance >= 2);
  } catch {
    return [];
  }
}

async function fetchCalendar(start: dayjs.Dayjs): Promise<EventDTO[]> {
  const days = Array.from({ length: WINDOW_DAYS }, (_, i) => start.add(i, "day"));
  const results = await Promise.allSettled(
    days.flatMap((d) => [fetchJin10Day(d, "economics"), fetchJin10Day(d, "event")])
  );
  const all: EventDTO[] = [];
  for (const r of results) if (r.status === "fulfilled") all.push(...r.value);
  return all;
}

// ── 新闻聚合（多源，供 AI 归纳）─────────────────────────────────
function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, "").replace(/&[a-z]+;/g, " ").trim();
}

// 新闻条目：文本 + 原文链接（用于事件回溯原文）
type NewsSource = { text: string; url?: string };

// 华尔街见闻：覆盖全球宏观/美股/A股快讯，对 IPO、议息、大事报道及时
async function fetchWallstreetcn(): Promise<NewsSource[]> {
  const channels = ["global-channel", "us-stock-channel", "a-stock-channel"];
  const results = await Promise.allSettled(
    channels.map((ch) =>
      fetch(`https://api-one-wscn.awtmt.com/apiv1/content/lives?channel=${ch}&client=pc&limit=25`, {
        headers: { "User-Agent": "Mozilla/5.0" },
        signal: AbortSignal.timeout(8000),
      }).then((r) => r.json() as Promise<{ data?: { items?: { id?: number; uri?: string; title?: string; content_text?: string; content?: string }[] } }>)
    )
  );
  const out: NewsSource[] = [];
  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    for (const it of r.value.data?.items ?? []) {
      const text = it.title?.trim() || stripHtml(it.content_text || it.content || "");
      if (text) out.push({ text: text.slice(0, 120), url: it.uri || (it.id ? `https://wallstreetcn.com/livenews/${it.id}` : undefined) });
    }
  }
  return out;
}

// 复用项目已有的 /api/market/news 各源（含原文 url）
async function fetchExistingNews(origin: string): Promise<NewsSource[]> {
  const sources = ["ths", "em", "sina", "global"];
  const results = await Promise.allSettled(
    sources.map((s) =>
      fetch(`${origin}/api/market/news?source=${s}`, { signal: AbortSignal.timeout(9000) })
        .then((r) => r.json() as Promise<{ title: string; digest?: string; url?: string }[]>)
    )
  );
  const out: NewsSource[] = [];
  for (const r of results) {
    if (r.status !== "fulfilled" || !Array.isArray(r.value)) continue;
    for (const it of r.value.slice(0, 20)) {
      if (it?.title) out.push({ text: it.digest ? `${it.title}——${it.digest}` : it.title, url: it.url });
    }
  }
  return out;
}

async function gatherSources(origin: string): Promise<NewsSource[]> {
  const [existing, wscn] = await Promise.all([fetchExistingNews(origin), fetchWallstreetcn()]);
  const seen = new Set<string>();
  const merged: NewsSource[] = [];
  for (const s of [...existing, ...wscn]) {
    const k = normalizeTitle(s.text).slice(0, 40);
    if (k && !seen.has(k)) { seen.add(k); merged.push(s); }
  }
  return merged.slice(0, 100);
}

// ── AI 归纳 ────────────────────────────────────────────────────
function stripJson(text: string): string {
  return text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
}

async function fetchAiEvents(origin: string, start: dayjs.Dayjs, end: dayjs.Dayjs): Promise<EventDTO[]> {
  const provider = resolveProvider();
  if (!provider) return [];

  const sources = await gatherSources(origin);
  if (sources.length === 0) return [];

  const today = start.format("YYYY-MM-DD");
  const weekday = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][start.day()];

  const prompt = `今天是 ${today}（${weekday}）。请基于下面多家财经媒体的新闻，归纳"从今天起未来 7 天内（${today} 至 ${end.format("YYYY-MM-DD")}）可预计的、有明确或可合理推断日期的重大事件"，做成投资者日程提醒。

务必尽量多地覆盖以下类型（不要只输出宏观数据）：
- 宏观/央行：非农、CPI/PPI、议息(FOMC/各国央行)、GDP、PMI 等
- 公司：IPO/上市、财报发布、新品发布会、股东大会、解禁
- 行业与监管：重要政策、行业会议、白皮书发布
- 综合大事：重要峰会、体育赛事(如世界杯)、科技/航天大事(如火箭发射、上市)

【硬性要求】
1. 只要【官方排定日程/已正式公布日期】的未来事件：经济数据公布、央行议息、企业财报、产品发布会、IPO上市、体育赛事、重要峰会等有确定未来发生时点的事件。
   严禁包含：① 评论/观点/表态/讲话/"某人谈/认为/警告/看好"；② 已经发生的突发新闻（冲突、袭击、爆炸、灾害、事故、领导人出访等）；③ 行情异动/涨跌/收益率变化/持仓变动等盘面解读。这些都不是"未来可预计事件"。
2. 排除一切中国相关事件：中国大陆/A股/港股个股公告、派息除权、人民币中间价、中国央行公开市场操作、中国国内政经活动等都不要。聚焦美国、欧洲、日韩及全球性大事。
3. date 必须是事件【实际发生】的那一天，且落在 ${today} 至 ${end.format("YYYY-MM-DD")} 之间；不要用新闻发布日。尽量把事件分散到这 7 天，不要都堆在今天。
4. 不确定具体日期的不要编造；已发生的不要。不要输出含糊的"筹备/进展/相关会议"等填充类事件；同一事件只输出一次（用最准确的日期）。
5. 若事件主要来自下方某条新闻，用 "ref" 标明该新闻序号（数字）便于回溯原文；你补充的常识性事件可省略 ref。
6. 严格只输出 JSON 数组，不要任何解释、不要代码块围栏。每个元素：
{"date":"YYYY-MM-DD","time":"HH:mm或省略","title":"≤18字简洁标题","category":"宏观|公司|行业|综合","region":"美国|欧洲|日本|韩国|全球|其它","importance":1|2|3,"note":"≤24字补充，可省略","ref":新闻序号或省略}
importance：3=极重要，2=重要，1=一般。按日期升序，尽量给出 12-20 条。

新闻列表：
${sources.map((s, i) => `${i + 1}. ${s.text}`).join("\n")}`;

  try {
    const client = new OpenAI({ apiKey: provider.apiKey, baseURL: provider.baseURL });
    const res = await client.chat.completions.create({
      model: provider.model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: 2200,
    });
    const parsed = JSON.parse(stripJson(res.choices[0]?.message?.content ?? "")) as (Partial<EventDTO> & { ref?: number })[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((e) => e && typeof e.date === "string" && typeof e.title === "string")
      .map((e): EventDTO => {
        const ref = Number(e.ref);
        const url = Number.isInteger(ref) && ref >= 1 && ref <= sources.length ? sources[ref - 1].url : undefined;
        return {
          date: e.date as string,
          time: typeof e.time === "string" && /\d{1,2}:\d{2}/.test(e.time) ? e.time : undefined,
          title: (e.title as string).slice(0, 24),
          category: CATS.has(e.category as string) ? (e.category as EventDTO["category"]) : "综合",
          region: (e.region as string) || "全球",
          importance: clampImportance(e.importance),
          note: typeof e.note === "string" ? e.note.slice(0, 30) : undefined,
          source: "ai",
          url,
        };
      });
  } catch {
    return [];
  }
}

// ── 入库（采集 → upsert）────────────────────────────────────────
const g = globalThis as unknown as { eventsLastIngest?: number; eventsIngesting?: boolean };
const INGEST_TTL = 30 * 60_000;

export function isIngestStale(): boolean {
  return !g.eventsLastIngest || Date.now() - g.eventsLastIngest > INGEST_TTL;
}

export async function ingestEvents(origin: string): Promise<number> {
  if (g.eventsIngesting) return 0;
  g.eventsIngesting = true;
  try {
    const start = dayjs().startOf("day");
    const end = start.add(WINDOW_DAYS - 1, "day");
    const lo = start.format("YYYY-MM-DD");
    const hi = end.format("YYYY-MM-DD");

    const [calendar, ai] = await Promise.all([
      fetchCalendar(start),
      fetchAiEvents(origin, start, end),
    ]);

    // 合并：人工精选优先级最高，其次 calendar，再 ai；
    // 过滤窗口外 / 中国相关 / 非日程型（评论·突发·行情）
    const all = [...CURATED_EVENTS, ...calendar, ...ai]
      .filter((e) => e.date >= lo && e.date <= hi)
      .filter((e) => e.source === "manual" || (!isChinaRelated(e) && !isNonEvent(e)));

    let count = 0;
    for (const e of all) {
      const dedupeKey = `${e.date}|${normalizeTitle(e.title)}`;
      if (!dedupeKey.split("|")[1]) continue;
      const pinned = e.source === "manual";
      await prisma.marketEvent.upsert({
        where: { dedupeKey },
        create: {
          date: e.date, time: e.time ?? null, title: e.title, category: e.category,
          region: e.region, importance: e.importance, note: e.note ?? null,
          source: e.source, url: e.url ?? null, dedupeKey, pinned,
        },
        update: {
          // 已存在时，仅在新数据更可信/更重要时覆盖；人工精选不被覆盖
          ...(pinned
            ? { time: e.time ?? null, title: e.title, category: e.category, region: e.region, importance: e.importance, note: e.note ?? null, source: e.source, url: e.url ?? null, pinned: true }
            : { importance: { set: e.importance }, note: e.note ?? null, time: e.time ?? null, region: e.region, category: e.category, ...(e.url ? { url: e.url } : {}) }),
        },
      });
      count++;
    }

    // 清理：过期事件（昨天及更早）+ 历史遗留的中国地区事件
    await prisma.marketEvent.deleteMany({
      where: { OR: [{ date: { lt: lo } }, { region: { in: [...CHINA_REGIONS] } }] },
    });

    g.eventsLastIngest = Date.now();
    return count;
  } finally {
    g.eventsIngesting = false;
  }
}

// ── 读取（供前端）──────────────────────────────────────────────
export async function getUpcomingEvents(): Promise<EventDTO[]> {
  const start = dayjs().startOf("day");
  const lo = start.format("YYYY-MM-DD");
  const hi = start.add(WINDOW_DAYS - 1, "day").format("YYYY-MM-DD");

  const rows = await prisma.marketEvent.findMany({
    where: { date: { gte: lo, lte: hi } },
    orderBy: [{ date: "asc" }, { importance: "desc" }],
  });

  // 跨日期去重（按核心标题），保留更优实例：重要度高 > 有原文链接 > 日期更早；
  // 同时防御性过滤中国相关
  const seen = new Map<string, EventDTO>();
  for (const r of rows) {
    if (r.source !== "manual" && (isChinaRelated(r) || isNonEvent(r))) continue;
    const dto: EventDTO = {
      date: r.date,
      time: r.time ?? undefined,
      title: r.title,
      category: (CATS.has(r.category) ? r.category : "综合") as EventDTO["category"],
      region: r.region,
      importance: clampImportance(r.importance),
      note: r.note ?? undefined,
      source: r.source,
      url: r.url ?? undefined,
    };
    const key = coreTitle(dto.title) || normalizeTitle(dto.title);
    const prev = seen.get(key);
    if (!prev) {
      seen.set(key, dto);
      continue;
    }
    // 人工精选优先保留
    if (prev.source === "manual") continue;
    if (dto.source === "manual") {
      seen.set(key, dto);
      continue;
    }
    const better =
      dto.importance > prev.importance ||
      (dto.importance === prev.importance && !!dto.url && !prev.url) ||
      (dto.importance === prev.importance && !!dto.url === !!prev.url && dto.date < prev.date);
    if (better) seen.set(key, dto);
  }

  // 按日分组，每天最多保留 5 条（按重要度），确保未来 7 天都能展示、
  // 不会因为某天事件过多而把后面几天（如世界杯/IPO）挤掉
  const byDate = new Map<string, EventDTO[]>();
  for (const e of seen.values()) {
    const arr = byDate.get(e.date) ?? [];
    arr.push(e);
    byDate.set(e.date, arr);
  }
  const result: EventDTO[] = [];
  for (const date of [...byDate.keys()].sort()) {
    const dayEvents = byDate
      .get(date)!
      .sort((a, b) => b.importance - a.importance || (a.time ?? "99").localeCompare(b.time ?? "99"))
      .slice(0, 5);
    result.push(...dayEvents);
  }
  return result.slice(0, 30);
}

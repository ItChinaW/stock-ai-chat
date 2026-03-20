import { INVESTMENT_SYSTEM_PROMPT } from "@/lib/ai/system-prompt";
import { NextRequest } from "next/server";
import OpenAI from "openai";

const MODEL_MAP: Record<string, string> = {
  "gpt-4o": "gpt-4o",
  "gpt-4o-mini": "gpt-4o-mini",
  "deepseek-chat": "deepseek-chat",
  "qwen-plus": "qwen-plus",
};

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const body = (await request.json()) as {
    messages: { role: "user" | "assistant"; content: string }[];
    model?: string;
    context?: {
      code: string;
      currentPrice?: number;
      costPrice?: number;
      amount?: number;
      strategy?: string;
      strategyDescription?: string;
    };
  };

  const modelKey = body.model ?? "deepseek-chat";
  const modelId = MODEL_MAP[modelKey] ?? "deepseek-chat";
  const isDeepSeek = modelKey.startsWith("deepseek");
  const isQwen = modelKey.startsWith("qwen");

  const client = new OpenAI({
    apiKey: isDeepSeek
      ? (process.env.DEEPSEEK_API_KEY ?? "")
      : isQwen
        ? (process.env.DASHSCOPE_API_KEY ?? "")
        : (process.env.OPENAI_API_KEY ?? ""),
    baseURL: isDeepSeek
      ? "https://api.deepseek.com"
      : isQwen
        ? "https://dashscope.aliyuncs.com/compatible-mode/v1"
        : undefined,
  });

  let systemPrompt = INVESTMENT_SYSTEM_PROMPT;
  if (body.context) {
    const ctx = body.context;
    const pnl =
      ctx.currentPrice && ctx.costPrice && ctx.amount
        ? ((ctx.currentPrice - ctx.costPrice) * ctx.amount).toFixed(2)
        : "未知";
    systemPrompt += `\n\n当前分析标的：${ctx.code}
当前价格：${ctx.currentPrice ?? "未知"}
持仓成本：${ctx.costPrice ?? "未持仓"}
持仓数量：${ctx.amount ?? 0}
浮动盈亏：${pnl}
选用策略：${ctx.strategy ?? "未选择"}${ctx.strategyDescription ? `\n策略内容：${ctx.strategyDescription}` : ""}`;
  }

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      try {
        const completion = await client.chat.completions.create({
          model: modelId,
          messages: [{ role: "system", content: systemPrompt }, ...body.messages],
          stream: true,
          max_tokens: 1000,
        });

        for await (const chunk of completion) {
          const text = chunk.choices[0]?.delta?.content ?? "";
          if (text) {
            controller.enqueue(enc.encode(`data: ${JSON.stringify({ text })}\n\n`));
          }
        }
        controller.enqueue(enc.encode("data: [DONE]\n\n"));
      } catch (err) {
        const msg = err instanceof Error ? err.message : "AI 请求失败";
        controller.enqueue(enc.encode(`data: ${JSON.stringify({ error: msg })}\n\n`));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

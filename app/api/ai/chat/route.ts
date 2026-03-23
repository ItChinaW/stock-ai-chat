import { INVESTMENT_SYSTEM_PROMPT } from "@/lib/ai/system-prompt";
import { NextRequest } from "next/server";
import OpenAI from "openai";

const MODEL_MAP: Record<string, string> = {
  "gpt-4o": "gpt-4o",
  "gpt-4o-mini": "gpt-4o-mini",
  "deepseek-chat": "deepseek-chat",
  "qwen-plus": "qwen-plus",
  "glm-4-flash": "glm-4-flash",
  "minimax-text-01": "minimax-text-01",
  "abab6.5s-chat": "abab6.5s-chat",
};

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const body = (await request.json()) as {
    messages: { role: "user" | "assistant"; content: string }[];
    model?: string;
    systemOverride?: string;
    context?: {
      code: string;
      currentPrice?: number;
      costPrice?: number;
      amount?: number;
      strategy?: string;
      strategyDescription?: string;
      backtestContext?: string;
    };
  };

  const modelKey = body.model ?? "deepseek-chat";
  const modelId = MODEL_MAP[modelKey] ?? "deepseek-chat";
  const isDeepSeek = modelKey.startsWith("deepseek");
  const isQwen = modelKey.startsWith("qwen");
  const isZhipu = modelKey.startsWith("glm");
  const isMiniMax = modelKey.startsWith("minimax") || modelKey.startsWith("abab");

  const client = new OpenAI({
    apiKey: isDeepSeek
      ? (process.env.DEEPSEEK_API_KEY ?? "")
      : isQwen
        ? (process.env.DASHSCOPE_API_KEY ?? "")
        : isZhipu
          ? (process.env.ZHIPU_API_KEY ?? "")
          : isMiniMax
            ? (process.env.MINIMAX_API_KEY ?? "")
            : (process.env.OPENAI_API_KEY ?? ""),
    baseURL: isDeepSeek
      ? "https://api.deepseek.com"
      : isQwen
        ? "https://dashscope.aliyuncs.com/compatible-mode/v1"
        : isZhipu
          ? "https://open.bigmodel.cn/api/paas/v4"
          : isMiniMax
            ? "https://api.minimax.chat/v1"
            : undefined,
  });

  let systemPrompt = body.systemOverride ?? INVESTMENT_SYSTEM_PROMPT;
  if (!body.systemOverride && body.context) {
    const ctx = body.context;

    // 用户投资背景优先放在最前面，让 AI 重点结合
    if (ctx.backtestContext) {
      // backtestContext 可能包含回测数据，也可能只是用户背景
      systemPrompt += `\n\n---\n${ctx.backtestContext}`;
    } else {
      // 普通持仓分析模式
      const pnl =
        ctx.currentPrice && ctx.costPrice && ctx.amount
          ? ((ctx.currentPrice - ctx.costPrice) * ctx.amount).toFixed(2)
          : "未知";
      const parts = [
        `当前分析标的：${ctx.code}`,
        `当前价格：${ctx.currentPrice ?? "未知"}`,
        ctx.costPrice ? `持仓成本：${ctx.costPrice}，数量：${ctx.amount ?? 0}，浮动盈亏：¥${pnl}` : null,
        ctx.strategy ? `选用策略：${ctx.strategy}` : null,
        ctx.strategyDescription ? `策略内容：${ctx.strategyDescription}` : null,
      ].filter(Boolean);
      systemPrompt += `\n\n---\n${parts.join("\n")}`;
    }
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

// 前端通用 AI 对话客户端：可选模型 + 流式发送逻辑。
// 供 main-layout（持仓/新闻 AI 弹窗）与 event-ai-modal（大事 AI 弹窗）共用。

export const MODELS = [
  { id: "deepseek-chat", label: "DeepSeek" },
  { id: "qwen-plus", label: "通义千问" },
  { id: "glm-4-flash", label: "GLM-4 Flash" },
];

export async function streamChat(
  messages: { role: "user" | "assistant"; content: string }[],
  model: string,
  systemOverride: string,
  signal: AbortSignal,
  onChunk: (text: string) => void
) {
  const res = await fetch("/api/ai/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({ messages: messages.slice(-10), model, systemOverride }),
  });
  if (!res.ok || !res.body) throw new Error("请求失败");
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const payload = line.slice(6).trim();
      if (payload === "[DONE]") break;
      try {
        const p = JSON.parse(payload) as { text?: string };
        if (p.text) onChunk(p.text);
      } catch {
        /* ignore */
      }
    }
  }
}

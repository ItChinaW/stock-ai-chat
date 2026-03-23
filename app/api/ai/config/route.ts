import { NextResponse } from "next/server";

/**
 * 返回当前实例启用的 AI 功能配置。
 * 前端根据此接口动态显示/隐藏 AI 相关功能。
 */
export async function GET() {
  const models: { id: string; label: string }[] = [];

  if (process.env.DEEPSEEK_API_KEY) models.push({ id: "deepseek-chat", label: "DeepSeek" });
  if (process.env.DASHSCOPE_API_KEY) models.push({ id: "qwen-plus", label: "通义千问" });
  if (process.env.ZHIPU_API_KEY) models.push({ id: "glm-4-flash", label: "智谱 GLM" });
  if (process.env.OPENAI_API_KEY) {
    models.push({ id: "gpt-4o-mini", label: "GPT-4o mini" });
    models.push({ id: "gpt-4o", label: "GPT-4o" });
  }

  // 视觉识别（持仓截图导入）：需要至少一个支持视觉的 key
  const visionProvider = process.env.VISION_PROVIDER ?? (process.env.ZHIPU_API_KEY ? "zhipu" : null);
  const visionEnabled =
    (visionProvider === "zhipu" && !!process.env.ZHIPU_API_KEY) ||
    (visionProvider === "qwen" && !!process.env.DASHSCOPE_API_KEY) ||
    (visionProvider === "openai" && !!process.env.OPENAI_API_KEY);

  return NextResponse.json({
    aiEnabled: models.length > 0,
    models,
    visionEnabled,
  });
}

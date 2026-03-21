/**
 * 视觉识别：从持仓截图中提取股票信息
 * 支持多个 provider，通过 VISION_PROVIDER 环境变量切换
 * 可选值：zhipu（默认，免费）| qwen | openai
 */

export type RecognizedPosition = {
  name: string;
  code: string;
  costPrice: number;
  amount: number;
};

const PROMPT = `这是一张股票持仓截图。请提取所有持仓股票的信息，以 JSON 数组返回，格式如下：
[{"name":"股票名称","code":"股票代码（6位数字，如果图中没有代码则留空字符串）","costPrice":成本价数字,"amount":持仓数量数字}]
注意：
- 只返回 JSON 数组，不要任何其他文字
- 成本价取"成本"或"成本价"列，数量取"持仓"或"可用"中较大的那个
- 如果某字段无法识别，costPrice 填 0，amount 填 0`;

function parsePositions(text: string): RecognizedPosition[] {
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) throw new Error("未找到持仓数据");
  return JSON.parse(match[0]) as RecognizedPosition[];
}

// 智谱 glm-4v-flash（免费）
async function recognizeWithZhipu(image: string, mimeType: string): Promise<string> {
  const res = await fetch("https://open.bigmodel.cn/api/paas/v4/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.ZHIPU_API_KEY ?? ""}`,
    },
    body: JSON.stringify({
      model: "glm-4v-flash",
      messages: [{
        role: "user",
        content: [
          { type: "image_url", image_url: { url: `data:${mimeType};base64,${image}` } },
          { type: "text", text: PROMPT },
        ],
      }],
    }),
  });
  const data = (await res.json()) as { choices?: { message: { content: string } }[]; error?: { message: string } };
  if (data.error) throw new Error(data.error.message);
  return data.choices?.[0]?.message?.content ?? "";
}

// 通义千问 qwen-vl-plus-latest
async function recognizeWithQwen(image: string, mimeType: string): Promise<string> {
  const res = await fetch("https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.DASHSCOPE_API_KEY ?? ""}`,
    },
    body: JSON.stringify({
      model: "qwen-vl-plus-latest",
      messages: [{
        role: "user",
        content: [
          { type: "image_url", image_url: { url: `data:${mimeType};base64,${image}` } },
          { type: "text", text: PROMPT },
        ],
      }],
    }),
  });
  const data = (await res.json()) as { choices?: { message: { content: string } }[]; error?: { message: string } };
  if (data.error) throw new Error(JSON.stringify(data.error));
  return data.choices?.[0]?.message?.content ?? "";
}

// OpenAI gpt-4o-mini
async function recognizeWithOpenAI(image: string, mimeType: string): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY ?? ""}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{
        role: "user",
        content: [
          { type: "image_url", image_url: { url: `data:${mimeType};base64,${image}` } },
          { type: "text", text: PROMPT },
        ],
      }],
      max_tokens: 1000,
    }),
  });
  const data = (await res.json()) as { choices?: { message: { content: string } }[]; error?: { message: string } };
  if (data.error) throw new Error(data.error.message);
  return data.choices?.[0]?.message?.content ?? "";
}

export async function recognizePositionsFromImage(
  image: string,
  mimeType = "image/jpeg",
): Promise<RecognizedPosition[]> {
  const provider = process.env.VISION_PROVIDER ?? "zhipu";
  let text: string;
  if (provider === "qwen") {
    text = await recognizeWithQwen(image, mimeType);
  } else if (provider === "openai") {
    text = await recognizeWithOpenAI(image, mimeType);
  } else {
    text = await recognizeWithZhipu(image, mimeType);
  }

  return parsePositions(text);
}

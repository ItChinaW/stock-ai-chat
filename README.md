# Vibe Portfolio

一个面向个人投资者的量化投资工具，集持仓管理、策略回测、AI 分析、加密货币量化机器人于一体。

![Next.js](https://img.shields.io/badge/Next.js-16-black)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)
![Prisma](https://img.shields.io/badge/Prisma-MySQL-blue)
![License](https://img.shields.io/badge/license-MIT-orange)

## 功能

- **持仓管理** — 手动录入或截图导入（AI 视觉识别），实时行情、盈亏计算
- **自选列表** — 关注股票，一键跳转 AI 分析
- **策略回测** — 内置 20+ 种技术指标策略（均线、MACD、海龟、定投等），可视化权益曲线、买卖点标注
- **策略横向对比** — 同一标的一键跑所有策略，柱状图对比年化收益/回撤/夏普
- **模拟盘** — 基于历史信号的纸面交易跟踪
- **AI 投资顾问** — 结合持仓、策略、实时行情的多轮对话，支持 DeepSeek / 通义千问 / 智谱 / OpenAI
- **加密货币量化** — 对接币安 API，自动执行策略信号下单
- **全球指数行情** — 顶部滚动条实时显示纳斯达克、沪深、日经、韩综等

## 技术栈

- **框架**：Next.js 16 (App Router)
- **数据库**：MySQL + Prisma ORM
- **前端**：React 19 + TailwindCSS v4 + ECharts
- **AI**：OpenAI SDK（兼容 DeepSeek / 通义千问 / 智谱 / Gemini）
- **行情数据**：新浪财经、东方财富（免费，无需 API Key）

## 快速开始

### 1. 克隆项目

```bash
git clone https://github.com/ItChinaW/stock-ai-chat.git
cd stock-ai-chat
npm install
```

### 2. 配置环境变量

```bash
cp .env.example .env
```

编辑 `.env`，填写 `DATABASE_URL` 和至少一个 AI Key。AI 功能按需配置，不配置则自动隐藏。

```env
DATABASE_URL="mysql://user:password@localhost:3306/vibe_portfolio"

# AI 大模型（至少配置一个）
DEEPSEEK_API_KEY="sk-..."       # 推荐，性价比高
ZHIPU_API_KEY="..."             # 免费视觉识别
```

### 3. 初始化数据库

```bash
npx prisma migrate deploy
npx prisma generate
```

### 4. 启动开发服务器

```bash
npm run dev
```

访问 [http://localhost:3004](http://localhost:3004)

## 环境变量说明

| 变量 | 必填 | 说明 |
|------|------|------|
| `DATABASE_URL` | ✅ | MySQL 连接串，如 `mysql://user:password@localhost:3306/vibe_portfolio` |
| `DEEPSEEK_API_KEY` | — | DeepSeek 对话模型，[获取](https://platform.deepseek.com) |
| `OPENAI_API_KEY` | — | OpenAI GPT-4o，[获取](https://platform.openai.com) |
| `GEMINI_API_KEY` | — | Google Gemini，[获取](https://aistudio.google.com) |
| `DASHSCOPE_API_KEY` | — | 通义千问，[获取](https://dashscope.aliyun.com) |
| `ZHIPU_API_KEY` | — | 智谱 GLM，[获取](https://open.bigmodel.cn)，glm-4v-flash 免费 |
| `MINIMAX_API_KEY` | — | MiniMax，[获取](https://platform.minimaxi.com) |
| `VISION_PROVIDER` | — | 持仓截图识别引擎：`zhipu`（默认）\| `qwen` \| `openai` |
| `BIAN_API_KEY` | — | 币安 API Key，加密量化机器人使用 |
| `BIAN_API_SECRET` | — | 币安 API Secret |
| `CRON_SECRET` | — | 定时任务鉴权密钥 |

> AI 相关功能（AI 分析按钮、持仓截图导入）会根据已配置的 Key 自动显示/隐藏，无需额外配置开关。

## AI 功能说明

### 支持的模型

| 模型 | 提供商 | 所需 Key |
|------|--------|----------|
| DeepSeek Chat | DeepSeek | `DEEPSEEK_API_KEY` |
| 通义千问 Plus | 阿里云 | `DASHSCOPE_API_KEY` |
| GLM-4 Flash | 智谱 | `ZHIPU_API_KEY` |
| Gemini | Google | `GEMINI_API_KEY` |
| MiniMax Text / ABAB | MiniMax | `MINIMAX_API_KEY` |
| GPT-4o / GPT-4o mini | OpenAI | `OPENAI_API_KEY` |

### 持仓截图导入

上传同花顺、东方财富等 App 的持仓截图，AI 自动识别股票名称、代码、成本价、持仓数量。

- 默认使用智谱 `glm-4v-flash`（免费）
- 通过 `VISION_PROVIDER` 切换为通义千问或 OpenAI

## 回测策略列表

| 类型 | 策略 |
|------|------|
| 均线系 | 双均线、EMA 交叉、三均线、均线突破 |
| 震荡指标 | MACD、KDJ、RSI、CCI、BIAS 乖离率 |
| 组合策略 | MACD-KDJ、BOLL-RSI |
| 趋势跟踪 | SAR 抛物线、DMI、动量、ROC、TRIX |
| 波动率 | 布林带、ATR 突破、波动率突破 |
| 经典系统 | 海龟交易（含头寸管理、分批加仓） |
| 定投系 | 定期定额、价值平均、智能动态定投 |

## 部署

### Docker（推荐）

```bash
docker compose up -d
```

访问 [http://localhost:3000](http://localhost:3000)，MySQL 数据持久化在 `mysql_data` volume，应用启动时自动执行迁移。

### 自托管（VPS）

确保已有 MySQL 实例，配置好 `.env` 后：

```bash
npx prisma migrate deploy
npm run build
npm start
```

### Vercel

配合 PlanetScale 或其他 MySQL 兼容服务，将 `DATABASE_URL` 填入 Vercel 环境变量即可。

## 免责声明

本项目仅供学习和研究使用，不构成任何投资建议。股市有风险，投资需谨慎。

## License

MIT

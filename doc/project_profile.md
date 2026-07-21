# 📈 Stock-AI-Chat (Vibe Portfolio 投资看板) 项目说明文档

## 1. 项目概述
`stock-ai-chat` (原名 Vibe Portfolio) 是一个面向个人投资者的智能量化投资看板及策略回测平台。平台集成了股票与加密货币的持仓管理、20 余种主流技术指标的策略回测、对比分析、模拟纸面交易，并融合了多款大语言模型（DeepSeek、通义千问、智谱、Gemini、OpenAI）提供专业的 AI 投资顾问对话服务。此外，它还支持通过币安 (Binance) API 进行加密货币量化自动下单交易。

---

## 2. 核心技术栈
- **开发语言/框架**：TypeScript + Next.js 16 (App Router, React 19)
- **数据库/ORM**：MySQL 8.0 + Prisma ORM
- **样式方案**：TailwindCSS v4
- **图表展示**：ECharts (用于可视化展示行情曲线、回测权益曲线及买卖点)
- **核心功能库**：
  - OpenAI SDK (兼容多家大模型接口)
  - 自动行情对接：通过新浪财经、东方财富等免费接口实时获取股票及全球指数行情 (无需额外 API Key)

---

## 3. 功能特性
1. **智能持仓管理**：支持手动录入或通过上传截图，由 AI 视觉识别自动解析并导入持仓资产，实时核算账户盈亏与配比。
2. **自选股与快速 AI 分析**：自选标的一键呼叫 AI 投顾，结合最新行情、个股基本面与新闻进行投资分析。
3. **强大的回测引擎**：内置均线交叉、MACD、海龟交易、网格交易、定投等 20 多种策略，支持历史买卖点图表标注及多策略收益率、夏普比率、最大回撤的横向对比。
4. **加密货币自动交易**：支持配置币安 API，当策略生成交易信号时，执行全自动下单与仓位管理。
5. **AI 财经助理的多模型支持**：支持 DeepSeek 满血版、通义千问、智谱等低成本高性能 API，支持多轮财经深度对话。

---

## 4. 部署与环境配置 (树莓派环境建议)
- **部署方式**：Docker Compose 容器化部署 (包含 Node Web 应用与独立的 MySQL 数据库容器)。
- **端口映射**：
  - **当前配置**：宿主机端口 `3000` -> 容器内端口 `3000`。
  - > ⚠️ **特别提示**：根据树莓派的全局开发规范，为避免与常规 Web 端口冲突，建议在树莓派生产部署时，将宿主机映射端口修改为非常规端口（例如 `43000:3000`）。
- **挂载卷**：
  - `mysql_data`：持久化 MySQL 数据库的数据。
- **关联环境变量**：
  - `DATABASE_URL`：MySQL 连接串。
  - 各大模型的 API 密钥（`DEEPSEEK_API_KEY`、`OPENAI_API_KEY`、`ZHIPU_API_KEY` 等）。
  - `CRON_SECRET`：用于保护系统定时回测及信号更新端点的密钥。

---

## 5. 项目代码目录结构
```text
stock-ai-chat/
├── doc/
│   └── project_profile.md      # [NEW] 本说明文档
├── app/                        # Next.js App Router 页面及 API 路由
│   ├── api/                    # 行情、回测、AI 对话接口
│   ├── portfolio/              # 持仓管理页面
│   ├── backtest/               # 策略回测页面
│   └── page.tsx                # 平台首页 (滚动全球指数行情)
├── components/                 # React UI 公共组件
├── lib/                        # 量化回测策略、数据接口、API 客户端封装
├── prisma/                     # 数据库 Schema 定义及迁移脚本
│   └── schema.prisma           # 数据库结构 (用户、持仓、自选股、交易日志)
├── public/                     # 静态资源文件
├── docker-compose.yml          # Docker Compose 编排文件 (Web + MySQL)
├── Dockerfile                  # Next.js 生产环境构建 Dockerfile
└── next.config.ts              # Next.js 框架配置
```

---

## 6. 微服务生态与项目联动
`stock-ai-chat` 作为独立的 Web 应用运行，在数据和系统层与其他项目的交互如下：

1. **数据库联动**：
   - 使用独立的 MySQL 服务，与 `finance-collector` 使用的 PostgreSQL 数据库进行隔离。
2. **AI 服务对接**：
   - 依赖外部大语言模型接口，可以与树莓派上部署的 Clash（科学上网代理，宿主机映射端口 `48904` 对应的客户端）进行网络联动以确保 OpenAI 等 API 访问顺畅。

---
*本文档归档于 `stock-ai-chat/doc/` 下，用以记录和维护系统架构。*

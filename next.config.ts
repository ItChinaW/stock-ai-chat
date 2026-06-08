import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Next.js 15+ instrumentation 已默认启用，无需 experimental.instrumentationHook
  // serverless 版无头浏览器（夜盘抓取）：保持外部依赖，避免被打包破坏二进制路径
  serverExternalPackages: ["@sparticuz/chromium", "playwright-core", "playwright"],
};

export default nextConfig;

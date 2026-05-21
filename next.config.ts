import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Next.js 15+ instrumentation 已默认启用，无需 experimental.instrumentationHook
};

export default nextConfig;

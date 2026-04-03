export async function register() {
  // 只在 Node.js 服务端运行（排除 Edge runtime）
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startScheduler } = await import("./lib/scheduler");
    startScheduler();
  }
}

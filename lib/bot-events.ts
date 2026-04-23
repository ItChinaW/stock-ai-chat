/**
 * 机器人事件总线 - 连接 scheduler 和 SSE 端点
 * 使用全局单例，避免 Next.js 热重载时重复创建
 */

export type BotEvent = {
  botId: number;
  symbol: string;
  action: "buy-long" | "sell-short" | "close-long" | "close-short" | "buy" | "sell" | "hold" | "error";
  price: number;
  pnl?: number;
  pnlPct?: number;
  leverage?: number;
  positionSide?: string;
  reason?: string;
  ts: number; // timestamp ms
};

type Listener = (event: BotEvent) => void;

const g = globalThis as unknown as { botEventBus?: BotEventBus };

class BotEventBus {
  private listeners = new Set<Listener>();

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(event: BotEvent) {
    for (const fn of this.listeners) {
      try { fn(event); } catch { /* ignore dead connections */ }
    }
  }
}

if (!g.botEventBus) g.botEventBus = new BotEventBus();
export const botEventBus = g.botEventBus;

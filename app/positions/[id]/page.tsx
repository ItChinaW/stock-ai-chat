import { fetchYahooQuotes } from "@/lib/market";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { notFound } from "next/navigation";

type Params = Promise<{ id: string }>;

function parseId(id: string) {
  const parsed = Number(id);
  return Number.isFinite(parsed) ? parsed : null;
}

export default async function PositionDetailPage({ params }: { params: Params }) {
  const { id } = await params;
  const positionId = parseId(id);
  if (!positionId) notFound();

  const position = await prisma.position.findUnique({
    where: { id: positionId },
  });
  if (!position) notFound();

  const quote = (await fetchYahooQuotes([position.code]))[0];
  const currentPrice = quote?.price ?? position.costPrice;
  const previousClose = quote?.previousClose ?? currentPrice;
  const totalPnl = (currentPrice - position.costPrice) * position.amount;
  const dayPnl = (currentPrice - previousClose) * position.amount;

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 py-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-zinc-900">{position.code} 持仓详情</h1>
        <Link href="/" className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100">
          返回首页
        </Link>
      </div>

      <section className="grid gap-4 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm md:grid-cols-2">
        <div>
          <p className="text-sm text-zinc-500">代码</p>
          <p className="mt-1 text-lg font-medium text-zinc-900">{position.code}</p>
        </div>
        <div>
          <p className="text-sm text-zinc-500">成本价</p>
          <p className="mt-1 text-lg font-medium text-zinc-900">{position.costPrice.toFixed(2)}</p>
        </div>
        <div>
          <p className="text-sm text-zinc-500">持仓数量</p>
          <p className="mt-1 text-lg font-medium text-zinc-900">{position.amount}</p>
        </div>
        <div>
          <p className="text-sm text-zinc-500">当前价</p>
          <p className="mt-1 text-lg font-medium text-zinc-900">{currentPrice.toFixed(2)}</p>
        </div>
        <div>
          <p className="text-sm text-zinc-500">浮动盈亏</p>
          <p className={`mt-1 text-lg font-semibold ${totalPnl >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
            {totalPnl >= 0 ? "+" : ""}
            {totalPnl.toFixed(2)}
          </p>
        </div>
        <div>
          <p className="text-sm text-zinc-500">当日盈亏</p>
          <p className={`mt-1 text-lg font-semibold ${dayPnl >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
            {dayPnl >= 0 ? "+" : ""}
            {dayPnl.toFixed(2)}
          </p>
        </div>
      </section>
    </main>
  );
}

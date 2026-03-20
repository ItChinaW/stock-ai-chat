import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const strategies = [
    { name: "红利低波策略", description: "筛选高股息、低波动率的标的，长期持有获取稳定分红收益，适合保守型投资者。" },
    { name: "均值回归策略", description: "当价格偏离历史均值较大时买入/卖出，押注价格向均值回归，适合震荡市场。" },
    { name: "风险平价策略", description: "按风险贡献均等分配仓位，而非按资金均等，降低组合整体波动率。" },
    { name: "移动止损策略", description: "设置动态止损线（如最高点回撤 3%），自动触发减仓，严格控制下行风险。" },
  ];

  for (const s of strategies) {
    await prisma.strategy.upsert({
      where: { id: strategies.indexOf(s) + 1 },
      update: {},
      create: s,
    });
  }
  console.log("Seeded strategies.");
}

main().catch(console.error).finally(() => prisma.$disconnect());

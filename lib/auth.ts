import { prisma } from "./prisma";

/**
 * 获取当前用户 ID。
 *
 * 现阶段单用户模式：始终返回 id=1 的默认用户（不存在则自动创建）。
 * 接入 Auth（如 NextAuth / Clerk）后，将此函数替换为从 session 读取：
 *
 *   import { auth } from "@/auth";
 *   const session = await auth();
 *   return session?.user?.id ?? null;
 */
export async function getCurrentUserId(): Promise<number> {
  const user = await prisma.user.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1, name: "default" },
  });
  return user.id;
}

/**
 * 测试邮件：用当前持仓信息构造一封"模拟止损触发"的邮件，立即发送。
 * 仅用于调试 SMTP / 邮件模板。
 */
import { getCurrentUserId } from "@/lib/auth";
import { sendMail } from "@/lib/mailer";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

function parseId(id: string) {
  const parsed = Number(id);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function POST(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const positionId = parseId(id);
  if (!positionId) return NextResponse.json({ message: "Invalid id" }, { status: 400 });

  const userId = await getCurrentUserId();
  const pos = await prisma.position.findFirst({ where: { id: positionId, userId } });
  if (!pos) return NextResponse.json({ message: "Not found" }, { status: 404 });

  const fakeStop = pos.costPrice * 0.95;
  const fakeCurrent = pos.costPrice * 0.94;

  try {
    await sendMail({
      subject: `🧪 [测试] 海龟策略止损预警 - ${pos.code}`,
      html: `
        <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
          <h2 style="color:#ef4444;margin-bottom:8px">🧪 测试邮件 · 海龟策略止损预警</h2>
          <p style="color:#666;margin-bottom:16px">这是一封测试邮件，用于验证 SMTP 配置与邮件模板。下列价格为模拟数据。</p>
          <table style="width:100%;border-collapse:collapse;font-size:14px">
            <thead>
              <tr style="background:#f9fafb;color:#6b7280;font-size:12px">
                <th style="padding:8px 12px;text-align:left">名称</th>
                <th style="padding:8px 12px;text-align:left">代码</th>
                <th style="padding:8px 12px;text-align:left">成本价</th>
                <th style="padding:8px 12px;text-align:left">当前价</th>
                <th style="padding:8px 12px;text-align:left">止损价</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0">${pos.name || pos.code}</td>
                <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0">${pos.code}</td>
                <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0">${pos.costPrice.toFixed(3)}</td>
                <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;color:#ef4444;font-weight:600">${fakeCurrent.toFixed(3)}</td>
                <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;color:#ef4444">${fakeStop.toFixed(3)}</td>
              </tr>
            </tbody>
          </table>
          <p style="color:#9ca3af;font-size:12px;margin-top:16px">
            发送时间：${new Date().toLocaleString("zh-CN")} · 测试入口：持仓表 Test 按钮
          </p>
        </div>`,
    });
    return NextResponse.json({ ok: true, to: process.env.MAIL_TO });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "send failed" }, { status: 500 });
  }
}

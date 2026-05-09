/**
 * 邮件发送工具 - QQ邮箱 SMTP
 */
import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  host: "smtp.qq.com",
  port: 465,
  secure: true,
  auth: {
    user: process.env.MAIL_USER ?? "",
    pass: process.env.MAIL_PWD ?? "",
  },
});

export interface MailOptions {
  to?: string;
  subject: string;
  html: string;
}

export async function sendMail(opts: MailOptions) {
  const to = opts.to ?? process.env.MAIL_TO ?? "";
  if (!to || !process.env.MAIL_USER || !process.env.MAIL_PWD) {
    console.warn("[mailer] 邮件配置不完整，跳过发送");
    return;
  }
  await transporter.sendMail({
    from: `"持仓预警" <${process.env.MAIL_USER}>`,
    to,
    subject: opts.subject,
    html: opts.html,
  });
  console.log(`[mailer] 邮件已发送至 ${to}: ${opts.subject}`);
}

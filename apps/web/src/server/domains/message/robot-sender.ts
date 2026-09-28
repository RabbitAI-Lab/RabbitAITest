/** MSG-001 机器人投递：三平台 webhook payload 映射 + 出站守卫 + SMTP 邮件（尽力投递）。 */
import { DomainError, ErrCode } from "@rabbit/shared";
import type { RobotChannel } from "@rabbit/shared";
import { assertSafeOutboundUrl } from "@/server/domains/api/outbound-guard";

/** 出站守卫包装：拦截语义映射为机器人错误码（20442）。 */
export async function assertRobotWebhookSafe(url: string): Promise<void> {
  try {
    await assertSafeOutboundUrl(url);
  } catch (err) {
    if (err instanceof DomainError) {
      throw new DomainError(
        ErrCode.ROBOT_WEBHOOK_BLOCKED,
        err.code === ErrCode.SWAGGER_SYNC_URL_BLOCKED
          ? "Webhook 指向内网/环回/元数据地址，已被安全策略拒绝"
          : err.message,
      );
    }
    throw err;
  }
}

/** 平台消息体（基线机器人口径：文本消息；钉钉/企微 {msgtype,text}，飞书 {msg_type,content}）。 */
export function buildRobotPayload(channel: RobotChannel, title: string, content: string): unknown {
  const text = `${title}\n${content}`;
  switch (channel) {
    case "dingtalk":
    case "wecom":
      return { msgtype: "text", text: { content: text } };
    case "feishu":
      return { msg_type: "text", content: { text } };
    default:
      return { title, content };
  }
}

export interface RobotSendResult {
  delivered: boolean;
  detail: string;
}

/** POST webhook（3s 超时；守卫实时复检——rules/security DNS rebinding 口径）。 */
export async function sendRobotWebhook(
  channel: RobotChannel,
  webhook: string,
  title: string,
  content: string,
): Promise<RobotSendResult> {
  await assertRobotWebhookSafe(webhook);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const res = await fetch(webhook, {
      method: "POST",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildRobotPayload(channel, title, content)),
      signal: controller.signal,
    });
    if (!res.ok) {
      return { delivered: false, detail: `上游响应 ${res.status}` };
    }
    return { delivered: true, detail: `HTTP ${res.status}` };
  } catch (err) {
    return { delivered: false, detail: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

/** SMTP 邮件投递（SYS-005 配置；未配置→跳过；失败仅日志，不留错误面）。 */
export async function sendEmailBestEffort(
  to: { email: string; name: string }[],
  title: string,
  content: string,
): Promise<void> {
  if (to.length === 0) return;
  try {
    const { prisma } = await import("@rabbit/db");
    const { readParam, decryptSecret } = await import("@/server/domains/system/param.service");
    const smtp = (await readParam("smtp")) as unknown as {
      host: string;
      port: number;
      user: string;
      pass: string;
      ssl: boolean;
      from: string;
    };
    if (!smtp.host) return; // 未配置 SMTP：静默跳递（MSG-001 §2）
    const pass = decryptSecret(String(smtp.pass ?? "")) ?? String(smtp.pass ?? "");
    const { createTransport } = await import("nodemailer");
    const transport = createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.ssl,
      auth: smtp.user ? { user: smtp.user, pass } : undefined,
      connectionTimeout: 8000,
    });
    try {
      await transport.sendMail({
        from: smtp.from || smtp.user || "rabbitaitest@localhost",
        to: to.map((u) => `${u.name}<${u.email}>`).join(","),
        subject: title,
        text: content,
      });
    } finally {
      transport.close();
    }
  } catch (err) {
    console.warn("[notify] email delivery failed:", err instanceof Error ? err.message : err);
  }
}

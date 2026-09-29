/** MSG-001 机器人 CRUD + 事件配置 + 测试发送（渠道 5 种；上限 10/项目）。 */
import { DomainError, ErrCode } from "@rabbit/shared";
import {
  WEBHOOK_ROBOT_CHANNELS,
  type MessageEventsConfig,
  type RobotChannel,
  type RobotUpsert,
} from "@rabbit/shared";
import { prisma } from "@rabbit/db";
import { assertRobotWebhookSafe, sendRobotWebhook } from "./robot-sender";
import { readEventsConfig, writeEventsConfig } from "./notify.service";

export const ROBOT_LIMIT = 10;

function validateWebhook(input: RobotUpsert): string | null {
  if (WEBHOOK_ROBOT_CHANNELS.includes(input.channel)) {
    if (!input.webhook) {
      throw new DomainError(
        ErrCode.ROBOT_WEBHOOK_INVALID,
        "机器人渠道（企微/钉钉/飞书）必须填写 Webhook",
      );
    }
    let url: URL;
    try {
      url = new URL(input.webhook);
    } catch {
      throw new DomainError(ErrCode.ROBOT_WEBHOOK_INVALID, "Webhook 不是合法 URL");
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new DomainError(ErrCode.ROBOT_WEBHOOK_INVALID, "Webhook 仅允许 http(s)");
    }
    return input.webhook;
  }
  return null; // inapp/email 渠道无需 webhook
}

function serialize(r: {
  id: string;
  name: string;
  channel: string;
  webhook: string | null;
  enabled: boolean;
  createdAt: Date;
}) {
  return {
    id: r.id,
    name: r.name,
    channel: r.channel,
    webhook: r.webhook,
    enabled: r.enabled,
    createdAt: r.createdAt.toISOString(),
  };
}

export async function listRobots(projectId: string) {
  const rows = await prisma.robot.findMany({
    where: { projectId },
    orderBy: { createdAt: "asc" },
  });
  return { total: rows.length, items: rows.map(serialize) };
}

export async function createRobot(projectId: string, input: RobotUpsert) {
  const count = await prisma.robot.count({ where: { projectId } });
  if (count >= ROBOT_LIMIT) {
    throw new DomainError(
      ErrCode.ROBOT_LIMIT_EXCEEDED,
      `机器人数量超出上限（${ROBOT_LIMIT}/项目）`,
    );
  }
  const webhook = validateWebhook(input);
  if (webhook) await assertRobotWebhookSafe(webhook); // 保存期即校验（发送期复检）
  const r = await prisma.robot.create({
    data: { projectId, name: input.name, channel: input.channel, webhook, enabled: input.enabled },
  });
  return serialize(r);
}

export async function getRobot(projectId: string, id: string) {
  const r = await prisma.robot.findFirst({ where: { id, projectId } });
  if (!r) throw new DomainError(ErrCode.ROBOT_NOT_FOUND, "机器人不存在");
  return r;
}

export async function updateRobot(projectId: string, id: string, input: RobotUpsert) {
  await getRobot(projectId, id);
  const webhook = validateWebhook(input);
  if (webhook) await assertRobotWebhookSafe(webhook);
  const r = await prisma.robot.update({
    where: { id },
    data: { name: input.name, channel: input.channel, webhook, enabled: input.enabled },
  });
  return serialize(r);
}

/** 删除机器人：同步从事件配置 robotIds 中摘除引用（MSG-001 §2 级联）。 */
export async function deleteRobot(projectId: string, id: string) {
  await getRobot(projectId, id);
  await prisma.$transaction(async (tx) => {
    await tx.robot.delete({ where: { id } });
    const cfg = await readEventsConfig(projectId);
    let changed = false;
    for (const key of Object.keys(cfg) as (keyof MessageEventsConfig)[]) {
      const ev = cfg[key];
      if (ev?.robotIds?.includes(id)) {
        cfg[key] = { ...ev, robotIds: ev.robotIds.filter((r) => r !== id) };
        changed = true;
      }
    }
    if (changed) {
      await tx.appSetting.update({
        where: { projectId_key: { projectId, key: "message.events" } },
        data: { value: JSON.parse(JSON.stringify(cfg)) },
      });
    }
  });
  return { id };
}

/** 测试发送：inapp→给自己落一条；email→SMTP 投操作人；三方→实时 POST。 */
export async function testRobot(
  projectId: string,
  id: string,
  actor: { userId: string; email?: string },
) {
  const r = await getRobot(projectId, id);
  const title = "[RabbitAITest] 机器人测试消息";
  const content = `这是一条测试消息（机器人：${r.name}，渠道：${r.channel}）。收到即配置有效。`;
  if (r.channel === "inapp") {
    await prisma.notification.create({
      data: { userId: actor.userId, type: "ROBOT_TEST", title, content },
    });
    return { delivered: true, detail: "站内信已发送给操作人" };
  }
  if (r.channel === "email") {
    const { sendEmailBestEffort } = await import("./robot-sender");
    const user = await prisma.user.findFirst({
      where: { id: actor.userId },
      select: { email: true, name: true },
    });
    if (!user) return { delivered: false, detail: "操作人信息缺失" };
    await sendEmailBestEffort([user], title, content);
    return { delivered: true, detail: "已尝试经 SMTP 发送（未配置 SMTP 则跳过）" };
  }
  if (!r.webhook) throw new DomainError(ErrCode.ROBOT_WEBHOOK_INVALID, "机器人缺少 Webhook");
  const sent = await sendRobotWebhook(r.channel as RobotChannel, r.webhook, title, content);
  if (!sent.delivered) throw new DomainError(ErrCode.ROBOT_SEND_FAILED, `投递失败：${sent.detail}`);
  return { delivered: true, detail: sent.detail };
}

/** 事件配置 GET（补默认空值）→ PUT（robotIds 须为本项目存在机器人）。 */
export async function getEventsConfigView(projectId: string) {
  const cfg = await readEventsConfig(projectId);
  const robots = await prisma.robot.findMany({
    where: { projectId },
    select: { id: true, name: true, channel: true, enabled: true },
  });
  return { config: cfg, robots: robots.map((r) => ({ ...r })) };
}

export async function putEventsConfig(projectId: string, cfg: MessageEventsConfig) {
  const robotIds = new Set(
    (await prisma.robot.findMany({ where: { projectId }, select: { id: true } })).map((r) => r.id),
  );
  for (const [key, ev] of Object.entries(cfg)) {
    if (ev.robotIds.some((rid) => !robotIds.has(rid))) {
      throw new DomainError(ErrCode.MESSAGE_CONFIG_INVALID, `事件 ${key} 引用了不存在的机器人`);
    }
  }
  await writeEventsConfig(projectId, cfg);
  return { config: cfg };
}

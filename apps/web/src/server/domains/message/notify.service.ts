/** MSG-001 事件分发 + 个人站内信查询/已读（业务域只调 dispatch，不感知渠道细节）。 */
import { ErrCode, DomainError } from "@rabbit/shared";
import {
  type RobotChannel,
  MESSAGE_EVENT_KEYS,
  messageEventsConfigSchema,
  type MessageEventKey,
  type MessageEventsConfig,
} from "@rabbit/shared";
import type { Prisma } from "@rabbit/db";
import { prisma } from "@rabbit/db";

const CONFIG_KEY = "message.events";
const NOTIFY_WINDOW_DAYS = 90; // 基线：右上角近 3 个月

const toJson = (v: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(v ?? {})) as Prisma.InputJsonValue;

export interface DispatchInput {
  projectId: string;
  event: MessageEventKey;
  title: string;
  content: string;
  /** 操作人（同人去重：恒被剔除） */
  actorId: string;
  receivers?: {
    /** 事件配置的接收人 */
    userIds?: string[];
    /** @提及人（评论事件） */
    mentionIds?: string[];
    /** 关注者（变更类事件，仅站内信） */
    followerIds?: string[];
  };
}

export interface DispatchResult {
  skipped: boolean; // 事件未配置/未启用
  inappCount: number;
  robotCount: number;
}

/** 读事件配置（AppSetting；坏数据按空配置容错）。 */
export async function readEventsConfig(projectId: string): Promise<MessageEventsConfig> {
  const row = await prisma.appSetting.findUnique({
    where: { projectId_key: { projectId, key: CONFIG_KEY } },
  });
  const parsed = messageEventsConfigSchema.safeParse(row?.value ?? {});
  return parsed.success ? parsed.data : {};
}

export async function writeEventsConfig(projectId: string, cfg: MessageEventsConfig) {
  await prisma.appSetting.upsert({
    where: { projectId_key: { projectId, key: CONFIG_KEY } },
    update: { value: toJson(cfg) },
    create: { projectId, key: CONFIG_KEY, value: toJson(cfg) },
  });
}

/**
 * 事件分发（MSG-001 §2）：
 *  - 总闸（event.enabled）关 → 全不发（含提及/关注）
 *  - 接收人 = 配置接收人 ∪ 提及人 ∪（变更类）关注者 − 操作人，Set 去重
 *  - inapp 机器人 → notifications 落库（接收人）；email 机器人 → SMTP 尽力投递
 *  - 三方机器人 → webhook 一条（渠道广播，与接收人无关）
 *  - 全程不抛错（投递失败仅日志；业务写路径不因通知中断）
 */
export async function dispatch(input: DispatchInput): Promise<DispatchResult> {
  const result: DispatchResult = { skipped: false, inappCount: 0, robotCount: 0 };
  try {
    const cfg = await readEventsConfig(input.projectId);
    const ev = cfg[input.event];
    if (!ev?.enabled) {
      result.skipped = true;
      return result;
    }
    const receivers = new Set<string>([...(ev.receiverUserIds ?? []), ...(input.receivers?.mentionIds ?? []), ...(input.receivers?.followerIds ?? [])]);
    receivers.delete(input.actorId);

    const robots = ev.robotIds.length
      ? await prisma.robot.findMany({
          where: { id: { in: ev.robotIds }, projectId: input.projectId, enabled: true },
        })
      : [];

    // 站内信渠道：接收人落库（提及/关注者只走站内信——MSG-001 §2 口径）
    if (robots.some((r) => r.channel === "inapp") && receivers.size > 0) {
      await prisma.notification.createMany({
        data: [...receivers].map((userId) => ({
          userId,
          type: input.event,
          title: input.title.slice(0, 256),
          content: input.content.slice(0, 2048),
        })),
      });
      result.inappCount = receivers.size;
    }

    // 邮件渠道：尽力投递（不阻塞、失败仅日志）
    if (robots.some((r) => r.channel === "email") && receivers.size > 0) {
      const users = await prisma.user.findMany({
        where: { id: { in: [...receivers] }, deletedAt: null },
        select: { email: true, name: true },
      });
      const { sendEmailBestEffort } = await import("./robot-sender");
      await sendEmailBestEffort(users, input.title, input.content).catch(() => {});
    }

    // 三方机器人：各投一条（有界等待保证测试可断言；失败仅计日志）
    const { sendRobotWebhook } = await import("./robot-sender");
    for (const r of robots) {
      if (r.channel === "inapp" || r.channel === "email" || !r.webhook) continue;
      const sent = await sendRobotWebhook(r.channel as RobotChannel, r.webhook, input.title, input.content).catch(
        (err: unknown) => ({ delivered: false, detail: err instanceof Error ? err.message : String(err) }),
      );
      if (sent.delivered) result.robotCount += 1;
      else console.warn(`[notify] robot ${r.id} delivery failed:`, sent.detail);
    }
    return result;
  } catch (err) {
    console.warn("[notify] dispatch error:", err instanceof Error ? err.message : err);
    return result;
  }
}

function windowStart(): Date {
  return new Date(Date.now() - NOTIFY_WINDOW_DAYS * 24 * 3600 * 1000);
}

export async function listNotifications(
  userId: string,
  q: { page: number; pageSize: number; unread: boolean },
) {
  const where = {
    userId,
    createdAt: { gte: windowStart() },
    ...(q.unread ? { readAt: null } : {}),
  };
  const [total, items] = await Promise.all([
    prisma.notification.count({ where }),
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
  ]);
  return {
    total,
    items: items.map((n) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      content: n.content,
      readAt: n.readAt?.toISOString() ?? null,
      createdAt: n.createdAt.toISOString(),
    })),
  };
}

export async function unreadNotificationCount(userId: string) {
  return {
    count: await prisma.notification.count({
      where: { userId, readAt: null, createdAt: { gte: windowStart() } },
    }),
  };
}

export async function markNotificationRead(userId: string, id: string) {
  const r = await prisma.notification.updateMany({
    where: { id, userId, readAt: null },
    data: { readAt: new Date() },
  });
  if (r.count === 0) {
    // 已读幂等；不存在/越域 → 404
    const exists = await prisma.notification.findFirst({ where: { id, userId } });
    if (!exists) throw new DomainError(ErrCode.NOTIFICATION_NOT_FOUND, "通知不存在");
  }
  return { id };
}

export async function markAllNotificationsRead(userId: string) {
  const r = await prisma.notification.updateMany({
    where: { userId, readAt: null, createdAt: { gte: windowStart() } },
    data: { readAt: new Date() },
  });
  return { updated: r.count };
}

/** 校验事件 key（供配置写入与路由复用）。 */
export function assertEventKey(key: string): asserts key is MessageEventKey {
  if (!(MESSAGE_EVENT_KEYS as readonly string[]).includes(key)) {
    throw new DomainError(ErrCode.MESSAGE_CONFIG_INVALID, `未知事件 ${key}`);
  }
}

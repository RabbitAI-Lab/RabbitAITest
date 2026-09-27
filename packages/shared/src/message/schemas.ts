/** 消息域（S5 MSG-001）：通知机器人 / 事件配置 / 站内信契约。 */
import { z } from "zod";

/** 通知渠道（Robot.channel，S0 建表既定枚举）。 */
export const ROBOT_CHANNELS = ["inapp", "email", "wecom", "dingtalk", "feishu"] as const;
export type RobotChannel = (typeof ROBOT_CHANNELS)[number];

/** 三方机器人渠道（需 webhook） */
export const WEBHOOK_ROBOT_CHANNELS: readonly RobotChannel[] = ["wecom", "dingtalk", "feishu"];

/** 事件目录（五大类；key 即 notifications.type）。提及/关注为接收人扩展机制，不占事件开关。 */
export const MESSAGE_EVENTS = [
  // 缺陷管理
  { key: "BUG_CREATED", group: "缺陷管理", label: "缺陷创建" },
  { key: "BUG_UPDATED", group: "缺陷管理", label: "缺陷更新（含处理人转派）" },
  { key: "BUG_DELETED", group: "缺陷管理", label: "缺陷删除" },
  { key: "BUG_COMMENT", group: "缺陷管理", label: "缺陷评论（@提及人必收）" },
  { key: "BUG_TRANSITION", group: "缺陷管理", label: "缺陷流转（关注者必收站内信）" },
  // 用例评审
  { key: "REVIEW_COMMENT", group: "用例评审", label: "评审评论（@提及人必收）" },
  { key: "CASE_COMMENT", group: "用例评审", label: "用例评论（@提及人必收）" },
  // 测试计划
  { key: "PLAN_EXEC_COMPLETED", group: "测试计划", label: "计划执行完成" },
  // 接口测试
  { key: "SCENARIO_EXEC_COMPLETED", group: "接口测试", label: "场景执行完成（手动/定时）" },
  // 定时任务
  { key: "SCHEDULE_ENABLED", group: "定时任务", label: "定时任务启用" },
  { key: "SCHEDULE_DISABLED", group: "定时任务", label: "定时任务停用" },
] as const;

export type MessageEventKey = (typeof MESSAGE_EVENTS)[number]["key"];

export const MESSAGE_EVENT_KEYS: [MessageEventKey, ...MessageEventKey[]] = [
  MESSAGE_EVENTS[0].key,
  ...MESSAGE_EVENTS.slice(1).map((e) => e.key),
];

export const robotUpsertSchema = z.object({
  name: z.string().min(1).max(128),
  channel: z.enum(ROBOT_CHANNELS),
  /** 机器人渠道（wecom/dingtalk/feishu）必填 http(s) webhook；inapp/email 留空 */
  webhook: z.string().max(1024).optional(),
  enabled: z.boolean().default(true),
});
export type RobotUpsert = z.infer<typeof robotUpsertSchema>;

/** 单事件配置（AppSetting key=message.events 的一项）。 */
export const messageEventConfigSchema = z.object({
  enabled: z.boolean().default(false),
  robotIds: z.array(z.string().uuid()).max(10).default([]),
  receiverUserIds: z.array(z.string().uuid()).max(50).default([]),
});
export type MessageEventConfig = z.infer<typeof messageEventConfigSchema>;

export const messageEventsConfigSchema = z.record(z.enum(MESSAGE_EVENT_KEYS), messageEventConfigSchema);
export type MessageEventsConfig = z.infer<typeof messageEventsConfigSchema>;

export const notificationItemSchema = z.object({
  id: z.string().uuid(),
  type: z.string().max(64),
  title: z.string().max(256),
  content: z.string().max(2048),
  readAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type NotificationItem = z.infer<typeof notificationItemSchema>;

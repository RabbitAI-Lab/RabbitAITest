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

export const messageEventsConfigSchema = z.record(
  z.enum(MESSAGE_EVENT_KEYS),
  messageEventConfigSchema,
);
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

// ── 自定义消息模板（S9 ENTP-005；MSG_TEMPLATE 特性门控）──

/**
 * 事件 → 可用变量目录（公共三变量 + 对象变量）。
 * 渲染规则：`${var}` 全量替换；未知变量保留原样（容错）。
 */
export const TEMPLATE_VARS: Record<MessageEventKey, { name: string; label: string }[]> = {
  BUG_CREATED: [
    { name: "project", label: "项目名" },
    { name: "actorName", label: "操作人" },
    { name: "time", label: "时间" },
    { name: "title", label: "缺陷标题" },
    { name: "status", label: "缺陷状态" },
    { name: "severity", label: "严重程度" },
    { name: "assignee", label: "处理人" },
    { name: "handler", label: "经办人" },
    { name: "platform", label: "平台" },
  ],
  BUG_UPDATED: [
    { name: "project", label: "项目名" },
    { name: "actorName", label: "操作人" },
    { name: "time", label: "时间" },
    { name: "title", label: "缺陷标题" },
    { name: "status", label: "缺陷状态" },
    { name: "severity", label: "严重程度" },
    { name: "assignee", label: "处理人" },
  ],
  BUG_DELETED: [
    { name: "project", label: "项目名" },
    { name: "actorName", label: "操作人" },
    { name: "time", label: "时间" },
    { name: "title", label: "缺陷标题" },
  ],
  BUG_COMMENT: [
    { name: "project", label: "项目名" },
    { name: "actorName", label: "评论人" },
    { name: "time", label: "时间" },
    { name: "title", label: "对象标题" },
    { name: "comment", label: "评论摘要" },
  ],
  BUG_TRANSITION: [
    { name: "project", label: "项目名" },
    { name: "actorName", label: "操作人" },
    { name: "time", label: "时间" },
    { name: "title", label: "缺陷标题" },
    { name: "fromStatus", label: "原状态" },
    { name: "toStatus", label: "目标状态" },
  ],
  REVIEW_COMMENT: [
    { name: "project", label: "项目名" },
    { name: "actorName", label: "评论人" },
    { name: "time", label: "时间" },
    { name: "title", label: "评审名" },
    { name: "comment", label: "评论摘要" },
  ],
  CASE_COMMENT: [
    { name: "project", label: "项目名" },
    { name: "actorName", label: "评论人" },
    { name: "time", label: "时间" },
    { name: "title", label: "用例名" },
    { name: "comment", label: "评论摘要" },
  ],
  PLAN_EXEC_COMPLETED: [
    { name: "project", label: "项目名" },
    { name: "actorName", label: "触发人" },
    { name: "time", label: "时间" },
    { name: "name", label: "计划名" },
    { name: "result", label: "结果（通过率）" },
    { name: "passed", label: "通过数" },
    { name: "total", label: "总数" },
  ],
  SCENARIO_EXEC_COMPLETED: [
    { name: "project", label: "项目名" },
    { name: "actorName", label: "触发人" },
    { name: "time", label: "时间" },
    { name: "name", label: "场景名" },
    { name: "result", label: "结果" },
    { name: "passed", label: "通过数" },
    { name: "total", label: "总数" },
    { name: "source", label: "来源（手动/定时）" },
  ],
  SCHEDULE_ENABLED: [
    { name: "project", label: "项目名" },
    { name: "actorName", label: "操作人" },
    { name: "time", label: "时间" },
    { name: "name", label: "定时任务名" },
    { name: "cron", label: "CRON" },
  ],
  SCHEDULE_DISABLED: [
    { name: "project", label: "项目名" },
    { name: "actorName", label: "操作人" },
    { name: "time", label: "时间" },
    { name: "name", label: "定时任务名" },
    { name: "cron", label: "CRON" },
  ],
};

/** 公共变量（每事件恒可用）。 */
export const TEMPLATE_COMMON_VARS = [
  { name: "project", label: "项目名" },
  { name: "actorName", label: "操作人" },
  { name: "time", label: "时间" },
] as const;

export const messageTemplateUpsertSchema = z.object({
  event: z.enum(MESSAGE_EVENT_KEYS),
  title: z.string().min(1).max(128),
  content: z.string().min(1).max(1024),
});
export type MessageTemplateUpsert = z.infer<typeof messageTemplateUpsertSchema>;

export const messageTemplatePreviewSchema = messageTemplateUpsertSchema;

export const messageTemplateItemSchema = z.object({
  event: z.enum(MESSAGE_EVENT_KEYS),
  title: z.string(),
  content: z.string(),
  customized: z.boolean(),
  updatedAt: z.string().datetime().nullable(),
});
export type MessageTemplateItem = z.infer<typeof messageTemplateItemSchema>;

/** `${var}` 渲染：未知变量保留原样（容错，不报错）。 */
export function renderMessageTemplate(
  text: string,
  vars: Record<string, string | number | null | undefined>,
): string {
  return text.replace(/\$\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (raw, name: string) => {
    const v = vars[name];
    return v === undefined || v === null ? raw : String(v);
  });
}

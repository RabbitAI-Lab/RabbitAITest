/**
 * ENTP-005 自定义消息模板：项目×事件唯一模板 CRUD + 示例渲染。
 * dispatch 渲染挂钩在 notify.service（模板存在且 License 有效 → 渲染；否则回退挂点默认文案，S5 零回归）。
 */
import {
  DomainError,
  ErrCode,
  MESSAGE_EVENTS,
  renderMessageTemplate,
  type MessageEventKey,
  type MessageTemplateItem,
  type MessageTemplateUpsert,
} from "@rabbit/shared";
import { prisma } from "@rabbit/db";

export function assertTemplateEvent(event: string): asserts event is MessageEventKey {
  if (!MESSAGE_EVENTS.some((e) => e.key === event))
    throw new DomainError(ErrCode.TEMPLATE_EVENT_INVALID, `消息事件类型不合法：${event}`);
}

/** 11 事件全量（未定制=默认标记）。 */
export async function listTemplates(
  projectId: string,
): Promise<{ total: number; items: MessageTemplateItem[] }> {
  const rows = await prisma.messageTemplate.findMany({ where: { projectId } });
  const byEvent = new Map(rows.map((r) => [r.event, r]));
  const items: MessageTemplateItem[] = MESSAGE_EVENTS.map((e) => {
    const row = byEvent.get(e.key);
    return {
      event: e.key,
      title: row?.title ?? "",
      content: row?.content ?? "",
      customized: !!row,
      updatedAt: row ? row.updatedAt.toISOString() : null,
    };
  });
  return { total: items.length, items };
}

export async function upsertTemplate(projectId: string, input: MessageTemplateUpsert) {
  assertTemplateEvent(input.event);
  await prisma.messageTemplate.upsert({
    where: { projectId_event: { projectId, event: input.event } },
    update: { title: input.title, content: input.content },
    create: { projectId, event: input.event, title: input.title, content: input.content },
  });
  return { event: input.event };
}

/** 恢复默认（幂等：无模板也成功）。 */
export async function deleteTemplate(projectId: string, event: string) {
  assertTemplateEvent(event);
  await prisma.messageTemplate.deleteMany({ where: { projectId, event } });
  return { event };
}

/** 预览示例 vars（不落库）。 */
export async function previewTemplate(projectId: string, input: MessageTemplateUpsert) {
  assertTemplateEvent(input.event);
  const vars = sampleVars(input.event);
  return {
    title: renderMessageTemplate(input.title, vars),
    content: renderMessageTemplate(input.content, vars),
  };
}

function sampleVars(event: MessageEventKey): Record<string, string> {
  const common = {
    project: "演示项目",
    actorName: "张三",
    time: new Date().toLocaleString("zh-CN"),
  };
  const byEvent: Record<string, Record<string, string>> = {
    BUG_CREATED: {
      title: "支付下单偶发 500",
      status: "待处理",
      severity: "P1",
      assignee: "李四",
      handler: "李四",
      platform: "Local",
    },
    BUG_UPDATED: { title: "支付下单偶发 500", status: "处理中", severity: "P1", assignee: "李四" },
    BUG_DELETED: { title: "支付下单偶发 500" },
    BUG_COMMENT: { title: "支付下单偶发 500", comment: "已复现，网关超时导致" },
    BUG_TRANSITION: { title: "支付下单偶发 500", fromStatus: "待处理", toStatus: "处理中" },
    REVIEW_COMMENT: { title: "登录模块评审", comment: "这条用例边界覆盖不足" },
    CASE_COMMENT: { title: "下单主链路用例", comment: "建议补充金额边界" },
    PLAN_EXEC_COMPLETED: { name: "十月回归计划", result: "42/45 通过", passed: "42", total: "45" },
    SCENARIO_EXEC_COMPLETED: {
      name: "下单主链路",
      result: "成功",
      passed: "3",
      total: "3",
      source: "手动",
    },
    SCHEDULE_ENABLED: { name: "每日冒烟", cron: "0 8 * * *" },
    SCHEDULE_DISABLED: { name: "每日冒烟", cron: "0 8 * * *" },
  };
  return { ...common, ...(byEvent[event] ?? {}) };
}

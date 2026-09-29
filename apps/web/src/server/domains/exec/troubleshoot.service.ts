/**
 * 失败任务排障包（INFRA-004；rules/observability.md §7）：
 * 聚合任务定义快照 + 事件流末 N 帧 → 单 JSON 文件直下。
 * 勘误 1（相对规格 §2）：tar.gz 三件 → 单 JSON 直下——免新增 tar 依赖与中文文件名编码风险，内容等价（manifest + events 内嵌）；预生成/对象存储归档登记 Backlog。
 * 勘误 2：LOG_FILE 日志片段裁撤——env 指向路径的文件读取构成路径穿越面（Mimosa 高危拦截成立）；
 * 进程日志口径改为 stdout 统一采集（pino JSON，按 execTaskId 字段过滤），排障包内给检索说明。
 */
import { prisma } from "@rabbit/db";
import { DomainError, ErrCode } from "@rabbit/shared";

const MAX_EVENT_FRAMES = 50;

export interface TroubleshootPack {
  filename: string;
  body: string; // JSON 文本
}

export async function buildTroubleshootPack(
  projectId: string,
  taskId: string,
): Promise<TroubleshootPack> {
  // 路径段=taskId（与报告详情端点同口径：reports/[taskId]——reportDetail 按 ExecTask.id 查询）
  const task = await prisma.execTask.findFirst({
    where: { id: taskId, projectId },
    select: {
      id: true,
      type: true,
      refType: true,
      refId: true,
      status: true,
      failureKind: true,
      message: true,
      startedAt: true,
      finishedAt: true,
      durationMs: true,
      payload: true,
      createdAt: true,
      reports: {
        select: { id: true, name: true, reportType: true },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });
  if (!task) throw new DomainError(ErrCode.TASK_NOT_FOUND, "任务不存在");
  if (task.status !== "FAILED") {
    throw new DomainError(ErrCode.PACK_NOT_ALLOWED, "任务非失败状态（SUCCESS/STOPPED 无需排障包）");
  }
  const report = task.reports[0] ?? { id: "", name: "", reportType: "" };

  const items = await prisma.execItem.findMany({
    where: { taskId: task.id },
    select: { id: true, refType: true, refId: true, status: true, result: true },
    orderBy: { id: "asc" },
  });

  const frames = await prisma.execStepResult.findMany({
    where: { item: { taskId: task.id } },
    select: { itemId: true, seq: true, frame: true },
    orderBy: [{ itemId: "asc" }, { seq: "desc" }],
  });
  // 末 N 帧（按 item/seq 倒排取尾部后正序还原；保留 item/seq 溯源）
  const tail = frames.slice(0, MAX_EVENT_FRAMES).reverse();

  return {
    filename: `troubleshoot-${task.id.slice(0, 8)}.json`,
    body: JSON.stringify(
      {
        manifest: {
          generatedAt: new Date().toISOString(),
          node: process.version,
          report: { id: report.id, name: report.name, reportType: report.reportType },
          task: {
            id: task.id,
            type: task.type,
            refType: task.refType,
            refId: task.refId,
            status: task.status,
            failureKind: task.failureKind,
            message: task.message,
            startedAt: task.startedAt,
            finishedAt: task.finishedAt,
            durationMs: task.durationMs,
            payload: task.payload,
          },
          items: items.map((i) => ({
            id: i.id,
            refType: i.refType,
            refId: i.refId,
            status: i.status,
            result: i.result,
          })),
          eventFrameCount: tail.length,
          truncated: frames.length > MAX_EVENT_FRAMES,
        },
        events: tail.map((f) => ({ itemId: f.itemId, seq: f.seq, frame: f.frame })),
        logs: "进程日志不入包（勘误 2）：web/engine 输出 pino JSON 至 stdout，按字段 execTaskId 过滤即可检索本任务全部日志行。",
      },
      null,
      2,
    ),
  };
}

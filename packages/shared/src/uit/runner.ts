/**
 * S14 UIT-004：项目级 Runner 与环境检测契约。
 * - RunnerEnvCheckItem：六项 checklist 行（node/runner_pkg/chromium/disk/ffmpeg/npm_registry），三态 ok/warn/fail；
 * - runner 作业载荷（web → engine，BullMQ 队列 config.runnerQueueName）：install/check/remove；
 * - internal 回调载荷（engine → web POST /api/v1/internal/runners/report）；
 * - 版本白名单：仅官方 @playwright/test 精确 semver（供应链最小面，rules/security.md）。
 */
import { z } from "zod";

/** 精确 semver（ Maj.min.patch，无 range/前后缀——安装复现性与命令行注入面双收口）。 */
export const RUNNER_VERSION_RE = /^\d{1,2}\.\d{1,3}\.\d{1,3}$/;

export const runnerCheckItemSchema = z.object({
  key: z.enum(["node", "runner_pkg", "chromium", "disk", "ffmpeg", "npm_registry"]),
  label: z.string().max(64),
  status: z.enum(["ok", "warn", "fail"]),
  detail: z.string().max(512),
  hint: z.string().max(512).optional(),
});
export type RunnerEnvCheckItem = z.infer<typeof runnerCheckItemSchema>;

/** fail 项判定（预检阻断口径：仅 fail 阻断，warn 不阻断——规格 §2 D5）。 */
export function runnerCheckHasFail(items: RunnerEnvCheckItem[]): boolean {
  return items.some((i) => i.status === "fail");
}

/** runner 检测结果聚合（checklist + 元信息；checkItems 为空=从未检测；version=engine 实测解析版本，展示优先于常量）。 */
export const runnerCheckResultSchema = z.object({
  items: z.array(runnerCheckItemSchema),
  checkedAt: z.string(), // ISO
  version: z.string().max(32).optional(),
});
export type RunnerCheckResult = z.infer<typeof runnerCheckResultSchema>;

// ───────────────────────── runner 作业（web → engine，队列 runner-jobs） ─────────────────────────

/** 安装：npm registry 拉精确版本 + 自动补 chromium + 自动检测。 */
export const runnerInstallJobSchema = z.object({
  kind: z.literal("install"),
  runnerId: z.string().uuid(),
  projectId: z.string().uuid(),
  version: z.string().regex(RUNNER_VERSION_RE),
  source: z.string().url().max(255),
});
/** 检测：target=builtin（内置 runner，结果进 Redis 缓存）| project（项目 runner，结果回写行）。 */
export const runnerCheckJobSchema = z.object({
  kind: z.literal("check"),
  projectId: z.string().uuid(),
  target: z.enum(["builtin", "project"]),
  runnerId: z.string().uuid().optional(),
});
/** 目录清理（软删行后的磁盘回收）。 */
export const runnerRemoveJobSchema = z.object({
  kind: z.literal("remove"),
  runnerId: z.string().uuid(),
  projectId: z.string().uuid(),
});
export const runnerJobSchema = z.discriminatedUnion("kind", [
  runnerInstallJobSchema,
  runnerCheckJobSchema,
  runnerRemoveJobSchema,
]);
export type RunnerJob = z.infer<typeof runnerJobSchema>;

// ───────────────────────── internal 回调（engine → web） ─────────────────────────

export const runnerReportSchema = z.discriminatedUnion("kind", [
  z.object({
    /** 安装中间态（npm/browsers/check 三段；web 落 installLogTail 供前端进度轮询） */
    kind: z.literal("progress"),
    runnerId: z.string().uuid(),
    projectId: z.string().uuid(),
    stage: z.enum(["npm", "browsers", "check"]),
    logTail: z.string().max(2000).default(""),
  }),
  z.object({
    kind: z.literal("install"),
    runnerId: z.string().uuid(),
    projectId: z.string().uuid(),
    status: z.enum(["READY", "FAILED"]),
    installLogTail: z.string().max(2000).default(""),
    check: runnerCheckResultSchema.nullable(),
  }),
  z.object({
    kind: z.literal("check"),
    projectId: z.string().uuid(),
    target: z.enum(["builtin", "project"]),
    runnerId: z.string().uuid().optional(),
    check: runnerCheckResultSchema,
  }),
  z.object({
    kind: z.literal("remove"),
    runnerId: z.string().uuid(),
    projectId: z.string().uuid(),
    ok: z.boolean(),
    message: z.string().max(512).default(""),
  }),
]);
export type RunnerReport = z.infer<typeof runnerReportSchema>;

// ───────────────────────── API 视图（web 响应；api-client 同形） ─────────────────────────

export const RUNNER_STATUS = ["INSTALLING", "READY", "FAILED", "INSTALL_CANCELLED"] as const;
export type RunnerStatus = (typeof RUNNER_STATUS)[number];

/** 列表/详情行（内置 runner 虚拟行：kind=builtin、id 固定 "builtin"、status 恒 READY）。 */
export const uiRunnerViewSchema = z.object({
  id: z.string(),
  projectId: z.string().uuid(),
  kind: z.enum(["builtin", "project"]),
  name: z.string().max(64),
  version: z.string().max(32),
  status: z.enum(RUNNER_STATUS),
  isDefault: z.boolean(),
  installSource: z.string().max(255).optional(),
  installLogTail: z.string().max(2000).optional(),
  lastCheckAt: z.string().nullable(),
  check: runnerCheckResultSchema.nullable(),
  createdAt: z.string(),
});
export type UiRunnerView = z.infer<typeof uiRunnerViewSchema>;

export const uiRunnerInstallBodySchema = z.object({
  version: z.string().regex(RUNNER_VERSION_RE, "版本必须为精确 semver（如 1.63.0）"),
});
export type UiRunnerInstallBody = z.infer<typeof uiRunnerInstallBodySchema>;

/** 内置 runner 常量（引擎与 web 展示同源；升版=两处 package.json 同步后改此处）。 */
export const BUILTIN_RUNNER = {
  id: "builtin",
  name: "系统 Runner",
  version: "1.63.0",
} as const;

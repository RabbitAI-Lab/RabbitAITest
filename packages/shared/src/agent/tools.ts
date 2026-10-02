/** AGENT-001 内置工具目录（单一来源）：key/权限点/入参 zod → LLM JSON Schema 投影。
 * 工具 handler 在 apps/web（复用各域 service，禁裸 SQL——门禁 5）；本文件只定目录与契约。 */
import { z } from "zod";

export const AGENT_TOOL_GROUP_LABELS = {
  case: "用例",
  api: "接口",
  plan: "计划与执行",
  report: "报告与缺陷",
  repo: "仓库",
} as const;
export type AgentToolGroup = keyof typeof AGENT_TOOL_GROUP_LABELS;

export interface AgentToolDef<Schema extends z.ZodTypeAny = z.ZodTypeAny> {
  key: string;
  title: string;
  description: string;
  group: AgentToolGroup;
  /** 执行身份须持有的既有权限点（不新造工具权限点——§2.4） */
  requiredPermission: string;
  /** 写操作（UI 红标 + 审计强调） */
  write: boolean;
  input: Schema;
}

// ── 入参 schema ──

const keyword = z.string().max(128).optional();
const pageArgs = { page: z.number().int().min(1).default(1), pageSize: z.number().int().min(1).max(50).default(20) };

const caseSearchInput = z.object({ keyword, moduleId: z.string().uuid().optional(), ...pageArgs });
const caseGetInput = z.object({ caseId: z.string().uuid() });
const caseCreateInput = z.object({
  cases: z
    .array(
      z.object({
        name: z.string().min(1).max(512),
        precondition: z.string().max(4000).default(""),
        steps: z.array(z.object({ desc: z.string().max(2000), expect: z.string().max(2000) })).max(50).default([]),
        level: z.enum(["P0", "P1", "P2", "P3"]).default("P2"),
        tags: z.array(z.string().max(64)).max(10).default([]),
      }),
    )
    .min(1)
    .max(20),
});
const moduleTreeInput = z.object({ depth: z.number().int().min(1).max(3).default(2) });
const apiSearchInput = z.object({ keyword, ...pageArgs });
const planSearchInput = z.object({ keyword, status: z.string().max(32).optional(), ...pageArgs });
const planRunInput = z.object({ planId: z.string().uuid(), clientTaskId: z.string().max(64).optional() });
const taskStatusInput = z.object({ taskId: z.string().uuid() });
const reportGetInput = z.object({ reportId: z.string().uuid(), failTopN: z.number().int().min(1).max(20).default(5) });
const bugSearchInput = z.object({ keyword, ...pageArgs });
const bugCreateInput = z.object({
  title: z.string().min(1).max(255),
  description: z.string().max(8000),
});
const repoListFilesInput = z.object({
  repoId: z.string().uuid(),
  branch: z.string().max(255).optional(),
  path: z.string().max(512).default(""),
});
const repoReadFileInput = z.object({
  repoId: z.string().uuid(),
  branch: z.string().max(255).optional(),
  path: z.string().min(1).max(512),
});

// ── 目录（13 个，§2.3） ──

export const AGENT_TOOLS: readonly AgentToolDef[] = [
  {
    key: "case.search",
    title: "功能用例搜索",
    description: "按关键词/模块搜索功能用例（分页 ≤50），返回 id/num/name/模块/评审状态",
    group: "case",
    requiredPermission: "PROJECT_CASE:READ",
    write: false,
    input: caseSearchInput,
  },
  {
    key: "case.get",
    title: "用例详情",
    description: "读取功能用例详情（步骤/字段/标签）",
    group: "case",
    requiredPermission: "PROJECT_CASE:READ",
    write: false,
    input: caseGetInput,
  },
  {
    key: "case.create",
    title: "创建功能用例",
    description: "批量创建功能用例草稿（单次 ≤20 条，落默认模块、PREPARING 未评审态，人工评审后生效）",
    group: "case",
    requiredPermission: "PROJECT_CASE:CREATE",
    write: true,
    input: caseCreateInput,
  },
  {
    key: "module.tree",
    title: "模块树",
    description: "读取项目模块树（两层内摘要，节点 ≤200 截断）——模块归属必须来自本结果",
    group: "case",
    requiredPermission: "PROJECT_CASE:READ",
    write: false,
    input: moduleTreeInput,
  },
  {
    key: "api.search",
    title: "接口定义搜索",
    description: "按关键词搜索接口定义（method/path/name）",
    group: "api",
    requiredPermission: "PROJECT_API:READ",
    write: false,
    input: apiSearchInput,
  },
  {
    key: "plan.search",
    title: "测试计划搜索",
    description: "按关键词/状态搜索测试计划",
    group: "plan",
    requiredPermission: "PROJECT_PLAN:READ",
    write: false,
    input: planSearchInput,
  },
  {
    key: "plan.run",
    title: "触发计划执行",
    description: "提交测试计划执行（返回 taskId，可携 clientTaskId 幂等）",
    group: "plan",
    requiredPermission: "PROJECT_PLAN:UPDATE",
    write: true,
    input: planRunInput,
  },
  {
    key: "task.status",
    title: "执行任务状态",
    description: "查询执行任务进度与结果摘要",
    group: "plan",
    requiredPermission: "PROJECT_EXEC_TASK:READ",
    write: false,
    input: taskStatusInput,
  },
  {
    key: "report.get",
    title: "报告读取",
    description: "读取执行报告统计摘要与失败 Top N（不回原始日志全文）",
    group: "report",
    requiredPermission: "PROJECT_REPORT:READ",
    write: false,
    input: reportGetInput,
  },
  {
    key: "bug.search",
    title: "缺陷搜索",
    description: "按关键词搜索缺陷",
    group: "report",
    requiredPermission: "PROJECT_BUG:READ",
    write: false,
    input: bugSearchInput,
  },
  {
    key: "bug.create",
    title: "创建缺陷",
    description: "创建平台缺陷（三方同步走既有链路）",
    group: "report",
    requiredPermission: "PROJECT_BUG:CREATE",
    write: true,
    input: bugCreateInput,
  },
  {
    key: "repo.list_files",
    title: "仓库列目录",
    description: "列出工作区仓库目录（分支/路径；≤500 条截断）——只读",
    group: "repo",
    requiredPermission: "PROJECT_REPO:READ",
    write: false,
    input: repoListFilesInput,
  },
  {
    key: "repo.read_file",
    title: "仓库读文件",
    description: "读取工作区仓库单文件（文本类 ≤256KB；越限返回错误说明）——只读",
    group: "repo",
    requiredPermission: "PROJECT_REPO:READ",
    write: false,
    input: repoReadFileInput,
  },
] as const;

export const AGENT_TOOL_KEYS = AGENT_TOOLS.map((t) => t.key);
export const AGENT_TOOL_MAP: ReadonlyMap<string, AgentToolDef> = new Map(
  AGENT_TOOLS.map((t) => [t.key, t]),
);

/** LLM function calling 的 JSON Schema 投影（pi customTools / 校验共用） */
export function agentToolJsonSchema(keys: string[]): {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}[] {
  return keys
    .map((k) => AGENT_TOOL_MAP.get(k))
    .filter((t): t is AgentToolDef => Boolean(t))
    .map((t) => ({
      name: t.key,
      description: `${t.title}：${t.description}${t.write ? "（写操作）" : ""}`,
      parameters: zodToJsonSchemaShape(t.input),
    }));
}

/** 极简 zod → JSON Schema（object 顶层：properties/required；够 LLM 用，不引额外依赖） */
export function zodToJsonSchemaShape(schema: z.ZodTypeAny): Record<string, unknown> {
  const def = (schema as unknown as { _def: Record<string, unknown> })._def;
  const inner = (s: z.ZodTypeAny): Record<string, unknown> => {
    const d = (s as unknown as { _def: Record<string, unknown> })._def;
    if (d.typeName === "ZodOptional" || d.typeName === "ZodDefault") {
      return inner(d.innerType as z.ZodTypeAny);
    }
    if (d.typeName === "ZodString") return { type: "string" };
    if (d.typeName === "ZodNumber" || d.typeName === "ZodInt") return { type: "number" };
    if (d.typeName === "ZodBoolean") return { type: "boolean" };
    if (d.typeName === "ZodArray") return { type: "array", items: inner(d.type as z.ZodTypeAny) };
    if (d.typeName === "ZodEnum") return { type: "string", enum: d.values };
    if (d.typeName === "ZodLiteral") return { type: "string", enum: [d.value] };
    if (d.typeName === "ZodObject") {
      const shape = d.shape as Record<string, z.ZodTypeAny>;
      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      for (const [k, v] of Object.entries(shape)) {
        properties[k] = inner(v);
        const vd = (v as unknown as { _def: Record<string, unknown> })._def;
        if (vd.typeName !== "ZodOptional" && vd.typeName !== "ZodDefault") required.push(k);
      }
      return { type: "object", properties, ...(required.length ? { required } : {}) };
    }
    return { type: "string" };
  };
  void def;
  return inner(schema);
}

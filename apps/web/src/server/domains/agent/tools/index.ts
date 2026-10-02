/**
 * AGENT-001 工具 handler 注册表：13 内置工具的服务端实现（§2.3 目录表一一对应）。
 * ctx={projectId, userId=执行身份}；写工具复用各域 service（num 分配/审计/事件走既有链路）；
 * repo.* 读工作区本地（任务前已 ensure 分支最新）。结果统一 JSON 截断 32KB 回传 LLM。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { AGENT_TOOL_MAP, type AgentToolDef } from "@rabbit/shared";
import { prisma } from "@rabbit/db";
import { createCase, listCases, getCase } from "@/server/domains/case/case.service";
import { createBug } from "@/server/domains/bug/bug.service";
import { createPlanTask } from "@/server/domains/plan/plan-exec.service";
import { agentWsDir, repoDirName } from "../workspace";

export interface ToolCtx {
  projectId: string;
  /** 执行身份（UI=调用者；A2A=runAsUser）——权限断言与写操作审计主体 */
  userId: string;
  runId: string;
  /** 本 Run 的 Agent 工作区根（repo.* 读工作区本地用；由 run.service 注入） */
  wsDir: string;
}

type Handler = (input: Record<string, unknown>, ctx: ToolCtx) => Promise<unknown>;

const PAGE = (o: Record<string, unknown>) => ({
  page: Number(o.page ?? 1),
  pageSize: Math.min(Number(o.pageSize ?? 20), 50),
});

async function orgIdOf(projectId: string): Promise<string> {
  const p = await prisma.project.findUnique({ where: { id: projectId }, select: { orgId: true } });
  if (!p) throw new Error("项目不存在");
  return p.orgId;
}

const handlers: Record<string, Handler> = {
  "case.search": async (i, ctx) => {
    const r = await listCases(ctx.projectId, {
      keyword: (i.keyword as string) ?? undefined,
      recycled: false,
      orderBy: "updatedAt",
      order: "desc",
      page: PAGE(i).page,
      pageSize: PAGE(i).pageSize,
    });
    return r;
  },
  "case.get": async (i, ctx) => getCase(ctx.projectId, i.caseId as string),
  "case.create": async (i, ctx) => {
    const cases = (i.cases as Record<string, unknown>[]) ?? [];
    const created: { id: string; num: number }[] = [];
    for (const c of cases.slice(0, 20)) {
      const row = await createCase(ctx.projectId, ctx.userId, {
        name: c.name as string,
        precondition: (c.precondition as string) ?? "",
        steps: (c.steps as { desc: string; expect: string }[]) ?? [],
        level: (c.level as "P0" | "P1" | "P2" | "P3") ?? "P2",
        tags: (c.tags as string[]) ?? [],
      });
      created.push({ id: row.id, num: row.num });
    }
    return {
      created,
      count: created.length,
      note: "已落默认模块、未评审态（PREPARING）；如需指定模块请在评审后移动",
    };
  },
  "module.tree": async (_i, ctx) => {
    const nodes = await prisma.moduleNode.findMany({
      where: { projectId: ctx.projectId, scene: "case" },
      select: { id: true, name: true, parentId: true, isDefault: true },
      orderBy: { order: "asc" },
      take: 200,
    });
    const roots = nodes.filter((n) => !n.parentId);
    return {
      nodes: roots.slice(0, 50).map((r) => ({
        id: r.id,
        name: r.name,
        isDefault: r.isDefault,
        children: nodes
          .filter((n) => n.parentId === r.id)
          .slice(0, 20)
          .map((c) => ({ id: c.id, name: c.name, isDefault: c.isDefault })),
      })),
      truncated: nodes.length >= 200,
      note: "用例的 module 归属必须取自本结果中的节点 id",
    };
  },
  "api.search": async (i, ctx) => {
    const kw = (i.keyword as string) ?? "";
    const rows = await prisma.apiDefinition.findMany({
      where: {
        projectId: ctx.projectId,
        ...(kw ? { OR: [{ name: { contains: kw } }, { path: { contains: kw } }] } : {}),
      },
      select: { id: true, method: true, path: true, name: true, num: true },
      orderBy: { createdAt: "desc" },
      skip: (PAGE(i).page - 1) * PAGE(i).pageSize,
      take: PAGE(i).pageSize,
    });
    return { total: rows.length, items: rows };
  },
  "plan.search": async (i, ctx) => {
    const kw = (i.keyword as string) ?? "";
    const rows = await prisma.testPlan.findMany({
      where: {
        projectId: ctx.projectId,
        archivedAt: null,
        ...(kw ? { name: { contains: kw } } : {}),
        ...((i.status as string) ? { status: i.status as string } : {}),
      },
      select: { id: true, name: true, status: true },
      orderBy: { createdAt: "desc" },
      skip: (PAGE(i).page - 1) * PAGE(i).pageSize,
      take: PAGE(i).pageSize,
    });
    return { total: rows.length, items: rows };
  },
  "plan.run": async (i, ctx) => {
    const r = await createPlanTask(ctx.projectId, i.planId as string, ctx.userId, {});
    return {
      taskId: r.taskId,
      itemCount: r.itemCount,
      warnings: r.warnings,
      note: "已提交执行，可用 task.status 查询进度",
    };
  },
  "task.status": async (i, ctx) => {
    const t = await prisma.execTask.findFirst({
      where: { id: i.taskId as string, projectId: ctx.projectId },
      select: { id: true, type: true, status: true, failureKind: true, message: true },
    });
    if (!t) return { error: "任务不存在或不属于本项目" };
    return t;
  },
  "report.get": async (i, ctx) => {
    const rp = await prisma.report.findFirst({
      where: { id: i.reportId as string, projectId: ctx.projectId },
      select: { id: true, name: true, reportType: true, summary: true, createdAt: true },
    });
    if (!rp) return { error: "报告不存在" };
    const topN = Math.min(Number(i.failTopN ?? 5), 20);
    const fails = await prisma.execItem
      .findMany({
        where: { taskId: rp.id.replace(/^rpt-/, ""), status: "FAILED" },
        select: { refType: true, refId: true },
        take: topN,
      })
      .catch(() => []);
    return { ...rp, failTop: fails };
  },
  "bug.search": async (i, ctx) => {
    const kw = (i.keyword as string) ?? "";
    const rows = await prisma.bug.findMany({
      where: { projectId: ctx.projectId, ...(kw ? { title: { contains: kw } } : {}) },
      select: { id: true, num: true, title: true, status: true },
      orderBy: { createdAt: "desc" },
      skip: (PAGE(i).page - 1) * PAGE(i).pageSize,
      take: PAGE(i).pageSize,
    });
    return { total: rows.length, items: rows };
  },
  "bug.create": async (i, ctx) => {
    const orgId = await orgIdOf(ctx.projectId);
    const b = await createBug(ctx.projectId, orgId, ctx.userId, {
      title: i.title as string,
      description: i.description as string,
      fields: {},
      tags: [],
    });
    return { id: b.id, num: b.num, status: b.status };
  },
  "repo.list_files": async (i, ctx) => {
    const repo = await prisma.scmRepository.findFirst({
      where: { id: i.repoId as string, projectId: ctx.projectId, deletedAt: null },
      select: { owner: true, repo: true },
    });
    if (!repo) return { error: "仓库不在本项目绑定列表" };
    const base = path.join(
      ctx.wsDir,
      "repos",
      repoDirName(repo.owner, repo.repo),
      (i.path as string) ?? "",
    );
    const wsReal = path.resolve(ctx.wsDir, "repos");
    const target = path.resolve(base);
    if (!target.startsWith(wsReal + path.sep)) return { error: "路径越界" };
    try {
      const entries = await fs.readdir(target, { withFileTypes: true });
      const items = entries
        .slice(0, 500)
        .map((e) => ({ name: e.name, type: e.isDirectory() ? "dir" : "file" }));
      return { path: (i.path as string) ?? "", items, truncated: entries.length > 500 };
    } catch {
      return { error: `目录不存在：${(i.path as string) ?? ""}` };
    }
  },
  "repo.read_file": async (i, ctx) => {
    const repo = await prisma.scmRepository.findFirst({
      where: { id: i.repoId as string, projectId: ctx.projectId, deletedAt: null },
      select: { owner: true, repo: true },
    });
    if (!repo) return { error: "仓库不在本项目绑定列表" };
    const wsDir = ctx.wsDir;
    const file = path.resolve(wsDir, "repos", repoDirName(repo.owner, repo.repo), i.path as string);
    const wsReal = path.resolve(wsDir, "repos");
    if (!file.startsWith(wsReal + path.sep)) return { error: "路径越界" };
    try {
      const stat = await fs.stat(file);
      if (stat.size > 256 * 1024)
        return {
          error: `文件超过 256KB（实际 ${(stat.size / 1024).toFixed(0)}KB），请分段读取或改读摘要`,
        };
      const buf = await fs.readFile(file, "utf8");
      return { path: i.path, size: stat.size, content: buf };
    } catch {
      return { error: `文件不存在或非文本：${i.path}` };
    }
  },
};

export async function executeTool(
  key: string,
  input: Record<string, unknown>,
  ctx: ToolCtx,
  assertPermission: (point: string) => Promise<void>,
): Promise<{ ok: boolean; result: unknown; def: AgentToolDef }> {
  const def = AGENT_TOOL_MAP.get(key);
  if (!def)
    return {
      ok: false,
      result: { error: `未知工具 ${key}` },
      def: null as unknown as AgentToolDef,
    };
  await assertPermission(def.requiredPermission); // 无权 → 错误说明回传 LLM（不熔断）
  const handler = handlers[key];
  if (!handler) return { ok: false, result: { error: "工具暂未实现" }, def };
  try {
    const result = await handler(input, ctx);
    return { ok: true, result, def };
  } catch (e) {
    return {
      ok: false,
      result: { error: `工具执行失败：${(e as Error).message?.slice(0, 300)}` },
      def,
    };
  }
}

/** 结果 JSON 截断 32KB（§2.2 ③） */
export function truncateToolResult(result: unknown): unknown {
  const json = JSON.stringify(result ?? null);
  if (json.length <= 32 * 1024) return result;
  return { truncated: true, preview: json.slice(0, 30 * 1024) + "…（截断）" };
}

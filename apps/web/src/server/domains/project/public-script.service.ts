/** PROJ-005 公共脚本：CRUD / 状态二态 / 引用扫描与删除保护 / 在线调试。 */
import { DomainError, ErrCode } from "@rabbit/shared";
import { PUBLIC_SCRIPT_LIMIT, type Processor } from "@rabbit/shared";
import type { Prisma } from "@rabbit/db";
import { prisma } from "@rabbit/db";
import { runScriptDebug, ScriptDebugError } from "./script-sandbox";

const toJson = (v: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(v ?? {})) as Prisma.InputJsonValue;

export interface PublicScriptUpsertInput {
  name: string;
  language: "javascript";
  tags: string[];
  params: { name: string; defaultValue: string; required: boolean }[];
  content: string;
}

function validate(input: PublicScriptUpsertInput, forPublish = false) {
  const names = new Set<string>();
  for (const p of input.params) {
    if (names.has(p.name)) {
      throw new DomainError(ErrCode.VALIDATION_FAILED, `参数重名：${p.name}`);
    }
    names.add(p.name);
  }
  if (forPublish && input.content.trim().length === 0) {
    throw new DomainError(ErrCode.VALIDATION_FAILED, "发布前脚本内容不能为空");
  }
}

function serialize(s: {
  id: string;
  name: string;
  language: string;
  status: string;
  tags: unknown;
  params: unknown;
  content: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: s.id,
    name: s.name,
    language: s.language,
    status: s.status,
    tags: Array.isArray(s.tags) ? (s.tags as string[]) : [],
    params: Array.isArray(s.params)
      ? (s.params as { name: string; defaultValue: string; required: boolean }[])
      : [],
    content: s.content,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

export async function listPublicScripts(projectId: string, q: { keyword?: string }) {
  const where = {
    projectId,
    deletedAt: null,
    ...(q.keyword ? { name: { contains: q.keyword } } : {}),
  };
  const [total, items] = await Promise.all([
    prisma.publicScript.count({ where }),
    prisma.publicScript.findMany({ where, orderBy: { updatedAt: "desc" } }),
  ]);
  return { total, items: items.map(serialize) };
}

async function getScript(projectId: string, id: string) {
  const s = await prisma.publicScript.findFirst({ where: { id, projectId, deletedAt: null } });
  if (!s) throw new DomainError(ErrCode.SCRIPT_NOT_FOUND, "公共脚本不存在或已删除");
  return s;
}

export async function createPublicScript(projectId: string, input: PublicScriptUpsertInput) {
  const count = await prisma.publicScript.count({ where: { projectId, deletedAt: null } });
  if (count >= PUBLIC_SCRIPT_LIMIT) {
    throw new DomainError(
      ErrCode.SCRIPT_LIMIT_EXCEEDED,
      `公共脚本数量超出上限（${PUBLIC_SCRIPT_LIMIT}/项目）`,
    );
  }
  validate(input);
  const dup = await prisma.publicScript.findFirst({
    where: { projectId, name: input.name, deletedAt: null },
    select: { id: true },
  });
  if (dup) throw new DomainError(ErrCode.VALIDATION_FAILED, "脚本名称已存在");
  const s = await prisma.publicScript.create({
    data: {
      projectId,
      name: input.name,
      language: input.language,
      status: "DRAFT",
      tags: toJson(input.tags),
      params: toJson(input.params),
      content: input.content,
    },
  });
  return serialize(s);
}

export async function updatePublicScript(
  projectId: string,
  id: string,
  input: PublicScriptUpsertInput,
) {
  const existing = await getScript(projectId, id);
  validate(input, existing.status === "ENABLED");
  const dup = await prisma.publicScript.findFirst({
    where: { projectId, name: input.name, deletedAt: null, id: { not: id } },
    select: { id: true },
  });
  if (dup) throw new DomainError(ErrCode.VALIDATION_FAILED, "脚本名称已存在");
  const s = await prisma.publicScript.update({
    where: { id },
    data: {
      name: input.name,
      tags: toJson(input.tags),
      params: toJson(input.params),
      content: input.content,
    },
  });
  return serialize(s);
}

/** 状态流转：DRAFT→ENABLED（发布校验内容与参数）；ENABLED→DRAFT（停用）。 */
export async function setPublicScriptStatus(
  projectId: string,
  id: string,
  status: "DRAFT" | "ENABLED",
) {
  const existing = await getScript(projectId, id);
  if (existing.status === status) return serialize(existing);
  if (status === "ENABLED") {
    validate(
      {
        name: existing.name,
        language: "javascript",
        tags: [],
        params:
          (existing.params as { name: string; defaultValue: string; required: boolean }[]) ?? [],
        content: existing.content,
      },
      true,
    );
  }
  const s = await prisma.publicScript.update({ where: { id }, data: { status } });
  return serialize(s);
}

/** 处理器中的 scriptRef 命中检测（扫描三处引用面：api 用例/场景步骤/环境前后置）。 */
function processorHits(processors: unknown, scriptId: string): boolean {
  if (!Array.isArray(processors)) return false;
  return processors.some((p) => {
    const proc = p as { kind?: string; scriptRef?: { scriptId?: string } };
    return proc?.kind === "script" && proc.scriptRef?.scriptId === scriptId;
  });
}

function walkSteps(steps: unknown, scriptId: string): boolean {
  if (!Array.isArray(steps)) return false;
  return steps.some((raw) => {
    const st = raw as { config?: { pre?: unknown; post?: unknown }; children?: unknown };
    if (processorHits(st?.config?.pre, scriptId) || processorHits(st?.config?.post, scriptId))
      return true;
    if (walkSteps(st?.children, scriptId)) return true;
    return false;
  });
}

/** 引用清单（删除保护数据；PROJ-005 §2）。 */
export async function listScriptReferences(projectId: string, scriptId: string) {
  await getScript(projectId, scriptId);
  const refs: { type: string; id: string; name: string }[] = [];
  const cases = await prisma.apiCase.findMany({
    where: { projectId, deletedAt: null },
    select: { id: true, name: true, request: true },
  });
  for (const c of cases) {
    const req = c.request as { pre?: unknown; post?: unknown } | null;
    if (processorHits(req?.pre, scriptId) || processorHits(req?.post, scriptId)) {
      refs.push({ type: "api_case", id: c.id, name: c.name });
    }
  }
  const scenarios = await prisma.scenario.findMany({
    where: { projectId, deletedAt: null },
    select: { id: true, name: true, steps: true, config: true },
  });
  for (const sc of scenarios) {
    const cfg = sc.config as { prePost?: { pre?: unknown; post?: unknown } } | null;
    if (
      processorHits(cfg?.prePost?.pre, scriptId) ||
      processorHits(cfg?.prePost?.post, scriptId) ||
      walkSteps(sc.steps, scriptId)
    ) {
      refs.push({ type: "scenario", id: sc.id, name: sc.name });
    }
  }
  const envs = await prisma.environment.findMany({
    where: { projectId, deletedAt: null },
    select: { id: true, name: true, config: true },
  });
  for (const e of envs) {
    const cfg = e.config as { prePost?: { pre?: unknown; post?: unknown } } | null;
    if (processorHits(cfg?.prePost?.pre, scriptId) || processorHits(cfg?.prePost?.post, scriptId)) {
      refs.push({ type: "environment", id: e.id, name: e.name });
    }
  }
  return { references: refs };
}

/** 删除：被引用 → 409（附清单）；force=true 跳过保护软删。 */
export async function deletePublicScript(projectId: string, id: string, force = false) {
  await getScript(projectId, id);
  if (!force) {
    const { references } = await listScriptReferences(projectId, id);
    if (references.length > 0) {
      throw new DomainError(
        ErrCode.SCRIPT_IN_USE,
        "公共脚本正被引用，禁止删除（可强制删除）",
        references,
      );
    }
  }
  await prisma.publicScript.update({ where: { id }, data: { deletedAt: new Date() } });
  return { id };
}

/** 在线调试（两态均可；vars+params 注入；5s 超时）。 */
export async function debugPublicScript(
  projectId: string,
  id: string,
  input: { vars: Record<string, string>; params: Record<string, string> },
) {
  const s = await getScript(projectId, id);
  const defs = (Array.isArray(s.params) ? s.params : []) as {
    name: string;
    defaultValue: string;
    required: boolean;
  }[];
  for (const d of defs) {
    const value = input.params[d.name] ?? d.defaultValue;
    if (d.required && !value) {
      throw new DomainError(ErrCode.VALIDATION_FAILED, `必填参数缺值：${d.name}`);
    }
    if (value) input.vars[`param.${d.name}`] = value;
  }
  try {
    return await runScriptDebug(s.content, input.vars);
  } catch (err) {
    if (err instanceof ScriptDebugError) {
      throw new DomainError(ErrCode.SCRIPT_DEBUG_FAILED, err.message);
    }
    throw err;
  }
}

// ── 构建期引用展开（exec.service / buildEnvSnapshot 消费；engine 无感知）──

/** scriptRef 处理器展开为内联脚本：参数注入 vars（显式 > 默认值，vars 前缀 param.）。 */
export async function resolveScriptRefs(
  projectId: string,
  processors: Processor[],
): Promise<Processor[]> {
  const refIds = [
    ...new Set(
      processors.flatMap((p) => (p.kind === "script" && p.scriptRef ? [p.scriptRef.scriptId] : [])),
    ),
  ];
  if (refIds.length === 0) return processors;
  const scripts = await prisma.publicScript.findMany({
    where: { id: { in: refIds }, projectId, deletedAt: null },
  });
  const byId = new Map(scripts.map((s) => [s.id, s]));
  return Promise.all(
    processors.map(async (p) => {
      if (p.kind !== "script" || !p.scriptRef) return p;
      const { scriptRef } = p;
      const s = byId.get(scriptRef.scriptId);
      if (!s || s.status !== "ENABLED") {
        throw new DomainError(
          ErrCode.SCRIPT_INVALID_REF,
          `引用的公共脚本不存在或未发布：${s?.name ?? scriptRef.scriptId.slice(0, 8)}`,
        );
      }
      const defs = (Array.isArray(s.params) ? s.params : []) as {
        name: string;
        defaultValue: string;
      }[];
      const prologue: string[] = [
        `// [public-script] ${s.name}（引用展开，编辑请回项目设置-公共脚本）`,
        ...defs
          .map((d) => {
            const value = scriptRef.params[d.name] ?? d.defaultValue;
            return value ? `setVar("param.${d.name}", ${JSON.stringify(value)});` : "";
          })
          .filter(Boolean),
      ];
      return { kind: "script", script: [...prologue, s.content].join("\n") } as Processor;
    }),
  );
}

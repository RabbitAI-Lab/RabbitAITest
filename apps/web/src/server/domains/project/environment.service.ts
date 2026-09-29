/** PROJ-003 环境管理：CRUD/复制/导入导出/数据源测试 + 执行快照构建（API-004 消费）。 */
import { DomainError, ErrCode } from "@rabbit/shared";
import type { EnvSnapshot } from "@rabbit/shared/execution";
import { environmentConfigSchema } from "@rabbit/shared";
import type { z } from "zod";
import { prisma } from "@rabbit/db";
import type { Prisma, Environment } from "@prisma/client";
import { runnerCall } from "@/server/plugin-runner.client";

type EnvConfig = z.infer<typeof environmentConfigSchema>;

/** 兼容旧数据的宽松读：无 config 结构的旧环境按空配置处理。 */
export function readConfig(env: Environment): EnvConfig {
  const parsed = environmentConfigSchema.safeParse(env.config ?? {});
  return parsed.success ? parsed.data : environmentConfigSchema.parse({});
}

function serialize(env: Environment) {
  return {
    id: env.id,
    name: env.name,
    config: readConfig(env),
    createdAt: env.createdAt.toISOString(),
    updatedAt: env.updatedAt.toISOString(),
  };
}

export async function listEnvironments(projectId: string) {
  const [total, items] = await Promise.all([
    prisma.environment.count({ where: { projectId, deletedAt: null } }),
    prisma.environment.findMany({
      where: { projectId, deletedAt: null },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  return {
    total,
    items: items.map((e) => serialize(e)),
  };
}

async function getEnv(projectId: string, id: string): Promise<Environment> {
  const env = await prisma.environment.findFirst({
    where: { id, projectId, deletedAt: null },
  });
  if (!env) throw new DomainError(ErrCode.ENV_NOT_FOUND, "环境不存在或已删除");
  return env;
}

export async function createEnvironment(
  projectId: string,
  _userId: string,
  input: { name: string; config: EnvConfig },
) {
  // 环境无独立 num 展示需求（列表按时间序）；名称项目内唯一为软约束（导入覆盖依赖）
  const env = await prisma.environment.create({
    data: {
      projectId,
      name: input.name,
      config: input.config as unknown as Prisma.InputJsonValue,
    },
  });
  return serialize(env);
}

export async function getEnvironment(projectId: string, id: string) {
  return serialize(await getEnv(projectId, id));
}

export async function updateEnvironment(
  projectId: string,
  id: string,
  input: Partial<{ name: string; config: EnvConfig }>,
) {
  const env = await getEnv(projectId, id);
  const updated = await prisma.environment.update({
    where: { id: env.id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.config !== undefined
        ? { config: input.config as unknown as Prisma.InputJsonValue }
        : {}),
    },
  });
  return serialize(updated);
}

export async function deleteEnvironment(projectId: string, id: string) {
  const env = await getEnv(projectId, id);
  await prisma.environment.update({ where: { id: env.id }, data: { deletedAt: new Date() } });
  return { id };
}

export async function copyEnvironment(projectId: string, id: string) {
  const env = await getEnv(projectId, id);
  const created = await prisma.environment.create({
    data: {
      projectId,
      name: `${env.name}_copy`,
      config: env.config as unknown as Prisma.InputJsonValue,
    },
  });
  return serialize(created);
}

export async function exportEnvironment(projectId: string, id: string) {
  const env = await getEnv(projectId, id);
  return { name: env.name, config: readConfig(env) };
}

/** 导入：全量合法才落库（PROJ-003 §2）；同名覆盖=true 更新、false 跳过并计数。 */
export async function importEnvironments(
  projectId: string,
  _userId: string,
  input: { overwrite: boolean; payload: { name: string; config: EnvConfig }[] },
) {
  const report = { imported: 0, overwritten: 0, skipped: 0 };
  await prisma.$transaction(async (tx) => {
    for (const item of input.payload) {
      const existing = await tx.environment.findFirst({
        where: { projectId, name: item.name, deletedAt: null },
        select: { id: true },
      });
      if (existing) {
        if (!input.overwrite) {
          report.skipped += 1;
          continue;
        }
        await tx.environment.update({
          where: { id: existing.id },
          data: { config: item.config as unknown as Prisma.InputJsonValue },
        });
        report.overwritten += 1;
      } else {
        await tx.environment.create({
          data: {
            projectId,
            name: item.name,
            config: item.config as unknown as Prisma.InputJsonValue,
          },
        });
        report.imported += 1;
      }
    }
  });
  return report;
}

/** 数据源连接测试（PLUG-004：PG 内置直连；其余四家经已启用驱动插件走 plugin-runner call）。
 *  连接失败不是 500：统一由调用方 catch 后转 {ok:false,message}。 */
export async function testDatasource(
  driver: "postgresql" | "mysql" | "oracle" | "sqlserver" | "dm",
  url: string,
): Promise<{ ok: boolean; message: string }> {
  if (driver === "postgresql") {
    const pg = await import("pg").then(
      (m) => new m.default.Client({ connectionString: url, connectionTimeoutMillis: 3000 }),
    );
    try {
      await pg.connect();
      await pg.query("SELECT 1");
      return { ok: true, message: "连接成功" };
    } finally {
      await pg.end().catch(() => {});
    }
  }
  const plugin = await prisma.plugin.findFirst({
    where: { kind: "driver", name: driver, enabled: true },
  });
  if (!plugin) {
    throw new Error(
      `驱动插件未启用：请先在 系统设置 → 插件管理 上传并启用 ${driver} 驱动（PLUG-004）`,
    );
  }
  await runnerCall(plugin.id, "testConnection", [{ url }]);
  return { ok: true, message: "连接成功" };
}

/** 执行快照构建（任务下发时调用；engine 无 DB，全部运行时配置经此注入，API-004 §4）。 */
export async function buildEnvSnapshot(
  projectId: string,
  envId: string | undefined,
): Promise<EnvSnapshot | undefined> {
  const globalParam = await prisma.globalParam.findUnique({ where: { projectId } });
  const globalVars = (globalParam?.params as Record<string, string> | null) ?? {};
  if (!envId) {
    // 未选环境：仅注入全局参数（相对 URL 请求将在 engine 侧 422→CONFIG_ERROR）
    if (Object.keys(globalVars).length === 0) return undefined;
    return {
      vars: globalVars,
      http: [],
      hosts: [],
      database: [],
      pre: [],
      post: [],
      asserts: [],
      extracts: [],
    };
  }
  const env = await getEnv(projectId, envId);
  const cfg = readConfig(env);
  const vars: Record<string, string> = { ...globalVars };
  for (const v of cfg.vars) if (v.enabled) vars[v.key] = v.value;
  // S5 PROJ-005：环境全局前后置 scriptRef 构建期展开（engine 无感知）
  const { resolveScriptRefs } = await import("./public-script.service");
  return {
    vars,
    http: cfg.http,
    hosts: cfg.hosts,
    database: cfg.database,
    pre: await resolveScriptRefs(projectId, cfg.pre),
    post: await resolveScriptRefs(projectId, cfg.post),
    asserts: cfg.asserts,
    extracts: cfg.extracts,
  };
}

// ── S5 PROJ-006：环境组 + 全局参数 ──

import { ENV_GROUP_LIMIT, type EnvGroupUpsertInput } from "@rabbit/shared";

const toJson2 = (v: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(v ?? {})) as Prisma.InputJsonValue;

export async function listEnvGroups(projectId: string) {
  const [total, items] = await Promise.all([
    prisma.envGroup.count({ where: { projectId } }),
    prisma.envGroup.findMany({ where: { projectId }, orderBy: { createdAt: "asc" } }),
  ]);
  return {
    total,
    items: items.map((g) => ({
      id: g.id,
      name: g.name,
      environmentIds: g.environmentIds as string[],
      createdAt: g.createdAt.toISOString(),
    })),
  };
}

async function validateGroupEnvs(projectId: string, environmentIds: string[]) {
  const unique = [...new Set(environmentIds)];
  if (unique.length === 0)
    throw new DomainError(ErrCode.VALIDATION_FAILED, "环境组至少包含一个环境");
  const envs = await prisma.environment.findMany({
    where: { id: { in: unique }, projectId, deletedAt: null },
    select: { id: true },
  });
  if (envs.length !== unique.length) {
    throw new DomainError(ErrCode.VALIDATION_FAILED, "包含不存在或已删除的环境");
  }
  return unique;
}

export async function createEnvGroup(projectId: string, input: EnvGroupUpsertInput) {
  const count = await prisma.envGroup.count({ where: { projectId } });
  if (count >= ENV_GROUP_LIMIT) {
    throw new DomainError(
      ErrCode.VALIDATION_FAILED,
      `环境组数量超出上限（${ENV_GROUP_LIMIT}/项目）`,
    );
  }
  const dup = await prisma.envGroup.findFirst({
    where: { projectId, name: input.name },
    select: { id: true },
  });
  if (dup) throw new DomainError(ErrCode.VALIDATION_FAILED, "环境组名称已存在");
  const environmentIds = await validateGroupEnvs(projectId, input.environmentIds);
  const g = await prisma.envGroup.create({
    data: { projectId, name: input.name, environmentIds: toJson2(environmentIds) },
  });
  return { id: g.id, name: g.name, environmentIds };
}

export async function updateEnvGroup(projectId: string, id: string, input: EnvGroupUpsertInput) {
  const existing = await prisma.envGroup.findFirst({ where: { id, projectId } });
  if (!existing) throw new DomainError(ErrCode.ENV_GROUP_NOT_FOUND, "环境组不存在");
  const dup = await prisma.envGroup.findFirst({
    where: { projectId, name: input.name, id: { not: id } },
    select: { id: true },
  });
  if (dup) throw new DomainError(ErrCode.VALIDATION_FAILED, "环境组名称已存在");
  const environmentIds = await validateGroupEnvs(projectId, input.environmentIds);
  await prisma.envGroup.update({
    where: { id },
    data: { name: input.name, environmentIds: toJson2(environmentIds) },
  });
  return { id, name: input.name, environmentIds };
}

/** 组删除=物理删（表无软删列；轻量编排对象，PROJ-006 §2 登记）。 */
export async function deleteEnvGroup(projectId: string, id: string) {
  const existing = await prisma.envGroup.findFirst({ where: { id, projectId } });
  if (!existing) throw new DomainError(ErrCode.ENV_GROUP_NOT_FOUND, "环境组不存在");
  await prisma.envGroup.delete({ where: { id } });
  return { id };
}

/** 组展开：过滤软删环境，保序；全失效 → 422 ENV_GROUP_EMPTY。 */
export async function expandEnvGroup(projectId: string, id: string) {
  const g = await prisma.envGroup.findFirst({ where: { id, projectId } });
  if (!g) throw new DomainError(ErrCode.ENV_GROUP_NOT_FOUND, "环境组不存在");
  const ids = (g.environmentIds as string[]) ?? [];
  const envs = ids.length
    ? await prisma.environment.findMany({
        where: { id: { in: ids }, projectId, deletedAt: null },
        select: { id: true, name: true },
      })
    : [];
  const byId = new Map(envs.map((e) => [e.id, e]));
  const resolved = ids
    .map((id2) => byId.get(id2))
    .filter((e): e is { id: string; name: string } => Boolean(e));
  if (resolved.length === 0) throw new DomainError(ErrCode.ENV_GROUP_EMPTY, "环境组内没有可用环境");
  return { groupId: g.id, name: g.name, environments: resolved };
}

// ── 全局参数（项目级单例；buildEnvSnapshot 合并逻辑既有）──

export async function getGlobalParams(projectId: string) {
  const row = await prisma.globalParam.findUnique({ where: { projectId } });
  const params = (row?.params as Record<string, string> | null) ?? {};
  return {
    params: Object.entries(params).map(([key, value]) => ({ key, value, description: "" })),
  };
}

export async function upsertGlobalParams(
  projectId: string,
  input: { params: { key: string; value: string; description: string }[] },
) {
  const seen = new Set<string>();
  const record: Record<string, string> = {};
  for (const p of input.params) {
    if (seen.has(p.key)) throw new DomainError(ErrCode.VALIDATION_FAILED, `全局参数重名：${p.key}`);
    seen.add(p.key);
    record[p.key] = p.value;
  }
  await prisma.globalParam.upsert({
    where: { projectId },
    update: { params: toJson2(record) },
    create: { projectId, params: toJson2(record) },
  });
  return { params: input.params };
}

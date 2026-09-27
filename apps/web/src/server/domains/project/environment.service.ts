/** PROJ-003 环境管理：CRUD/复制/导入导出/数据源测试 + 执行快照构建（API-004 消费）。 */
import { DomainError, ErrCode } from "@rabbit/shared";
import type { EnvSnapshot } from "@rabbit/shared/execution";
import { environmentConfigSchema } from "@rabbit/shared";
import type { z } from "zod";
import { prisma } from "@rabbit/db";
import type { Prisma, Environment } from "@prisma/client";

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

/** PostgreSQL 连接测试（超时 3s；仅校验连通，不落任何数据）。 */
export async function testDatasource(url: string): Promise<{ ok: boolean; message: string }> {
  const pg = await import("pg").then((m) => new m.default.Client({ connectionString: url, connectionTimeoutMillis: 3000 }));
  try {
    await pg.connect();
    await pg.query("SELECT 1");
    return { ok: true, message: "连接成功" };
  } finally {
    await pg.end().catch(() => {});
  }
}

/** 执行快照构建（任务下发时调用；engine 无 DB，全部运行时配置经此注入，API-004 §4）。 */
export async function buildEnvSnapshot(projectId: string, envId: string | undefined): Promise<EnvSnapshot | undefined> {
  const globalParam = await prisma.globalParam.findUnique({ where: { projectId } });
  const globalVars = (globalParam?.params as Record<string, string> | null) ?? {};
  if (!envId) {
    // 未选环境：仅注入全局参数（相对 URL 请求将在 engine 侧 422→CONFIG_ERROR）
    if (Object.keys(globalVars).length === 0) return undefined;
    return { vars: globalVars, http: [], hosts: [], database: [], pre: [], post: [], asserts: [], extracts: [] };
  }
  const env = await getEnv(projectId, envId);
  const cfg = readConfig(env);
  const vars: Record<string, string> = { ...globalVars };
  for (const v of cfg.vars) if (v.enabled) vars[v.key] = v.value;
  return {
    vars,
    http: cfg.http,
    hosts: cfg.hosts,
    database: cfg.database,
    pre: cfg.pre,
    post: cfg.post,
    asserts: cfg.asserts,
    extracts: cfg.extracts,
  };
}

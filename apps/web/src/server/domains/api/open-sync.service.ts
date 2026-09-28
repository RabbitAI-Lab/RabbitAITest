/** 外部工具同步与采集（S-future TOOL-001/TOOL-002 §2）。
 * IDEA 插件 api-sync=批量 upsert（幂等键 projectId+method+path，软删视为不存在→新建复活）；
 * 浏览器插件 api-capture=抓包导入（skip-if-exists 不 bump version，敏感头脱敏）。
 * 定义域无 description/tags 列（API-002 域模型），来源/描述以变更历史 action 承载（规格 §8 勘误 1）。 */
import { DomainError, ErrCode } from "@rabbit/shared";
import type { OpenApiCaptureInput, OpenApiSyncInput } from "@rabbit/shared";
import { CAPTURE_REDACT_HEADERS } from "@rabbit/shared";
import { nextNum, prisma } from "@rabbit/db";
import type { Prisma } from "@rabbit/db";

interface SpecFragment {
  headers?: Record<string, string>;
  query?: Record<string, string>;
  body?: { kind: "text" | "json"; text: string };
}

function toKv(record: Record<string, string> | undefined, redact = false) {
  if (!record) return undefined;
  return Object.entries(record).map(([key, value]) => ({
    key,
    value: redact && CAPTURE_REDACT_HEADERS.includes(key.toLowerCase() as never) ? "***" : value,
    enabled: true,
  }));
}

/** 最小 RequestBundle 构造（断言/前后置/提取空集；走默认值由落库前不二次 parse——以本函数构造保证形状） */
function buildSpec(method: string, path: string, frag: SpecFragment, redact: boolean) {
  return {
    method,
    url: path,
    headers: toKv(frag.headers, redact) ?? [],
    query: toKv(frag.query, redact) ?? [],
    body: frag.body
      ? {
          kind: frag.body.kind === "json" ? ("raw_json" as const) : ("raw_text" as const),
          content: frag.body.text,
        }
      : { kind: "none" as const, content: "" },
  };
}

async function rootApiModuleId(projectId: string): Promise<string> {
  const m = await prisma.moduleNode.findFirst({
    where: { projectId, scene: "api", isDefault: true },
    select: { id: true },
  });
  if (!m) throw new DomainError(ErrCode.MODULE_NOT_FOUND, "项目缺少默认接口模块");
  return m.id;
}

/** TOOL-001 §2：批量 upsert。全量先校验（批内重复 10023）后单事务写入（原子，不部分成功）。 */
export async function syncApiDefinitions(userId: string, input: OpenApiSyncInput) {
  const seen = new Set<string>();
  for (const a of input.apis) {
    const key = `${a.method} ${a.path}`;
    if (seen.has(key))
      throw new DomainError(ErrCode.OPEN_SYNC_VALIDATION_FAILED, `批内重复接口：${key}`);
    seen.add(key);
  }
  const existing = await prisma.apiDefinition.findMany({
    where: { projectId: input.projectId, deletedAt: null },
    select: { id: true, method: true, path: true, request: true, name: true, version: true },
  });
  const byKey = new Map(existing.map((e) => [`${e.method} ${e.path}`, e]));
  const moduleId = await rootApiModuleId(input.projectId);

  const items: Array<{
    apiId: string;
    num: number;
    method: string;
    path: string;
    action: "created" | "updated";
  }> = [];
  let created = 0;
  let updated = 0;
  await prisma.$transaction(async (tx) => {
    for (const a of input.apis) {
      const key = `${a.method} ${a.path}`;
      const hit = byKey.get(key);
      if (hit) {
        const oldReq = hit.request as {
          spec?: { headers?: unknown[]; query?: unknown[]; body?: unknown };
        };
        const spec = buildSpec(a.method, a.path, a.request ?? {}, false);
        // 片段合并：未提供的部分保留旧值（TOOL-001 §2 更新语义）
        const mergedSpec = {
          ...spec,
          headers: a.request?.headers
            ? spec.headers
            : ((oldReq.spec?.headers as typeof spec.headers) ?? []),
          query: a.request?.query ? spec.query : ((oldReq.spec?.query as typeof spec.query) ?? []),
          body: a.request?.body
            ? spec.body
            : ((oldReq.spec?.body as typeof spec.body) ?? { kind: "none" as const, content: "" }),
        };
        const u = await tx.apiDefinition.update({
          where: { id: hit.id },
          data: {
            name: a.name,
            version: { increment: 1 },
            request: { spec: mergedSpec } as unknown as Prisma.InputJsonValue,
          },
          select: { id: true, num: true, method: true, path: true },
        });
        await tx.changeLog.create({
          data: {
            entityType: "api_definition",
            entityId: u.id,
            seq:
              (await tx.changeLog.count({
                where: { entityType: "api_definition", entityId: u.id },
              })) + 1,
            action: "update",
            userId,
            diff: { before: { name: hit.name }, after: { name: a.name, source: "idea-sync" } },
          },
        });
        items.push({ apiId: u.id, num: u.num, method: u.method, path: u.path, action: "updated" });
        updated += 1;
      } else {
        const num = await nextNum(tx, "api_definitions", input.projectId);
        const c = await tx.apiDefinition.create({
          data: {
            projectId: input.projectId,
            moduleId,
            num,
            protocol: "HTTP",
            method: a.method,
            path: a.path,
            name: a.name,
            status: "DEBUG",
            request: {
              spec: buildSpec(a.method, a.path, a.request ?? {}, false),
            } as unknown as Prisma.InputJsonValue,
            createdBy: userId,
          },
          select: { id: true, num: true, method: true, path: true },
        });
        await tx.changeLog.create({
          data: {
            entityType: "api_definition",
            entityId: c.id,
            seq: 1,
            action: "create",
            userId,
            diff: { after: { name: a.name, method: a.method, path: a.path, source: "idea-sync" } },
          },
        });
        items.push({ apiId: c.id, num: c.num, method: c.method, path: c.path, action: "created" });
        created += 1;
      }
    }
  });
  return { items, created, updated };
}

/** TOOL-001 §4：插件侧对账回读（分页信封）。 */
export async function listApiDefinitionsForOpen(
  projectId: string,
  query: { keyword?: string; page: number; pageSize: number },
) {
  const where = {
    projectId,
    deletedAt: null,
    ...(query.keyword ? { name: { contains: query.keyword } } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.apiDefinition.count({ where }),
    prisma.apiDefinition.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      select: {
        id: true,
        num: true,
        name: true,
        protocol: true,
        method: true,
        path: true,
        updatedAt: true,
      },
    }),
  ]);
  return {
    total,
    items: rows.map((r) => ({
      apiId: r.id,
      num: r.num,
      name: r.name,
      protocol: r.protocol,
      method: r.method,
      path: r.path,
      updatedAt: r.updatedAt.toISOString(),
    })),
  };
}

/** TOOL-002 §2：采集导入（跳过语义：同 (method,path) 已存在（含软删）→ skipped，不 bump version）。 */
export async function captureApiDefinitions(userId: string, input: OpenApiCaptureInput) {
  const existing = await prisma.apiDefinition.findMany({
    where: { projectId: input.projectId },
    select: { method: true, path: true },
  });
  const existingKeys = new Set(existing.map((e) => `${e.method} ${e.path}`));
  const moduleId = await rootApiModuleId(input.projectId);
  const items: Array<{
    apiId?: string;
    method: string;
    path: string;
    action: "created" | "skipped";
  }> = [];
  let created = 0;
  let skipped = 0;
  await prisma.$transaction(async (tx) => {
    for (const r of input.requests) {
      const u = new URL(r.url);
      const path = `${u.pathname}${u.search}`.slice(0, 1024) || "/";
      const key = `${r.method} ${path}`;
      if (existingKeys.has(key)) {
        items.push({ method: r.method, path, action: "skipped" });
        skipped += 1;
        continue;
      }
      existingKeys.add(key);
      const seg = u.pathname.split("/").filter(Boolean).pop() ?? "root";
      const name = `${r.method} /${seg}`.slice(0, 512);
      // URL query 逐键拆进 spec.query（TOOL-002 §2：host 丢弃由环境承载，query 保留）
      const query = [...u.searchParams.entries()].map(([k, v]) => ({
        key: k,
        value: v,
        enabled: true,
      }));
      const spec = { ...buildSpec(r.method, path, r, true), query };
      const num = await nextNum(tx, "api_definitions", input.projectId);
      const c = await tx.apiDefinition.create({
        data: {
          projectId: input.projectId,
          moduleId,
          num,
          protocol: "HTTP",
          method: r.method,
          path,
          name,
          status: "DEBUG",
          request: { spec } as unknown as Prisma.InputJsonValue,
          createdBy: userId,
        },
        select: { id: true },
      });
      await tx.changeLog.create({
        data: {
          entityType: "api_definition",
          entityId: c.id,
          seq: 1,
          action: "create",
          userId,
          diff: {
            after: {
              name,
              method: r.method,
              path,
              source: "browser-capture",
              host: u.host, // 来源域名以变更历史承载（域模型无 description 列）
            },
          },
        },
      });
      items.push({ apiId: c.id, method: r.method, path, action: "created" });
      created += 1;
    }
  });
  return { items, created, skipped };
}

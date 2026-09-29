/** API-002 导入导出：OpenAPI3 / Postman v2.1 / Rabbit 自有格式 三解析器（纯函数，单测覆盖）+ cURL 解析。 */
import { DomainError, ErrCode } from "@rabbit/shared";
import type { z } from "zod";
import { apiRequestBundleSchema, rabbitApiExportFile } from "@rabbit/shared";
import type { ApiRequestBundle } from "@rabbit/shared";
import type { RequestSpec } from "@rabbit/shared/execution";

export interface ParsedApi {
  name: string;
  method: string;
  path: string;
  status?: "DEBUG" | "RELEASED";
  tags?: string[];
  request: ApiRequestBundle;
  response?: { status: number; headers: { key: string; value: string }[]; body: string };
  cases?: ParsedApiCase[];
  mocks?: {
    name: string;
    enabled: boolean;
    followApi: boolean;
    matchers: {
      headers: { key: string; value: string }[];
      query: { key: string; value: string }[];
      bodyContains?: string;
    };
    response: {
      status: number;
      headers: { key: string; value: string }[];
      body: string;
      delayMs: number;
    };
  }[];
  error?: string; // 行级错误（校验报告）
}
export interface ParsedApiCase {
  name: string;
  level?: "P0" | "P1" | "P2" | "P3";
  status?: "PREPARE" | "UNDERWAY" | "COMPLETED";
  tags?: string[];
  request: ApiRequestBundle;
}

function bundle(spec: Partial<RequestSpec>, extra?: Partial<ApiRequestBundle>): ApiRequestBundle {
  const full = {
    spec: {
      method: spec.method ?? "GET",
      url: spec.url ?? "/",
      headers: spec.headers ?? [],
      query: spec.query ?? [],
      body: spec.body ?? { kind: "raw_json", content: "" },
      auth: spec.auth ?? { kind: "none" },
      timeoutMs: spec.timeoutMs ?? 60000,
      followRedirects: spec.followRedirects ?? false,
      skipPre: spec.skipPre ?? false,
      skipPost: spec.skipPost ?? false,
    },
    asserts: extra?.asserts ?? [],
    pre: extra?.pre ?? [],
    post: extra?.post ?? [],
    extracts: extra?.extracts ?? [],
  };
  return apiRequestBundleSchema.parse(full);
}

/** OpenAPI 3.x（json 或 yaml；yaml 用 js-yaml 由调用方先转 json 对象亦可——此处统一收 string 自解析）。 */
export function parseOpenApi3(raw: string): {
  apis: ParsedApi[];
  errors: { line: number; message: string }[];
} {
  let doc: Record<string, unknown>;
  try {
    doc = JSON.parse(raw);
  } catch {
    // yaml：极简解析器不引入——OpenAPI URL/文件场景以 json 为主；yaml 交给 js-yaml（web 已有依赖树则用）
    throw new DomainError(
      ErrCode.API_IMPORT_INVALID,
      "OpenAPI 内容必须是合法 JSON（YAML 请先转换为 JSON）",
    );
  }
  const errors: { line: number; message: string }[] = [];
  const apis: ParsedApi[] = [];
  const openapi = String(doc.openapi ?? "");
  if (!openapi.startsWith("3.")) {
    throw new DomainError(
      ErrCode.API_IMPORT_INVALID,
      "仅支持 OpenAPI 3.x（当前 " + (openapi || "未识别") + "）",
    );
  }
  const paths = (doc.paths ?? {}) as Record<string, Record<string, unknown>>;
  let line = 0;
  for (const [path, item] of Object.entries(paths)) {
    line += 1;
    if (path.startsWith("x-") || typeof item !== "object" || item === null) continue;
    for (const [method, op] of Object.entries(item)) {
      if (!["get", "put", "post", "delete", "patch", "head", "options"].includes(method)) continue;
      if (method === "trace") continue;
      const o = op as Record<string, unknown>;
      try {
        const parameters = (o.parameters ?? []) as {
          in: string;
          name: string;
          example?: unknown;
          schema?: { example?: unknown; default?: unknown };
        }[];
        const query = parameters
          .filter((p) => p.in === "query")
          .map((p) => ({
            key: p.name,
            value: String(p.example ?? p.schema?.example ?? p.schema?.default ?? ""),
            enabled: true,
          }));
        const headers = parameters
          .filter((p) => p.in === "header")
          .map((p) => ({
            key: p.name,
            value: String(p.example ?? p.schema?.example ?? p.schema?.default ?? ""),
            enabled: true,
          }));
        const requestBody = o.requestBody as
          | {
              content?: Record<
                string,
                { example?: unknown; examples?: Record<string, { value: unknown }> }
              >;
            }
          | undefined;
        let body: RequestSpec["body"] = { kind: "none" };
        const content = requestBody?.content ?? {};
        const jsonType = Object.keys(content).find((k) => k.includes("json"));
        if (jsonType) {
          const ex =
            content[jsonType]?.example ??
            Object.values(content[jsonType]?.examples ?? {})[0]?.value;
          body = {
            kind: "raw_json",
            content: ex === undefined ? "" : JSON.stringify(ex, null, 2),
          };
        } else if (Object.keys(content).length > 0) {
          body = { kind: "raw_text", content: "" };
        }
        const methodUpper = method.toUpperCase();
        apis.push({
          name: String(o.summary ?? o.operationId ?? `${methodUpper} ${path}`).slice(0, 512),
          method: methodUpper,
          path,
          request: bundle({
            method: methodUpper as RequestSpec["method"],
            url: path.slice(0, 2048),
            query,
            headers,
            body,
          }),
        });
      } catch (e) {
        errors.push({
          line,
          message: `${method.toUpperCase()} ${path}: ${e instanceof Error ? e.message : String(e)}`,
        });
      }
    }
  }
  if (apis.length === 0 && errors.length === 0)
    throw new DomainError(ErrCode.API_IMPORT_INVALID, "未解析到任何接口（paths 为空）");
  return { apis, errors };
}

/** Postman Collection v2.1。 */
export function parsePostman(raw: string): {
  apis: ParsedApi[];
  errors: { line: number; message: string }[];
} {
  let doc: Record<string, unknown>;
  try {
    doc = JSON.parse(raw);
  } catch {
    throw new DomainError(ErrCode.API_IMPORT_INVALID, "Postman Collection 必须是合法 JSON");
  }
  const info = doc.info as { schema?: string } | undefined;
  if (!info || !String(info.schema ?? "").includes("v2.1")) {
    throw new DomainError(ErrCode.API_IMPORT_INVALID, "仅支持 Postman Collection v2.1");
  }
  const apis: ParsedApi[] = [];
  const errors: { line: number; message: string }[] = [];
  let line = 0;
  const walk = (items: unknown[]) => {
    for (const it of items) {
      const item = it as {
        item?: unknown[];
        request?: {
          method?: string;
          url?: unknown;
          header?: { key: string; value: string }[];
          body?: { mode?: string; raw?: string; options?: { raw?: { language?: string } } };
        };
        name?: string;
      };
      if (Array.isArray(item.item)) {
        walk(item.item);
        continue;
      }
      line += 1;
      try {
        const req = item.request;
        if (!req) throw new Error("缺少 request");
        const method = String(req.method ?? "GET").toUpperCase();
        const urlRaw =
          typeof req.url === "string"
            ? req.url
            : // Postman url 对象 → 绝对 URL 字符串（host/path 段拼接，非文件路径；随后经 safeUrl 协议白名单）
              `${((req.url as { protocol?: string; host?: unknown[]; path?: unknown[]; port?: string }) ?? {}).protocol ?? "https"}://` +
              hostOf(req.url) +
              ((u) => {
                const p = Array.isArray(u?.path) ? "/" + u.path.join("/") : String(u?.path ?? "/");
                return p.startsWith("/") ? p : `/${p}`;
              })(req.url as { path?: unknown[] } | undefined);
        const u = safeUrl(urlRaw);
        const query = Array.isArray(
          (req.url as { query?: { key: string; value: string }[] })?.query,
        )
          ? ((req.url as { query?: { key: string; value: string }[] }).query ?? []).map((q) => ({
              key: q.key,
              value: q.value,
              enabled: true,
            }))
          : [];
        const bodyMode = req.body?.mode;
        let body: RequestSpec["body"] = { kind: "none" };
        if (bodyMode === "raw" && req.body?.raw) {
          const lang = req.body.options?.raw?.language;
          body =
            lang === "xml"
              ? { kind: "raw_xml", content: req.body.raw }
              : lang === "text"
                ? { kind: "raw_text", content: req.body.raw }
                : { kind: "raw_json", content: req.body.raw };
        } else if (bodyMode === "urlencoded") {
          body = { kind: "form_urlencoded", rows: [] };
        } else if (bodyMode === "formdata") {
          body = { kind: "form_data", rows: [] };
        }
        apis.push({
          name: String(item.name ?? `${method} ${u.pathname}`).slice(0, 512),
          method,
          path: (u.pathname + (u.queryString ? `?${u.queryString}` : "")).slice(0, 2048),
          request: bundle({
            method: method as RequestSpec["method"],
            url: (u.pathname + (u.queryString ? `?${u.queryString}` : "")).slice(0, 2048),
            headers: (req.header ?? []).map((h) => ({ key: h.key, value: h.value, enabled: true })),
            query,
            body,
          }),
        });
      } catch (e) {
        errors.push({
          line,
          message: `${item.name ?? "(未命名)"}: ${e instanceof Error ? e.message : String(e)}`,
        });
      }
    }
  };
  walk((doc.item ?? []) as unknown[]);
  if (apis.length === 0 && errors.length === 0)
    throw new DomainError(ErrCode.API_IMPORT_INVALID, "未解析到任何请求（item 为空）");
  return { apis, errors };
}

function hostOf(url: unknown): string {
  const u = url as { host?: unknown[] } | undefined;
  return Array.isArray(u?.host) ? u.host.join(".") : String(u?.host ?? "localhost");
}
/** 导入 URL 解析：仅放行 http(s)（协议白名单——file:/data: 等非常规协议按条目级导入失败上报），
 *  相对路径（Postman 常见 host 变量形态）走降级分支保留原文。 */
function safeUrl(raw: string): { pathname: string; queryString: string } {
  let u: URL | undefined;
  try {
    u = new URL(raw);
  } catch {
    u = undefined;
  }
  if (u && u.protocol !== "http:" && u.protocol !== "https:")
    throw new DomainError(
      ErrCode.API_IMPORT_INVALID,
      `不支持的协议 ${u.protocol}（仅 http/https）`,
    );
  if (!u) {
    const i = raw.indexOf("?");
    return i >= 0
      ? { pathname: raw.slice(0, i), queryString: raw.slice(i + 1) }
      : { pathname: raw, queryString: "" };
  }
  return { pathname: u.pathname, queryString: u.search.replace(/^\?/, "") };
}

/** Rabbit 自有格式（导出 roundtrip）。 */
export function parseRabbit(raw: string): {
  apis: ParsedApi[];
  errors: { line: number; message: string }[];
} {
  let doc: unknown;
  try {
    doc = JSON.parse(raw);
  } catch {
    throw new DomainError(ErrCode.API_IMPORT_INVALID, "Rabbit 格式必须是合法 JSON");
  }
  const parsed = rabbitApiExportFile.safeParse(doc);
  if (!parsed.success)
    throw new DomainError(
      ErrCode.API_IMPORT_INVALID,
      "Rabbit 格式校验失败：" + parsed.error.issues[0]?.message,
    );
  const errors: { line: number; message: string }[] = [];
  const apis: ParsedApi[] = parsed.data.apis
    .map((a, i) => ({
      name: a.name,
      method: a.request.spec.method,
      path: a.request.spec.url.slice(0, 2048),
      status: a.status,
      tags: a.tags,
      request: a.request,
      response: a.response,
      cases: a.cases.map((c) => ({
        name: c.name,
        level: c.level,
        status: c.status,
        tags: c.tags,
        request: c.request,
      })),
      mocks: a.mocks,
      error: undefined as string | undefined,
    }))
    .map((a, idx) => {
      if (!a.request.spec.url.startsWith("/")) {
        errors.push({ line: idx + 1, message: `${a.name}: url 应为相对路径` });
        return { ...a, error: "url 应为相对路径" };
      }
      return a;
    });
  return { apis, errors };
}

/** cURL 解析（API-001 去向承接）：`curl [-X m] [-H k:v]... [-d|--data-raw body] url`。 */
export function parseCurl(curl: string): ParsedApi {
  const tokens = curl
    .trim()
    .replace(/^curl\s+/i, "")
    .match(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^\s]+/g);
  if (!tokens || tokens.length === 0)
    throw new DomainError(ErrCode.API_IMPORT_INVALID, "无法解析 cURL 命令");
  const unquote = (t: string) =>
    (t.startsWith('"') || t.startsWith("'")) && t.length > 1 ? t.slice(1, -1) : t;
  let method = "GET";
  let url = "";
  const headers: { key: string; value: string; enabled: boolean }[] = [];
  let data: string | undefined;
  let contentType: string | undefined;
  for (let i = 0; i < tokens.length; i++) {
    const t = unquote(tokens[i] ?? "");
    if (t === "-X" || t === "--request") {
      const mt = tokens[++i];
      method = (mt !== undefined ? unquote(mt) : "GET").toUpperCase();
    } else if (t === "-H" || t === "--header") {
      const ht = tokens[++i];
      const h = ht !== undefined ? unquote(ht) : "";
      const idx = h.indexOf(":");
      if (idx > 0) {
        const key = h.slice(0, idx).trim();
        const value = h.slice(idx + 1).trim();
        if (key.toLowerCase() === "content-type") contentType = value;
        else headers.push({ key, value, enabled: true });
      }
    } else if (t === "-d" || t === "--data" || t === "--data-raw" || t === "--data-binary") {
      const dt = tokens[++i];
      data = dt !== undefined ? unquote(dt) : "";
      if (method === "GET") method = "POST";
    } else if (!t.startsWith("-") && !url) {
      url = t;
    }
  }
  if (!url) throw new DomainError(ErrCode.API_IMPORT_INVALID, "cURL 缺少 URL");
  let body: RequestSpec["body"] = { kind: "none" };
  if (data !== undefined) {
    const isJson =
      contentType?.includes("json") ||
      (/^[\[{]/.test(data.trim()) &&
        (() => {
          try {
            JSON.parse(data);
            return true;
          } catch {
            return false;
          }
        })());
    body = isJson ? { kind: "raw_json", content: data } : { kind: "raw_text", content: data };
  }
  const u = safeUrl(url);
  return {
    name: `${method} ${u.pathname}`.slice(0, 512),
    method,
    path: (u.pathname + (u.queryString ? `?${u.queryString}` : "")).slice(0, 2048),
    request: bundle({
      method: method as RequestSpec["method"],
      url: (u.pathname + (u.queryString ? `?${u.queryString}` : "")).slice(0, 2048),
      headers,
      body,
    }),
  };
}

/** 导入落库（判重 method+path；覆盖/跳过；校验报告）。 */
export async function importApis(
  projectId: string,
  userId: string,
  input: {
    format: "openapi3" | "postman" | "rabbit";
    source: { url?: string; content?: string };
    overwrite: boolean;
    moduleId: string;
  },
) {
  let raw = input.source.content;
  if (!raw && input.source.url) {
    const res = await fetch(input.source.url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok)
      throw new DomainError(ErrCode.API_IMPORT_INVALID, `URL 拉取失败 HTTP ${res.status}`);
    raw = await res.text();
  }
  if (!raw) throw new DomainError(ErrCode.API_IMPORT_INVALID, "缺少导入来源（url 或 content）");
  const parsed =
    input.format === "openapi3"
      ? parseOpenApi3(raw)
      : input.format === "postman"
        ? parsePostman(raw)
        : parseRabbit(raw);
  const report = {
    created: [] as string[],
    overwritten: [] as string[],
    skipped: [] as string[],
    failed: parsed.errors,
  };
  const { prisma, nextNum } = await import("@rabbit/db");
  await prisma.$transaction(async (tx) => {
    for (const api of parsed.apis) {
      if (api.error) continue;
      const existing = await tx.apiDefinition.findFirst({
        where: { projectId, method: api.method, path: api.path.slice(0, 1024), deletedAt: null },
        select: { id: true },
      });
      if (existing) {
        if (!input.overwrite) {
          report.skipped.push(`${api.method} ${api.path}`);
          continue;
        }
        await tx.apiDefinition.update({
          where: { id: existing.id },
          data: {
            name: api.name,
            ...(api.request
              ? {
                  request: api.request as object,
                  version: { increment: 1 },
                }
              : {}),
          },
        });
        report.overwritten.push(`${api.method} ${api.path}`);
      } else {
        const num = await nextNum(tx, "api_definitions", projectId);
        const created = await tx.apiDefinition.create({
          data: {
            projectId,
            moduleId: input.moduleId,
            num,
            method: api.method,
            path: api.path.slice(0, 1024),
            name: api.name,
            status: api.status ?? "DEBUG",
            request: api.request as object,
            response: (api.response ?? { status: 200, headers: [], body: "" }) as object,
            createdBy: userId,
          },
          select: { id: true },
        });
        for (const m of api.mocks ?? []) {
          await tx.apiMock.create({
            data: {
              apiId: created.id,
              name: m.name,
              matchers: m.matchers as object,
              response: m.response as object,
              followApi: m.followApi,
              enabled: m.enabled,
            },
          });
        }
        for (const c of api.cases ?? []) {
          const caseNum = await nextNum(tx, "api_cases", projectId);
          await tx.apiCase.create({
            data: {
              apiId: created.id,
              projectId,
              num: caseNum,
              name: c.name,
              level: c.level ?? "P2",
              status: c.status ?? "UNDERWAY",
              tags: (c.tags ?? []) as object,
              request: c.request as object,
              createdBy: userId,
            },
          });
        }
        report.created.push(`${api.method} ${api.path}`);
      }
    }
  });
  return report;
}

export type RabbitExport = z.infer<typeof rabbitApiExportFile>;

/** Rabbit 格式导出（模块或勾选范围；含用例与 Mock）。 */
export async function exportRabbit(
  projectId: string,
  query: { moduleId?: string; ids?: string[] },
): Promise<RabbitExport> {
  const { prisma } = await import("@rabbit/db");
  const apis = await prisma.apiDefinition.findMany({
    where: {
      projectId,
      deletedAt: null,
      ...(query.ids ? { id: { in: query.ids } } : {}),
    },
    include: {
      cases: { where: { deletedAt: null } },
      mocks: true,
    },
    orderBy: { num: "asc" },
  });
  const filtered = query.moduleId ? apis.filter((a) => a.moduleId === query.moduleId) : apis;
  const out = rabbitApiExportFile.parse({
    version: 1,
    apis: filtered.map((a) => ({
      name: a.name,
      status: a.status as "DEBUG" | "RELEASED",
      request: a.request as ApiRequestBundle,
      response: a.response as {
        status: number;
        headers: { key: string; value: string }[];
        body: string;
      },
      cases: a.cases.map((c) => ({
        name: c.name,
        level: c.level as "P0" | "P1" | "P2" | "P3",
        status: c.status as "PREPARE" | "UNDERWAY" | "COMPLETED",
        tags: (c.tags as string[]) ?? [],
        request: c.request as ApiRequestBundle,
      })),
      mocks: a.mocks.map((m) => {
        const mm = m as unknown as {
          name: string;
          enabled: boolean;
          followApi: boolean;
          matchers: Record<string, unknown>;
          response: Record<string, unknown>;
        };
        return {
          name: mm.name,
          enabled: mm.enabled,
          followApi: mm.followApi,
          matchers: mm.matchers as {
            headers: { key: string; value: string }[];
            query: { key: string; value: string }[];
            bodyContains?: string;
          },
          response: mm.response as {
            status: number;
            headers: { key: string; value: string }[];
            body: string;
            delayMs: number;
          },
        };
      }),
    })),
  });
  return out;
}

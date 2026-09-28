import { expect, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Sprint 2 e2e 公共数据准备（rules/testing §3.2：数据自造自隔离，走真实后端 API，不 mock 业务接口）。
 * 载荷口径与 tests/smoke/s2-smoke*.sh 对齐（packages/shared zod 契约）。
 */

/** e2e mock 基址（:4001 独占端口，global-setup MOCK_PORT=4001 + web MOCK_PUBLIC_URL 对齐） */
export const MOCK_BASE = process.env.E2E_MOCK_URL_BASE ?? "http://127.0.0.1:4001";

/** 默认 HTTP 域名端口随 MOCK_BASE 推导（本地 :4001 / CI 经 E2E_MOCK_URL_BASE :4000）——
 *  写死 4000 会在本地无 dev mock 常驻时连接拒绝（2026-09-27 终验教训） */
const MOCK_PORT = Number(new URL(MOCK_BASE).port) || 80;

export type Kv = { key: string; value: string; enabled: boolean };

export interface RequestSpecLike {
  method: string;
  url: string;
  headers: Kv[];
  query: Kv[];
  body: { kind: string; content?: string; rows?: unknown[]; fileId?: string };
  auth: { kind: string; username?: string; password?: string };
  timeoutMs: number;
  followRedirects: boolean;
  skipPre: boolean;
  skipPost: boolean;
}

export interface BundleLike {
  spec: RequestSpecLike;
  asserts: { kind: string; path: string; op: string; expected: string }[];
  pre: { kind: string; script?: string; ms?: number }[];
  post: { kind: string; script?: string; ms?: number }[];
  extracts: {
    source: string;
    kind: string;
    expression: string;
    match: string;
    index?: number;
    variable: string;
    scope: string;
  }[];
}

export function bundle(method = "GET", url = "", patch: Partial<BundleLike> = {}): BundleLike {
  // 过滤 undefined 键：避免 { asserts: undefined } 显式覆盖默认值（object spread 语义）
  const clean = Object.fromEntries(
    Object.entries(patch).filter(([, v]) => v !== undefined),
  ) as Partial<BundleLike>;
  const base: BundleLike = {
    spec: {
      method,
      url,
      headers: [],
      query: [],
      body: { kind: "none" },
      auth: { kind: "none" },
      timeoutMs: 10000,
      followRedirects: false,
      skipPre: false,
      skipPost: false,
    },
    asserts: [{ kind: "status_code", path: "", op: "eq", expected: "200" }],
    pre: [],
    post: [],
    extracts: [],
  };
  return { ...base, ...clean };
}

export const emptyEnvConfig = () => ({
  vars: [] as { key: string; value: string; enabled: boolean }[],
  http: [] as unknown[],
  hosts: [] as unknown[],
  database: [] as unknown[],
  pre: [] as unknown[],
  post: [] as unknown[],
  asserts: [] as unknown[],
  extracts: [] as unknown[],
});

/** 业务信封解包：code=0 才返回 data */
export async function ok<T>(res: { status(): number; json(): Promise<unknown> }, expectStatus = 200): Promise<T> {
  expect(res.status()).toBe(expectStatus);
  const body = (await res.json()) as { code: number; data: T; message?: string };
  expect(body.code, `业务码非 0：${body.message ?? ""}`).toBe(0);
  return body.data;
}

/** 项目号（mock 服务命名空间用） */
export async function projectNum(request: APIRequestContext, projectId: string): Promise<number> {
  const res = await request.get("/api/v1/personal/projects");
  const list = await ok<{ id: string; num: number }[]>(res);
  return list.find((p) => p.id === projectId)!.num;
}

/** 建环境（变量 base 指向 mock 服务 + 默认域名卡） */
export async function createEnv(
  request: APIRequestContext,
  projectId: string,
  name: string,
  vars: { key: string; value: string }[] = [{ key: "base", value: MOCK_BASE }],
): Promise<string> {
  const res = await request.post(`/api/v1/projects/${projectId}/environments`, {
    data: {
      name,
      config: {
        ...emptyEnvConfig(),
        vars: vars.map((v) => ({ ...v, enabled: true })),
        http: [
          {
            id: "def",
            name: "默认",
            protocol: "http",
            hostname: "127.0.0.1",
            port: MOCK_PORT,
            pathPrefix: "",
            conditions: {},
          },
        ],
      },
    },
  });
  const env = await ok<{ id: string }>(res, 201);
  return env.id;
}

/** 接口默认模块（scene=api） */
export async function defaultApiModuleId(request: APIRequestContext, projectId: string): Promise<string> {
  const res = await request.get(`/api/v1/projects/${projectId}/modules?scene=api`);
  const data = await ok<{ items: { id: string; isDefault?: boolean; children: unknown[] }[] }>(res);
  const flat: { id: string; isDefault?: boolean }[] = [];
  // 命名避开与生产代码同名（api/import.service 亦有 walk——曾致跨文件污点误链，2026-09-28）
  const flattenModules = (nodes: { id: string; isDefault?: boolean; children: unknown[] }[]) => {
    for (const n of nodes) {
      flat.push(n);
      flattenModules(n.children as typeof nodes);
    }
  };
  flattenModules(data.items);
  return flat.find((m) => m.isDefault)?.id ?? flat[0]!.id;
}

/** 建接口定义（含断言/提取可配置） */
export async function createApiDef(
  request: APIRequestContext,
  projectId: string,
  opts: {
    name: string;
    method?: string;
    path: string;
    moduleId?: string;
    respBody?: string;
    request?: BundleLike;
  },
): Promise<{ id: string; num: number; version: number; moduleId: string }> {
  const moduleId = opts.moduleId ?? (await defaultApiModuleId(request, projectId));
  const res = await request.post(`/api/v1/projects/${projectId}/apis`, {
    data: {
      moduleId,
      name: opts.name,
      request: opts.request ?? bundle(opts.method ?? "GET", opts.path),
      response: { status: 200, headers: [], body: opts.respBody ?? '{"code":0}' },
    },
  });
  return ok(res, 201);
}

/** 更新定义（先取详情拿 version/response，PUT 全量） */
export async function updateApiDef(
  request: APIRequestContext,
  projectId: string,
  apiId: string,
  patch: { name?: string; status?: string; request?: BundleLike; respBody?: string },
): Promise<{ version: number }> {
  const dRes = await request.get(`/api/v1/projects/${projectId}/apis/${apiId}`);
  const detail = await ok<{
    name: string;
    status: string;
    version: number;
    request: BundleLike;
    response: { status: number; headers: { key: string; value: string }[]; body: string };
  }>(dRes);
  const res = await request.put(`/api/v1/projects/${projectId}/apis/${apiId}`, {
    data: {
      name: patch.name ?? detail.name,
      status: patch.status ?? detail.status,
      request: patch.request ?? detail.request,
      response:
        patch.respBody !== undefined
          ? { ...detail.response, body: patch.respBody }
          : detail.response,
      version: detail.version,
    },
  });
  return ok(res);
}

/** 建接口用例 */
export async function createApiCase(
  request: APIRequestContext,
  projectId: string,
  apiId: string,
  opts: { name: string; level?: string; request: BundleLike },
): Promise<{ id: string; num: number }> {
  const res = await request.post(`/api/v1/projects/${projectId}/apis/${apiId}/cases`, {
    data: {
      name: opts.name,
      level: opts.level ?? "P2",
      status: "UNDERWAY",
      tags: [],
      request: opts.request,
    },
  });
  return ok(res, 201);
}

/** 批量执行接口用例 → taskId */
export async function executeCases(
  request: APIRequestContext,
  projectId: string,
  apiId: string,
  body: { caseIds: string[]; envId?: string; stopOnFail?: boolean },
): Promise<string> {
  const res = await request.post(`/api/v1/projects/${projectId}/apis/${apiId}/cases/execute`, {
    data: body,
  });
  const data = await ok<{ taskId: string }>(res, 201);
  return data.taskId;
}

/** 发起 api_debug 任务 */
export async function submitDebugTask(
  request: APIRequestContext,
  projectId: string,
  body: { url: string; method?: string; asserts?: BundleLike["asserts"]; pre?: BundleLike["pre"]; extracts?: BundleLike["extracts"]; envId?: string },
): Promise<string> {
  const b = bundle(body.method ?? "GET", body.url, {
    asserts: body.asserts,
    pre: body.pre,
    extracts: body.extracts,
  });
  const res = await request.post(`/api/v1/projects/${projectId}/exec-tasks`, {
    data: {
      type: "api_debug",
      request: b.spec,
      asserts: b.asserts,
      pre: b.pre,
      post: b.post,
      extracts: b.extracts,
      envId: body.envId,
    },
  });
  const data = await ok<{ taskId: string }>(res, 201);
  return data.taskId;
}

/** 轮询任务至终态（SUCCESS/FAILED/STOPPED），返回报告 detail */
export async function pollTask(
  request: APIRequestContext,
  projectId: string,
  taskId: string,
  timeoutMs = 30_000,
): Promise<{ status: string; summary?: { total?: number; passed?: number; failed?: number } }> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const res = await request.get(`/api/v1/projects/${projectId}/reports/${taskId}`);
    const detail = await ok<{ status: string; summary?: { total?: number; passed?: number; failed?: number } }>(res);
    if (!["PENDING", "RUNNING"].includes(detail.status)) return detail;
    if (Date.now() > deadline) throw new Error(`任务 ${taskId} 轮询超时，当前 ${detail.status}`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

/** Mock 服务地址（含项目号与定义路径模板） */
export async function getMockUrl(
  request: APIRequestContext,
  projectId: string,
  apiId: string,
): Promise<string> {
  const res = await request.get(`/api/v1/projects/${projectId}/apis/${apiId}/mock-url`);
  const data = await ok<{ url: string }>(res);
  return data.url;
}

/** 建 Mock 规则 */
export async function createMockRule(
  request: APIRequestContext,
  projectId: string,
  apiId: string,
  body: {
    name: string;
    enabled?: boolean;
    followApi?: boolean;
    query?: { key: string; value: string }[];
    respBody?: string;
    delayMs?: number;
    status?: number;
  },
): Promise<string> {
  const res = await request.post(`/api/v1/projects/${projectId}/apis/${apiId}/mocks`, {
    data: {
      name: body.name,
      enabled: body.enabled ?? true,
      followApi: body.followApi ?? false,
      matchers: { headers: [], query: body.query ?? [] },
      response: {
        status: body.status ?? 200,
        headers: [],
        body: body.respBody ?? '{"mock":"hit"}',
        delayMs: body.delayMs ?? 0,
      },
    },
  });
  const data = await ok<{ id: string }>(res, 201);
  return data.id;
}

/** antd Select 选择（兼容 virtual 与否：可见下拉层的可见选项精确文本点击；动画期未展开自动重试） */
export async function pickOption(page: Page, trigger: ReturnType<Page["locator"]>, optionText: string | RegExp): Promise<void> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await trigger.click({ timeout: 5000 });
      const dropdown = page
        .locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden)")
        .filter({ visible: true })
        .last();
      await dropdown.waitFor({ state: "visible", timeout: 2500 });
      const opt = dropdown
        .getByText(optionText, typeof optionText === "string" ? { exact: true } : undefined)
        .filter({ visible: true })
        .first();
      await opt.click({ timeout: 2500 });
      return;
    } catch (e) {
      lastErr = e;
      // 下拉未展开（弹窗动画中）/ 选项未就绪 → Escape 收起下拉后重试（点空白会命中 Modal 遮罩把弹窗关掉）
      await page.keyboard.press("Escape").catch(() => {});
    }
  }
  throw new Error(`pickOption 未能选择「${String(optionText)}」：${lastErr instanceof Error ? lastErr.message : ""}`);
}

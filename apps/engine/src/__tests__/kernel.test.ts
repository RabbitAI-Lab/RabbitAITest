import { describe, expect, it } from "vitest";
import type { EnvSnapshot, RequestSpec } from "@rabbit/shared/execution";
import { renderRequest, renderString, resolveUrl, pickDomain, hostsMap } from "../kernel/render.js";
import { runExtractors } from "../kernel/extract.js";
import { evaluateAsserts, classifyFailure } from "../kernel/asserts.js";
import { buildDigestHeader } from "../samplers/http.js";
import { ProcessorError, runProcessors } from "../kernel/processors.js";

const snap = (over: Partial<EnvSnapshot> = {}): EnvSnapshot => ({
  vars: { base: "http://127.0.0.1:4000", token: "tk" },
  http: [
    {
      id: "pet",
      name: "宠物",
      protocol: "http",
      hostname: "pet.local",
      port: 80,
      pathPrefix: "",
      conditions: { pathPrefix: "/pets" },
    },
    {
      id: "mod",
      name: "订单",
      protocol: "https",
      hostname: "order.local",
      port: 8443,
      pathPrefix: "/api",
      conditions: { moduleId: "m-order" },
    },
    {
      id: "def",
      name: "默认",
      protocol: "http",
      hostname: "default.local",
      port: 8080,
      pathPrefix: "",
      conditions: {},
    },
  ],
  hosts: [{ host: "default.local", address: "10.0.0.5" }],
  database: [],
  pre: [],
  post: [],
  asserts: [],
  extracts: [],
  ...over,
});

describe("render", () => {
  it("变量渲染与未定义变量保留原样", () => {
    expect(renderString("${base}/pets/${petId}", { base: "http://x", petId: "9" })).toBe(
      "http://x/pets/9",
    );
    expect(renderString("${unknown}/x", { base: "http://x" })).toBe("${unknown}/x");
  });
  it("渲染覆盖 url/headers/query/body/auth", () => {
    const spec = renderRequest(baseSpec(), {
      vars: { base: "http://h", t: "tk1" },
      env: undefined,
      moduleId: undefined,
    });
    expect(spec.url).toBe("http://h/pets/1");
    expect(spec.headers[0]?.value).toBe("Bearer tk1");
  });
  it("域名优先级：路径条件 > 模块条件 > 默认", () => {
    expect(pickDomain("/pets/1", undefined, snap().http)?.id).toBe("pet");
    expect(pickDomain("/orders", "m-order", snap().http)?.id).toBe("mod");
    expect(pickDomain("/other", undefined, snap().http)?.id).toBe("def");
  });
  it("相对路径拼接与 query 组装（模块域名含端口与前缀）", () => {
    const url = resolveUrl(
      {
        ...baseSpec(),
        url: "/orders",
        query: [
          { key: "a", value: "1", enabled: true },
          { key: "b", value: "2", enabled: false },
        ],
      },
      { vars: {}, env: snap(), moduleId: "m-order" },
    );
    expect(url).toBe("https://order.local:8443/api/orders?a=1");
  });
  it("无环境且相对路径 → 抛配置错误", () => {
    expect(() => resolveUrl(baseSpec(), { vars: {}, env: undefined, moduleId: undefined })).toThrow(
      /未选择环境/,
    );
  });
  it("HOST 映射表构建", () => {
    expect(hostsMap(snap()).get("default.local")).toBe("10.0.0.5");
  });
});

describe("extract", () => {
  const body = JSON.stringify({ code: 0, data: { name: "阿黄", tags: ["a", "b", "c"] } });
  it("JSONPath 首个/第N个", () => {
    const r1 = runExtractors(
      [
        {
          source: "body",
          kind: "jsonpath",
          expression: "$.data.tags[*]",
          match: "first",
          variable: "t",
          scope: "temp",
        },
      ],
      { bodyText: body, headers: [] },
    );
    expect(r1[0]?.value).toBe("a");
    const rn = runExtractors(
      [
        {
          source: "body",
          kind: "jsonpath",
          expression: "$.data.tags[*]",
          match: "n",
          index: 3,
          variable: "t",
          scope: "temp",
        },
      ],
      { bodyText: body, headers: [] },
    );
    expect(rn[0]?.value).toBe("c");
  });
  it("正则捕获组；未命中不产出", () => {
    const r = runExtractors(
      [
        {
          source: "body",
          kind: "regex",
          expression: '"name":"([^"]+)"',
          match: "first",
          variable: "n",
          scope: "temp",
        },
      ],
      { bodyText: body, headers: [] },
    );
    expect(r[0]?.value).toBe("阿黄");
    const miss = runExtractors(
      [
        {
          source: "body",
          kind: "jsonpath",
          expression: "$.none",
          match: "first",
          variable: "x",
          scope: "temp",
        },
      ],
      { bodyText: body, headers: [] },
    );
    expect(miss).toHaveLength(0);
  });
  it("响应头提取（大小写不敏感）", () => {
    const r = runExtractors(
      [
        {
          source: "headers",
          kind: "regex",
          expression: "X-Trace",
          match: "first",
          variable: "tr",
          scope: "env",
        },
      ],
      { bodyText: "", headers: [{ key: "x-trace", value: "abc" }] },
    );
    expect(r[0]).toEqual({ variable: "tr", value: "abc", scope: "env" });
  });
});

describe("asserts v2", () => {
  const input = {
    status: 200,
    headers: [{ key: "Content-Type", value: "application/json" }],
    bodyText: JSON.stringify({ code: 0, ms: 812 }),
    durationMs: 812,
    vars: { token: "tk" },
  };
  it("六种断言成功路径", () => {
    const rs = evaluateAsserts(
      [
        { kind: "status_code", path: "", op: "eq", expected: "200" },
        { kind: "response_header", path: "content-type", op: "contains", expected: "json" },
        { kind: "body_jsonpath", path: "$.code", op: "eq", expected: "0" },
        { kind: "body_regex", path: '"ms":(\\d+)', op: "regex", expected: "^8" },
        { kind: "response_time", path: "", op: "le", expected: "1000" },
        { kind: "variable", path: "token", op: "eq", expected: "tk" },
      ],
      input,
    );
    expect(rs.every((r) => r.passed)).toBe(true);
    expect(classifyFailure(rs)).toBeNull();
  });
  it("失败路径与未命中", () => {
    const rs = evaluateAsserts(
      [
        { kind: "response_time", path: "", op: "lt", expected: "100" },
        { kind: "body_jsonpath", path: "$.nope", op: "eq", expected: "1" },
      ],
      input,
    );
    expect(rs[0]?.passed).toBe(false);
    expect(rs[0]?.actual).toBe("812");
    expect(rs[1]?.actual).toBe("(未命中)");
    expect(classifyFailure(rs)).toBe("ASSERT_FAILED");
  });
  it("S0 兼容：status_code eq / body_jsonpath contains", () => {
    const rs = evaluateAsserts(
      [
        { kind: "status_code", path: "", op: "eq", expected: "200" },
        { kind: "body_jsonpath", path: "$.code", op: "contains", expected: "0" },
      ],
      input,
    );
    expect(rs.every((r) => r.passed)).toBe(true);
  });
});

describe("digest", () => {
  it("RFC7616 MD5 挑战应答（经典样例可复算）", () => {
    const header = buildDigestHeader(
      'Digest realm="testrealm@host.com", qop="auth,auth-int", nonce="dcd98b7102dd2f0e8b11d0f600bfb0c093", opaque="5ccc069c403ebaf9f0171e9517f40e41"',
      "GET",
      "/dir/index.html",
      "Mufasa",
      "Circle Of Life",
    );
    expect(header).toMatch(/^Digest /);
    expect(header).toContain('username="Mufasa"');
    expect(header).toContain("qop=auth");
    // 非 Digest 挑战 / 缺 nonce 返回 undefined
    expect(buildDigestHeader("Basic realm=x", "GET", "/", "u", "p")).toBeUndefined();
  });
});

describe("processors", () => {
  it("等待处理器", async () => {
    const t0 = Date.now();
    await runProcessors([{ kind: "wait", ms: 30 }], { vars: {}, env: undefined, logs: [] });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(25);
  });
  it("脚本：变量读写与日志（API-004 沙箱）", async () => {
    const ctx: { vars: Record<string, string>; env: ReturnType<typeof snap>; logs: string[] } = {
      vars: { a: "1" },
      env: snap(),
      logs: [],
    };
    await runProcessors(
      [
        {
          kind: "script",
          script: 'setVar("b", getVar("a") + "-x"); log("v=", getVar("b")); envGet("token");',
        },
      ],
      ctx,
    );
    expect(ctx.vars.b).toBe("1-x");
    expect(ctx.logs[0]).toContain("v= 1-x");
  });
  it("脚本异常 → SCRIPT_ERROR", async () => {
    await expect(
      runProcessors([{ kind: "script", script: "throw new Error('boom')" }], {
        vars: {},
        env: undefined,
        logs: [],
      }),
    ).rejects.toMatchObject({ kind: "SCRIPT_ERROR" });
  });
  it("脚本死循环 5s 强杀 → SCRIPT_ERROR", async () => {
    await expect(
      runProcessors([{ kind: "script", script: "while(true){}" }], {
        vars: {},
        env: undefined,
        logs: [],
      }),
    ).rejects.toBeInstanceOf(ProcessorError);
  }, 15000);
  it("SQL 处理器（PLUG-004 解禁）：未选环境时数据源不存在显式失败", async () => {
    await expect(
      runProcessors(
        [{ kind: "sql", sql: "SELECT 1", datasourceId: "x", params: [], varMapping: {} }],
        {
          vars: {},
          env: undefined,
          logs: [],
        },
      ),
    ).rejects.toMatchObject({
      kind: "CONFIG_ERROR",
      message: expect.stringContaining("SQL 数据源不存在"),
    });
  });
});

function baseSpec(): RequestSpec {
  return {
    method: "GET",
    url: "${base}/pets/1",
    headers: [{ key: "Authorization", value: "Bearer ${t}", enabled: true }],
    query: [],
    body: { kind: "none" },
    auth: { kind: "none" },
    timeoutMs: 5000,
    followRedirects: false,
    skipPre: false,
    skipPost: false,
  };
}

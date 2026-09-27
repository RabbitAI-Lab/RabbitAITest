/** API-005 匹配算法单测（模板/头/Query/体/优先级/禁用）。 */
import { describe, expect, it } from "vitest";
import { matchPath, pickRule } from "../index";
import type { MockRuleSnapshotItem } from "@rabbit/shared";

const rule = (over: Partial<MockRuleSnapshotItem>): MockRuleSnapshotItem => ({
  id: over.id ?? "r1",
  apiId: "api1",
  enabled: over.enabled ?? true,
  followApi: over.followApi ?? false,
  method: over.method ?? "GET",
  pathTemplate: over.pathTemplate ?? "/pets/{id}",
  matchers: over.matchers ?? { headers: [], query: [] },
  response: over.response ?? { status: 200, headers: [], body: "{}", delayMs: 0 },
  apiResponse: { status: 200, headers: [], body: "def" },
});

describe("matchPath", () => {
  it("模板参数捕获与长度不符拒绝", () => {
    expect(matchPath("/pets/{id}", "/pets/9")).toEqual({ id: "9" });
    expect(matchPath("/pets/{id}", "/pets/9/sub")).toBeUndefined();
    expect(matchPath("/pets/{id}", "/orders/9")).toBeUndefined();
  });
});

describe("pickRule", () => {
  const req = (over: Partial<Record<"method" | "path" | "body", string>> & { query?: Record<string, string>; headers?: Record<string, string> } = {}) => ({
    method: over.method ?? "GET",
    path: over.path ?? "/pets/9",
    query: over.query ?? {},
    headers: over.headers ?? {},
    body: over.body ?? "",
  });
  it("method+path 基线命中", () => {
    expect(pickRule([rule({})], req())?.rule.id).toBe("r1");
  });
  it("Query 条件：值不等不命中", () => {
    const r = rule({ matchers: { headers: [], query: [{ key: "kind", value: "dog" }] } });
    expect(pickRule([r], req({ query: { kind: "cat" } }))).toBeUndefined();
    expect(pickRule([r], req({ query: { kind: "dog" } }))?.rule.id).toBe("r1");
  });
  it("头条件大小写不敏感；体包含匹配", () => {
    const r = rule({
      method: "POST",
      pathTemplate: "/pets",
      matchers: { headers: [{ key: "X-Trace", value: "t1" }], query: [], bodyContains: "阿黄" },
    });
    expect(pickRule([r], req({ method: "POST", path: "/pets", headers: { "x-trace": "t1" }, body: '{"name":"阿黄"}' }))?.rule.id).toBe("r1");
    expect(pickRule([r], req({ method: "POST", path: "/pets", headers: { "x-trace": "t1" }, body: '{"name":"cat"}' }))).toBeUndefined();
  });
  it("条件最多者优先（精确 > 宽松）", () => {
    const loose = rule({ id: "loose", matchers: { headers: [], query: [] } });
    const strict = rule({
      id: "strict",
      matchers: { headers: [], query: [{ key: "kind", value: "dog" }] },
    });
    expect(pickRule([loose, strict], req({ query: { kind: "dog" } }))?.rule.id).toBe("strict");
    expect(pickRule([loose, strict], req({ query: {} }))?.rule.id).toBe("loose");
  });
  it("禁用规则透明下线", () => {
    expect(pickRule([rule({ enabled: false })], req())).toBeUndefined();
  });
  it("跟随 API 时响应取定义默认响应（服务端逻辑，快照字段就位）", () => {
    const r = rule({ followApi: true });
    expect(r.followApi).toBe(true);
    expect(r.apiResponse.body).toBe("def");
  });
});

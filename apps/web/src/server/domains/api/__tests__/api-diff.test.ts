/** API-003 分区级 diffBundles 单测。 */
import { describe, expect, it } from "vitest";
import { diffBundles } from "../api-case.service";
import { apiRequestBundleSchema } from "@rabbit/shared";

const bundle = (over: { url?: string; body?: string; op?: string }) =>
  apiRequestBundleSchema.parse({
    spec: {
      method: "POST",
      url: over.url ?? "/pets",
      headers: [],
      query: [],
      body: { kind: "raw_json", content: over.body ?? '{"value":"dog"}' },
      auth: { kind: "none" },
      timeoutMs: 60000,
      followRedirects: false,
      skipPre: false,
      skipPost: false,
    },
    asserts: [{ kind: "status_code", path: "", op: "eq", expected: "200" }],
    pre: [],
    post: [],
    extracts: [],
  });

describe("diffBundles", () => {
  it("相同 → 无差异分区", () => {
    expect(diffBundles(bundle({}), bundle({}))).toHaveLength(0);
  });
  it("请求体差异命中「请求体」分区", () => {
    const d = diffBundles(bundle({}), bundle({ body: '{"value":"cat"}' }));
    expect(d.map((x) => x.section)).toContain("请求体");
  });
  it("断言差异命中「断言」分区", () => {
    const a = bundle({});
    const b = apiRequestBundleSchema.parse({
      ...a,
      asserts: [...a.asserts, { kind: "response_time", path: "", op: "lt", expected: "100" }],
    });
    expect(diffBundles(a, b).map((x) => x.section)).toContain("断言");
  });
});

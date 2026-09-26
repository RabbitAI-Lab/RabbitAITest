import { describe, expect, it } from "vitest";
import { classifyFailure, evaluateAsserts } from "../kernel/asserts.js";

const body = JSON.stringify({ url: "https://httpbin.org/get", args: { q: "1" }, n: 3 });

describe("evaluateAsserts", () => {
  it("状态码 eq 通过/失败", () => {
    const [pass, fail] = evaluateAsserts(
      [
        { kind: "status_code", path: "", op: "eq", expected: "200" },
        { kind: "status_code", path: "", op: "eq", expected: "404" },
      ],
      { status: 200, bodyText: "" },
    );
    expect(pass!.passed).toBe(true);
    expect(fail!.passed).toBe(false);
    expect(fail!.actual).toBe("200");
  });

  it("JSONPath eq 与 contains", () => {
    const results = evaluateAsserts(
      [
        { kind: "body_jsonpath", path: "$.url", op: "contains", expected: "httpbin" },
        { kind: "body_jsonpath", path: "$.args.q", op: "eq", expected: "1" },
        { kind: "body_jsonpath", path: "$.n", op: "eq", expected: "3" },
      ],
      { status: 200, bodyText: body },
    );
    expect(results.map((r) => r.passed)).toEqual([true, true, true]);
  });

  it("JSONPath 未命中 → 失败且 actual=未命中", () => {
    const [r] = evaluateAsserts(
      [{ kind: "body_jsonpath", path: "$.missing", op: "eq", expected: "x" }],
      { status: 200, bodyText: body },
    );
    expect(r!.passed).toBe(false);
    expect(r!.actual).toBe("(未命中)");
  });

  it("非 JSON 响应体 → JSONPath 失败不抛异常", () => {
    const [r] = evaluateAsserts([{ kind: "body_jsonpath", path: "$.a", op: "eq", expected: "1" }], {
      status: 200,
      bodyText: "<html>not json</html>",
    });
    expect(r!.passed).toBe(false);
  });

  it('数值与字符串比较（JSONPath 命中数字 3，期望字符串 "3" 视为相等）', () => {
    const [r] = evaluateAsserts([{ kind: "body_jsonpath", path: "$.n", op: "eq", expected: "3" }], {
      status: 200,
      bodyText: body,
    });
    expect(r!.passed).toBe(true);
  });
});

describe("classifyFailure", () => {
  it("任一失败 → ASSERT_FAILED", () => {
    const rs = evaluateAsserts(
      [
        { kind: "status_code", path: "", op: "eq", expected: "200" },
        { kind: "body_jsonpath", path: "$.nope", op: "eq", expected: "1" },
      ],
      { status: 200, bodyText: body },
    );
    expect(classifyFailure(rs)).toBe("ASSERT_FAILED");
    expect(classifyFailure([rs[0]!])).toBeNull();
  });
});

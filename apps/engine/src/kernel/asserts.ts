/** API-004 kernel：断言 6 种 v2（S0 status_code/body_jsonpath eq|contains 为子集兼容）。 */
import { JSONPath } from "jsonpath-plus";
import type { AssertResult, AssertSpec, FailureKind } from "@rabbit/shared/execution";

export interface AssertInput {
  status: number;
  headers: { key: string; value: string }[];
  bodyText: string;
  durationMs: number;
  vars: Record<string, string>; // variable 断言 + 提取后变量可见
}

export function evaluateAsserts(specs: AssertSpec[], input: AssertInput): AssertResult[] {
  return specs.map((spec) => {
    const actual = actualOf(spec, input);
    const passed =
      actual !== undefined && (compare(spec.op, spec.expected, actual, numericKind(spec.kind)) ?? false);
    return {
      kind: spec.kind,
      path: spec.path,
      op: spec.op,
      expected: spec.expected,
      actual: actual ?? "(未命中)",
      passed,
    };
  });
}

function numericKind(kind: AssertSpec["kind"]): boolean {
  return kind === "status_code" || kind === "response_time";
}

function actualOf(spec: AssertSpec, input: AssertInput): string | undefined {
  switch (spec.kind) {
    case "status_code":
      return String(input.status);
    case "response_time":
      return String(input.durationMs);
    case "response_header": {
      const hit = input.headers.find((h) => h.key.toLowerCase() === spec.path.toLowerCase());
      return hit?.value;
    }
    case "body_jsonpath": {
      try {
        const json = JSON.parse(input.bodyText);
        const results = JSONPath({ path: spec.path, json, wrap: true }) as unknown[];
        if (results.length === 0) return undefined;
        const v = results[0];
        return typeof v === "object" && v !== null ? JSON.stringify(v) : String(v);
      } catch {
        return undefined;
      }
    }
    case "body_regex": {
      const m = input.bodyText.match(new RegExp(spec.path));
      return m ? (m[1] !== undefined ? m[1] : m[0]) : undefined;
    }
    case "variable":
      return Object.prototype.hasOwnProperty.call(input.vars, spec.path)
        ? input.vars[spec.path]
        : undefined;
  }
}

function compare(
  op: AssertSpec["op"],
  expected: string,
  actual: string,
  numeric: boolean,
): boolean | undefined {
  if (op === "regex") {
    try {
      return new RegExp(expected).test(actual);
    } catch {
      return false;
    }
  }
  if (op === "contains") return actual.includes(expected);
  if (numeric) {
    const e = Number(expected);
    const a = Number(actual);
    if (!Number.isFinite(e) || !Number.isFinite(a)) return op === "eq" ? expected === actual : false;
    switch (op) {
      case "eq":
        return a === e;
      case "lt":
        return a < e;
      case "le":
        return a <= e;
      case "gt":
        return a > e;
      case "ge":
        return a >= e;
    }
  }
  if (op === "eq") return actual === expected;
  return undefined; // 字符串上下文的 lt/le/gt/ge 无意义 → 未命中失败
}

/** 失败归一：断言不过=ASSERT_FAILED（S0 语义保留）。 */
export function classifyFailure(asserts: AssertResult[]): FailureKind | null {
  return asserts.some((a) => !a.passed) ? "ASSERT_FAILED" : null;
}

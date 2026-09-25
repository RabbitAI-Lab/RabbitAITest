import { JSONPath } from 'jsonpath-plus';
import type { AssertResult, AssertSpec } from '@rabbit/shared';

export interface AssertInput {
  status: number;
  bodyText: string;
}

/** 断言求值（纯函数，EXEC-001-T1 单测重点）。 */
export function evaluateAsserts(specs: AssertSpec[], input: AssertInput): AssertResult[] {
  return specs.map((spec) => {
    if (spec.kind === 'status_code') {
      const actual = String(input.status);
      const passed = spec.op === 'eq' ? actual === spec.expected : actual.includes(spec.expected);
      return { ...spec, actual, passed };
    }
    // body_jsonpath
    let value: unknown = undefined;
    let exists = false;
    try {
      const parsed = JSON.parse(input.bodyText) as object;
      const results = JSONPath<unknown[]>({ path: spec.path, json: parsed, wrap: true });
      exists = results.length > 0;
      value = results[0];
    } catch {
      exists = false;
    }
    const actual = exists ? stringify(value) : '(未命中)';
    const passed = exists && (spec.op === 'eq' ? actual === spec.expected : actual.includes(spec.expected));
    return { ...spec, actual, passed };
  });
}

function stringify(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v === null || v === undefined) return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/** 三类失败归一化（rules/engine §5.2）。 */
export function classifyFailure(asserts: AssertResult[]): 'ASSERT_FAILED' | null {
  return asserts.some((a) => !a.passed) ? 'ASSERT_FAILED' : null;
}

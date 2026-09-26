import { describe, expect, it } from "vitest";
import { DomainError, ErrCode, fail, ok } from "../envelope";
import { caseCreateSchema } from "../case/schemas";
import { execCommandSchema, eventFrameSchema } from "../execution/schemas";

describe("envelope", () => {
  it("ok/fail 结构", () => {
    expect(ok({ a: 1 })).toEqual({ code: 0, message: "ok", data: { a: 1 } });
    expect(fail(10001, "x")).toEqual({ code: 10001, message: "x", data: null });
  });
  it("DomainError 携带错误码", () => {
    const e = new DomainError(ErrCode.EMAIL_EXISTS, "dup");
    expect(e.code).toBe(10101);
  });
});

describe("caseCreateSchema", () => {
  it("最小输入应用默认值", () => {
    const r = caseCreateSchema.parse({ name: "登录" });
    expect(r.level).toBe("P2");
    expect(r.steps).toEqual([]);
  });
  it("空名称拒绝", () => {
    expect(() => caseCreateSchema.parse({ name: "" })).toThrow();
  });
});

describe("execution schemas", () => {
  it("合法命令", () => {
    const cmd = execCommandSchema.parse({
      taskId: "0b965c86-33e9-4c1f-8f2b-1f2f6a5b7c9d",
      projectId: "0b965c86-33e9-4c1f-8f2b-1f2f6a5b7c10",
      type: "api_debug",
      request: { method: "GET", url: "https://httpbin.org/get" },
      asserts: [{ kind: "status_code", op: "eq", expected: "200" }],
    });
    expect(cmd.request.timeoutMs).toBe(60000);
  });
  it("非法 URL 拒绝", () => {
    expect(() =>
      execCommandSchema.parse({
        taskId: "0b965c86-33e9-4c1f-8f2b-1f2f6a5b7c9d",
        projectId: "0b965c86-33e9-4c1f-8f2b-1f2f6a5b7c10",
        type: "api_debug",
        request: { method: "GET", url: "not-a-url" },
      }),
    ).toThrow();
  });
  it("事件帧判别联合", () => {
    const f = eventFrameSchema.parse({
      type: "task-final",
      taskId: "0b965c86-33e9-4c1f-8f2b-1f2f6a5b7c9d",
      seq: 3,
      ts: 1,
      outcome: "failed",
      failureKind: "ASSERT_FAILED",
    });
    expect(f.type).toBe("task-final");
  });
});

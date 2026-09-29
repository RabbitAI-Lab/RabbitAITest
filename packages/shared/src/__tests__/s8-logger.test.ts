/** S8 INFRA-004：统一 logger 单测——redact 脱敏矩阵 / ALS 上下文透传 / logFor module 绑定。 */
import { describe, expect, it } from "vitest";
import { createWriteStream } from "node:fs";
import { logContext, logFor, logger, runWithLogContext } from "../logger";

function capture(fn: (log: ReturnType<typeof logFor>) => void): Record<string, unknown>[] {
  const chunks: string[] = [];
  const orig = process.stdout.write.bind(process.stdout);
  (process.stdout as { write: unknown }).write = (c: string | Uint8Array) => {
    chunks.push(String(c));
    return true;
  };
  try {
    fn(logger.child({ module: "test" }));
  } finally {
    (process.stdout as { write: unknown }).write = orig;
  }
  return chunks.filter((c) => c.trim()).map((c) => JSON.parse(c));
}

describe("logger（INFRA-004）", () => {
  it("redact：顶层与嵌套敏感键脱敏（password/token/apikey/authorization…）", () => {
    const rows = capture((log) =>
      log.info(
        {
          password: "p1",
          nested: { api_key: "k1", token: "t1", ok: 1 },
          list: [{ authorization: "Basic x", cookie: "ras=1" }],
          normal: "v",
        },
        "redact probe",
      ),
    );
    const r = rows[0]!;
    expect(r.password).toBe("[REDACTED]");
    expect((r.nested as Record<string, unknown>).api_key).toBe("[REDACTED]");
    expect((r.nested as Record<string, unknown>).token).toBe("[REDACTED]");
    expect((r.list as Array<Record<string, unknown>>)[0]!.authorization).toBe("[REDACTED]");
    expect((r.list as Array<Record<string, unknown>>)[0]!.cookie).toBe("[REDACTED]");
    expect(r.normal).toBe("v");
  });

  it("runWithLogContext：ALS 同步/异步作用域内可读，退出即清", async () => {
    expect(logContext().reqId).toBeUndefined();
    await runWithLogContext({ reqId: "req-abc", userId: "u1" }, async () => {
      expect(logContext().reqId).toBe("req-abc");
      await new Promise((r) => setTimeout(r, 1));
      expect(logContext().userId).toBe("u1"); // 异步边界保持
      // 嵌套 run 合并外层字段
      await runWithLogContext({ projectId: "p9" }, () => {
        expect(logContext().reqId).toBe("req-abc");
        expect(logContext().projectId).toBe("p9");
      });
    });
    expect(logContext().reqId).toBeUndefined();
  });

  it("logFor：module 绑定 + 请求上下文自动附带", () => {
    const rows = capture(() => {
      void runWithLogContext({ reqId: "req-xyz" }, () => {
        logFor("case").info({ caseId: "c1" }, "case created");
      });
    });
    const r = rows[0]!;
    expect(r.module).toBe("case");
    expect(r.reqId).toBe("req-xyz");
    expect(r.caseId).toBe("c1");
  });

  it("JSON 输出为单行（stdout 可按行检索）", () => {
    const rows = capture((log) => log.warn({ a: 1 }, "line probe"));
    expect(rows.length).toBe(1);
    expect(rows[0]!.msg).toBe("line probe");
  });
});

// createWriteStream 引用防 tree-shake 误报（CI 环境差异）
void createWriteStream;

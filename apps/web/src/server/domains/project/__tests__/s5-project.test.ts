/** S5 单测（PROJ-005/FILE-001/SYS-007）：脚本沙箱 / scriptRef 展开 / Git adapter / 环回校验。 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { runScriptDebug } from "../script-sandbox";
import { parseRepoUrl, fetchPath, listRepoMeta } from "../git-adapters";
import { assertLoopbackUrl } from "@/server/domains/system/personal.service";
import { DomainError } from "@rabbit/shared";

// ── PROJ-005：web 侧 quickjs 调试沙箱（API 面与 engine processors 对齐）──

describe("script-sandbox（PROJ-005 §2）", () => {
  it("log 采集 + vars 读写", async () => {
    const r = await runScriptDebug('log("hello", 1); setVar("k", "v"); log(getVar("k"));', { a: "1" });
    expect(r.logs[0]).toBe("[out] hello 1");
    expect(r.logs[1]).toBe("[out] v");
    expect(r.vars.k).toBe("v");
    expect(r.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("运行时错误 → ScriptDebugError（含 message）", async () => {
    await expect(runScriptDebug('throw new Error("boom");', {})).rejects.toThrow("boom");
  });

  it("语法错误 → ScriptDebugError", async () => {
    await expect(runScriptDebug("this is not js", {})).rejects.toThrow();
  });

  it("5s 超时强杀（死循环，耗时 <10s 有界返回错误）", async () => {
    const startedAt = Date.now();
    await expect(runScriptDebug("while(true){}", {})).rejects.toThrow();
    expect(Date.now() - startedAt).toBeLessThan(10_000);
  }, 15_000);

  it("log 上限 200 行截断", async () => {
    const r = await runScriptDebug('for (let i = 0; i < 300; i++) log(i);', {});
    expect(r.logs.length).toBe(200);
  });

  it("envGet 读环境变量注入", async () => {
    const r = await runScriptDebug('log(envGet("x"));', {}, { x: "y" });
    expect(r.logs[0]).toBe("[out] y");
  });
});

// ── FILE-001：Git adapter（URL 解析 + contents 族/gitlab 归一化，fetch 注入）──

describe("git-adapters parseRepoUrl（FILE-001 §2）", () => {
  it("gitea 自建 host → /api/v1", () => {
    const r = parseRepoUrl("gitea", "https://git.example.com/qa/testdata.git");
    expect(r.owner).toBe("qa");
    expect(r.repo).toBe("testdata");
    expect(r.apiBase).toBe("https://git.example.com/api/v1");
  });
  it("github 官方 → api.github.com；自建 → /api/v3", () => {
    expect(parseRepoUrl("github", "https://github.com/oa/rb").apiBase).toBe("https://api.github.com");
    expect(parseRepoUrl("github", "https://gh.internal/oa/rb").apiBase).toBe("https://gh.internal/api/v3");
  });
  it("gitlab → /api/v4；gitee 官方/自建", () => {
    expect(parseRepoUrl("gitlab", "https://gl.io/oa/rb").apiBase).toBe("https://gl.io/api/v4");
    expect(parseRepoUrl("gitee", "https://gitee.com/oa/rb").apiBase).toBe("https://gitee.com/api/v5");
    expect(parseRepoUrl("gitee", "https://ge.corp/oa/rb").apiBase).toBe("https://ge.corp/api/v5");
  });
  it("缺 owner/repo → 422", () => {
    expect(() => parseRepoUrl("gitea", "https://only-host/")).toThrow(DomainError);
  });
  it("非 http(s) → 422", () => {
    expect(() => parseRepoUrl("gitea", "ftp://x/y/z")).toThrow(DomainError);
  });
});

const jsonResponse = (body: unknown, status = 200) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response;
const textResponse = (text: string, status = 200) =>
  ({ ok: status >= 200 && status < 300, status, text: async () => text }) as unknown as Response;

describe("git-adapters fetchPath（contents 族 / gitlab raw）", () => {
  const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");
  it("单文件（base64 内联解码）", async () => {
    const ref = parseRepoUrl("gitea", "https://git.example.com/qa/testdata");
    const fetchFn = vi.fn(async (url: string) => {
      expect(url).toContain("/contents/data/users_small.csv?");
      return jsonResponse({ type: "file", content: b64("id,name\n1,a\n"), encoding: "base64", size: 14 });
    });
    const files = await fetchPath(ref, null, "main", "data/users_small.csv", fetchFn as never);
    expect(files.length).toBe(1);
    expect(files[0]!.content.toString()).toContain("1,a");
  });
  it("目录列表（文件+子目录递归）", async () => {
    const ref = parseRepoUrl("gitea", "https://git.example.com/qa/testdata");
    const fetchFn = vi.fn(async (url: string) => {
      if (url.endsWith("/contents/data?ref=main")) {
        return jsonResponse([
          { name: "a.csv", path: "data/a.csv", type: "file", content: b64("a"), encoding: "base64", size: 1 },
          { name: "sub", path: "data/sub", type: "dir" },
        ]);
      }
      if (url.includes("/contents/data/sub?")) {
        return jsonResponse([{ name: "b.csv", path: "data/sub/b.csv", type: "file", content: b64("b"), encoding: "base64", size: 1 }]);
      }
      throw new Error(`unexpected url ${url}`);
    });
    const files = await fetchPath(ref, null, "main", "data", fetchFn as never);
    expect(files.map((f) => f.path).sort()).toEqual(["data/a.csv", "data/sub/b.csv"]);
  });
  it("404 → GitAdapterError(404)", async () => {
    const ref = parseRepoUrl("gitea", "https://git.example.com/qa/testdata");
    const fetchFn = vi.fn(async () => jsonResponse({ message: "Not Found" }, 404));
    await expect(fetchPath(ref, null, "main", "nope", fetchFn as never)).rejects.toThrow(/404/);
  });
  it("gitlab：文件 raw 直取；404 时按目录 tree 展开", async () => {
    const ref = parseRepoUrl("gitlab", "https://gl.io/qa/testdata");
    let raw404 = false;
    const fetchFn = vi.fn(async (url: string) => {
      if (url.includes("/repository/files/data%2Fx.csv/raw")) {
        if (!raw404) return textResponse("x-content");
        return textResponse("404", 404);
      }
      if (url.includes("/repository/tree")) {
        return jsonResponse([{ type: "blob", path: "data/y.csv" }]);
      }
      if (url.includes("/repository/files/data%2Fy.csv/raw")) {
        return textResponse("y-content");
      }
      throw new Error(`unexpected ${url}`);
    });
    const single = await fetchPath(ref, null, "main", "data/x.csv", fetchFn as never);
    expect(single[0]!.content.toString()).toBe("x-content");
    raw404 = true;
    const dir = await fetchPath(ref, null, "main", "data", fetchFn as never);
    expect(dir[0]!.path).toBe("data/y.csv");
  });
  it("listRepoMeta：2xx ok / 401 凭据失效语义", async () => {
    const ref = parseRepoUrl("gitea", "https://git.example.com/qa/testdata");
    const ok = await listRepoMeta(ref, null, (async () => jsonResponse({ id: 1 })) as never);
    expect(ok.ok).toBe(true);
    const bad = await listRepoMeta(ref, "t", (async () => jsonResponse({}, 401)) as never);
    expect(bad.ok).toBe(false);
    expect(bad.message).toContain("401");
  });
});

// ── SYS-007：环回校验矩阵 ──

describe("assertLoopbackUrl（SYS-007 §2）", () => {
  const ok = ["http://127.0.0.1:7001", "http://localhost:7001/healthz", "http://[::1]:7001", "https://127.0.0.1/x"];
  const bad = ["http://192.168.1.1:7001", "http://10.0.0.9:1", "not-a-url", "ftp://127.0.0.1/x"];
  for (const u of ok) {
    it(`放行 ${u}`, () => {
      expect(() => assertLoopbackUrl(u)).not.toThrow();
    });
  }
  for (const u of bad) {
    it(`拒绝 ${u}`, () => {
      expect(() => assertLoopbackUrl(u)).toThrow(DomainError);
    });
  }
});

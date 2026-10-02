/** SYS-009：scope 模型单测——parseScope 边界 + requiredScopeFor 矩阵（exec 注册表/方法缺省/段通配）。 */
import { describe, expect, it } from "vitest";
import { EXEC_ROUTES, normalizeUserCode, parseScope, requiredScopeFor } from "../system/oauth";

describe("parseScope", () => {
  it("空/缺省 → 最小权限 read", () => {
    expect(parseScope(undefined)).toEqual(["read"]);
    expect(parseScope("")).toEqual(["read"]);
    expect(parseScope(null)).toEqual(["read"]);
  });
  it("逗号/空白分隔 + 去重", () => {
    expect(parseScope("read,exec")).toEqual(["read", "exec"]);
    expect(parseScope("read exec read")).toEqual(["read", "exec"]);
  });
  it("非法值 → null（调用方回 invalid_scope）", () => {
    expect(parseScope("read,admin")).toBeNull();
    expect(parseScope("write,x")).toBeNull();
  });
});

describe("requiredScopeFor", () => {
  it("exec 注册表命中（13 条逐一验证）", () => {
    const concrete: Array<[string, string]> = [
      ["POST", "/api/v1/projects/6f1c/exec-tasks"],
      ["POST", "/api/v1/projects/6f1c/exec-tasks/t1/rerun"],
      ["POST", "/api/v1/projects/6f1c/exec-tasks/t1/stop"],
      ["POST", "/api/v1/projects/6f1c/apis/a1/cases/execute"],
      ["POST", "/api/v1/projects/6f1c/scenarios/execute"],
      ["POST", "/api/v1/projects/6f1c/scenarios/s1/execute"],
      ["POST", "/api/v1/projects/6f1c/scenarios/s1/steps/st1/execute"],
      ["POST", "/api/v1/projects/6f1c/plans/p1/execute"],
      ["POST", "/api/v1/projects/6f1c/plans/p1/cases/batch-executor"],
      ["POST", "/api/v1/projects/6f1c/plans/p1/cases/r1/exec"],
      ["POST", "/api/v1/projects/6f1c/plans/p1/cases/r1/run"],
      ["POST", "/api/v1/projects/6f1c/scenario-schedules/sc1/run"],
      ["POST", "/api/v1/open/exec/api-case"],
    ];
    expect(concrete).toHaveLength(EXEC_ROUTES.length);
    for (const [m, p] of concrete) {
      expect(requiredScopeFor(m, p), `${m} ${p}`).toBe("exec");
    }
  });
  it("方法缺省：GET/HEAD→read，其余→write", () => {
    expect(requiredScopeFor("GET", "/api/v1/projects/p/cases")).toBe("read");
    expect(requiredScopeFor("HEAD", "/api/v1/personal/me")).toBe("read");
    expect(requiredScopeFor("POST", "/api/v1/projects/p/cases")).toBe("write");
    expect(requiredScopeFor("PUT", "/api/v1/projects/p/cases/c")).toBe("write");
    expect(requiredScopeFor("DELETE", "/api/v1/projects/p/cases/c")).toBe("write");
  });
  it("exec 路由 GET 查询按 read（任务状态轮询）", () => {
    expect(requiredScopeFor("GET", "/api/v1/open/exec/task-1")).toBe("read");
    expect(requiredScopeFor("GET", "/api/v1/projects/p/exec-tasks")).toBe("read");
  });
  it("段通配不误伤同前缀路径", () => {
    // swagger-sync 的 /run 不在 exec 注册表（同步任务非测试执行）→ write
    expect(requiredScopeFor("POST", "/api/v1/projects/p/swagger-sync/t1/run")).toBe("write");
    // 路径长度不同不匹配
    expect(requiredScopeFor("POST", "/api/v1/projects/p/exec-tasks/t1")).toBe("write");
  });
});

describe("user_code 规范化", () => {
  it("大小写/连字符/空白归一", () => {
    expect(normalizeUserCode("k7mp-q4t2")).toBe("K7MPQ4T2");
    expect(normalizeUserCode(" K7MP Q4T2 ")).toBe("K7MPQ4T2");
  });
});

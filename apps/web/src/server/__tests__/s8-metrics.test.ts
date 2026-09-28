/** S8 INFRA-004：HTTP 计数器单测（/system/metrics 数据源）。 */
import { describe, expect, it } from "vitest";
import { httpCounterSnapshot, httpIncr, routeGroupOf } from "../metrics-counter";

describe("metrics-counter", () => {
  it("routeGroupOf：项目/系统/组织段规整，乱序字符清洗", () => {
    expect(routeGroupOf("/api/v1/projects/p1/cases")).toBe("projects");
    expect(routeGroupOf("/api/v1/system/users")).toBe("system");
    expect(routeGroupOf("/api/v1/orgs/o1/groups")).toBe("orgs");
    expect(routeGroupOf("/api/v1/exec-tasks")).toBe("exec-tasks");
    expect(routeGroupOf("/api/v1/auth/login")).toBe("auth");
    expect(routeGroupOf("/api/v1/personal/ai-model")).toBe("personal");
    expect(routeGroupOf("/")).toBe("root");
  });

  it("httpIncr + snapshot：按组×状态类聚合计数", () => {
    httpIncr("/api/v1/projects/p1/cases", 200);
    httpIncr("/api/v1/projects/p1/cases", 200);
    httpIncr("/api/v1/projects/p1/cases", 422);
    httpIncr("/api/v1/system/metrics", 403);
    const snap = httpCounterSnapshot();
    const g = (rg: string, sc: string) =>
      snap.find((s) => s.routeGroup === rg && s.statusClass === sc)?.value ?? 0;
    expect(g("projects", "2xx")).toBeGreaterThanOrEqual(2);
    expect(g("projects", "4xx")).toBeGreaterThanOrEqual(1);
    expect(g("system", "4xx")).toBeGreaterThanOrEqual(1);
  });
});

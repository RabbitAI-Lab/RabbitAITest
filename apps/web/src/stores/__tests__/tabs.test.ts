import { beforeEach, describe, expect, it } from "vitest";
import { HOME_TAB_KEY, TAB_CAP, matchTabKey, realmOf, useTabsStore } from "../tabs";

/** SYS-010 多标签 store：开/关/相邻激活/批量/上限/恢复/域判定/URL 匹配（§5 单测行）。 */

function state() {
  return useTabsStore.getState();
}

beforeEach(() => {
  useTabsStore.setState({
    tabs: [{ key: HOME_TAB_KEY, realm: "project" as const, pinned: true }],
    activeKey: HOME_TAB_KEY,
  });
});

describe("realmOf 域判定", () => {
  it("按路径前缀三域分发", () => {
    expect(realmOf("/")).toBe("project");
    expect(realmOf("/cases")).toBe("project");
    expect(realmOf("/org")).toBe("org");
    expect(realmOf("/org/projects/x")).toBe("org");
    expect(realmOf("/organizations")).toBe("project"); // 前缀必须是 /org 或 /org/
    expect(realmOf("/system")).toBe("system");
    expect(realmOf("/system/users")).toBe("system");
    expect(realmOf("/system32")).toBe("project");
  });
});

describe("open", () => {
  it("追加并激活；已存在仅激活", () => {
    expect(state().open("/cases")).toBe(true);
    expect(state().tabs).toHaveLength(2);
    expect(state().activeKey).toBe("/cases");
    state().open("/bugs");
    expect(state().open("/cases")).toBe(true);
    expect(state().tabs).toHaveLength(3);
    expect(state().activeKey).toBe("/cases");
  });

  it("realm 按路径推导", () => {
    state().open("/system/users");
    expect(state().tabs.at(-1)?.realm).toBe("system");
  });

  it("超上限拒绝且不激活", () => {
    for (let i = 1; i < TAB_CAP; i++) state().open(`/p${i}`);
    expect(state().tabs).toHaveLength(TAB_CAP);
    expect(state().open("/overflow")).toBe(false);
    expect(state().tabs).toHaveLength(TAB_CAP);
    expect(state().activeKey).toBe(`/p${TAB_CAP - 1}`);
  });
});

describe("close", () => {
  it("关非激活标签不动 activeKey", () => {
    state().open("/a");
    state().open("/b");
    state().close("/a");
    expect(state().tabs.map((x) => x.key)).toEqual([HOME_TAB_KEY, "/b"]);
    expect(state().activeKey).toBe("/b");
  });

  it("关激活标签激活相邻（右优先，其次左）", () => {
    state().open("/a");
    state().open("/b");
    state().open("/c");
    state().activate("/b");
    state().close("/b"); // 右侧有 /c
    expect(state().activeKey).toBe("/c");
    state().activate("/c");
    state().close("/c"); // 无右侧 → 左侧 /a
    expect(state().activeKey).toBe("/a");
  });

  it("工作台 pinned 不可关", () => {
    state().close(HOME_TAB_KEY);
    expect(state().tabs).toHaveLength(1);
  });
});

describe("批量关闭", () => {
  it("closeOthers 保留 pinned 与当前", () => {
    state().open("/a");
    state().open("/b");
    state().activate("/b");
    state().closeOthers();
    expect(state().tabs.map((x) => x.key)).toEqual([HOME_TAB_KEY, "/b"]);
  });

  it("closeRight 保留激活及其左侧", () => {
    state().open("/a");
    state().open("/b");
    state().open("/c");
    state().activate("/b");
    state().closeRight();
    expect(state().tabs.map((x) => x.key)).toEqual([HOME_TAB_KEY, "/a", "/b"]);
  });

  it("closeAll 仅剩工作台并激活它", () => {
    state().open("/a");
    state().activate("/a");
    state().closeAll();
    expect(state().tabs.map((x) => x.key)).toEqual([HOME_TAB_KEY]);
    expect(state().activeKey).toBe(HOME_TAB_KEY);
  });
});

describe("restore", () => {
  it("恢复标签与激活态；缺失工作台自动补、超上限截断", () => {
    state().restore([{ key: "/a", realm: "project" }, { key: "/b", realm: "project" }], "/b");
    expect(state().tabs.map((x) => x.key)).toEqual([HOME_TAB_KEY, "/a", "/b"]);
    expect(state().activeKey).toBe("/b");

    useTabsStore.setState({ tabs: [], activeKey: "" });
    state().restore([{ key: "/x", realm: "project" }], "/不存在");
    expect(state().activeKey).toBe(HOME_TAB_KEY); // 兜底回落

    const many = Array.from({ length: 30 }, (_, k) => ({ key: `/m${k}`, realm: "project" as const }));
    state().restore(many, "/m0");
    expect(state().tabs.length).toBeLessThanOrEqual(TAB_CAP);
  });

  it("空列表不恢复（保持初始工作台）", () => {
    const before = state().tabs;
    state().restore([], "/");
    expect(state().tabs).toEqual(before);
  });
});

describe("matchTabKey URL→标签匹配", () => {
  const tabs = [
    { key: HOME_TAB_KEY, realm: "project" as const, pinned: true },
    { key: "/cases", realm: "project" as const },
    { key: "/cases/reviews", realm: "project" as const },
    { key: "/system/users", realm: "system" as const },
  ];

  it("精确命中优先", () => {
    expect(matchTabKey("/cases", tabs)).toBe("/cases");
    expect(matchTabKey("/system/users", tabs)).toBe("/system/users");
  });

  it("无精确时最长前缀（详情页归属其列表标签）", () => {
    expect(matchTabKey("/cases/123", tabs)).toBe("/cases");
    expect(matchTabKey("/cases/reviews/9", tabs)).toBe("/cases/reviews");
    expect(matchTabKey("/system/users/x/edit", tabs)).toBe("/system/users");
  });

  it("无匹配返回 null（不惊动标签）", () => {
    expect(matchTabKey("/login", tabs)).toBeNull();
    expect(matchTabKey("/org/projects", tabs)).toBeNull();
  });
});

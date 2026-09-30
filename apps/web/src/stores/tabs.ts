"use client";

import { create } from "zustand";

/** SYS-010 多标签页状态：浏览器式标签栏（开/关/批量/固定工作台/上限/域联动）。
 *  TabItem 仅存可序列化字段（key/realm/pinned）——title/icon 由 nav-config 按 key 派生，
 *  保证 sessionStorage 恢复不丢组件引用。 */

export type TabRealm = "project" | "org" | "system";

export interface TabItem {
  key: string; // 即路由路径（"/" 工作台、"/cases"、"/system/users"…）
  realm: TabRealm;
  pinned?: boolean; // 工作台固定标签不可关
}

export const TAB_CAP = 20;
export const HOME_TAB_KEY = "/";

/** 路由 → 域判定（SYS-010 §4：/org* 组织域、/system* 系统域、其余项目域）。 */
export function realmOf(path: string): TabRealm {
  if (path === "/org" || path.startsWith("/org/")) return "org";
  if (path === "/system" || path.startsWith("/system/")) return "system";
  return "project";
}

/** pathname → 应激活标签 key：精确命中，否则最长前缀（/cases/123 → /cases），无匹配 null。 */
export function matchTabKey(pathname: string, tabs: TabItem[]): string | null {
  if (tabs.some((t) => t.key === pathname)) return pathname;
  const prefix = tabs
    .filter((t) => t.key !== HOME_TAB_KEY && (pathname === t.key || pathname.startsWith(t.key + "/")))
    .sort((a, b) => b.key.length - a.key.length)[0];
  return prefix?.key ?? null;
}

interface TabsStore {
  tabs: TabItem[];
  activeKey: string;
  /** 打开（不存在则追加，超上限拒绝）并激活；返回是否成功（供调用方提示）。 */
  open: (key: string) => boolean;
  /** 仅激活已存在标签（URL 同步入口；不改路由）。 */
  activate: (key: string) => void;
  close: (key: string) => void;
  closeOthers: () => void;
  closeRight: () => void;
  closeAll: () => void;
  /** sessionStorage 恢复（layout 水合一次）。 */
  restore: (tabs: TabItem[], activeKey: string) => void;
}

function clampActive(tabs: TabItem[], activeKey: string): string {
  return tabs.some((t) => t.key === activeKey) ? activeKey : (tabs[0]?.key ?? HOME_TAB_KEY);
}

export const useTabsStore = create<TabsStore>()((set, get) => ({
  tabs: [{ key: HOME_TAB_KEY, realm: "project", pinned: true }],
  activeKey: HOME_TAB_KEY,

  open: (key) => {
    const { tabs } = get();
    const exists = tabs.some((t) => t.key === key);
    if (!exists && tabs.length >= TAB_CAP) return false;
    set({
      tabs: exists ? tabs : [...tabs, { key, realm: realmOf(key) }],
      activeKey: key,
    });
    return true;
  },

  activate: (key) => {
    if (get().activeKey !== key && get().tabs.some((t) => t.key === key)) set({ activeKey: key });
  },

  close: (key) => {
    const { tabs, activeKey } = get();
    const target = tabs.find((t) => t.key === key);
    if (!target || target.pinned) return;
    const idx = tabs.indexOf(target);
    const next = tabs.filter((t) => t.key !== key);
    // 关激活标签 → 激活相邻（右侧优先，其次左侧；next 恒含 pinned 工作台故非空）
    const neighbor = next[idx] ?? next[Math.max(0, idx - 1)] ?? next[0];
    const nextActive = key === activeKey && neighbor ? neighbor.key : activeKey;    set({ tabs: next, activeKey: clampActive(next, nextActive) });
  },

  closeOthers: () =>
    set((s) => {
      const next = s.tabs.filter((t) => t.pinned || t.key === s.activeKey);
      return { tabs: next, activeKey: clampActive(next, s.activeKey) };
    }),

  closeRight: () =>
    set((s) => {
      const idx = s.tabs.findIndex((t) => t.key === s.activeKey);
      const next = idx >= 0 ? s.tabs.slice(0, idx + 1) : s.tabs;
      return { tabs: next, activeKey: clampActive(next, s.activeKey) };
    }),

  closeAll: () =>
    set((s) => {
      const next = s.tabs.filter((t) => t.pinned);
      return { tabs: next, activeKey: clampActive(next, HOME_TAB_KEY) };
    }),

  restore: (tabs, activeKey) => {
    if (!tabs.length) return;
    const hasHome = tabs.some((t) => t.key === HOME_TAB_KEY && t.pinned);
    const normalized: TabItem[] = hasHome
      ? tabs
      : [{ key: HOME_TAB_KEY, realm: "project", pinned: true }, ...tabs];
    set({ tabs: normalized.slice(0, TAB_CAP), activeKey: clampActive(normalized, activeKey) });
  },
}));

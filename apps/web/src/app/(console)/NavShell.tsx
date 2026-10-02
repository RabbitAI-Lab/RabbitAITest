"use client";

import { ChevronRight } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { LeftNav } from "@/components/LeftNav";
import { TabBar } from "@/components/TabBar";
import { findNav } from "@/lib/nav-config";
import { HOME_TAB_KEY, matchTabKey, realmOf, useTabsStore } from "@/stores/tabs";

/** SYS-010 控制台客户端壳：LeftNav（三域）+ TabBar（多标签）+ 主区域 + 收起/展开编排。
 *  路由↔标签双向同步与刷新恢复在此统一（LeftNav/TabBar 只管渲染与动作）。 */

const SESSION_KEY = "rabbit.tabs.v1";

export function NavShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { tabs, activeKey, activate, open, restore } = useTabsStore();
  const [railHidden, setRailHidden] = useState(false);
  const restoredRef = useRef(false);

  // 刷新恢复（sessionStorage；仅一次）
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (raw) {
        const { tabs: saved, activeKey: ak } = JSON.parse(raw) as {
          tabs: { key: string; realm?: string; pinned?: boolean }[];
          activeKey: string;
        };
        // realm 容错重推导（旧数据/手改 sessionStorage 不致命）
        if (Array.isArray(saved) && saved.every((t) => typeof t?.key === "string")) {
          restore(
            saved.map((t) => ({
              key: t.key,
              realm: realmOf(t.key),
              pinned: t.pinned ?? undefined,
            })),
            ak,
          );
        }
      }
    } catch {
      /* 损坏即忽略 */
    }
  }, [restore]);

  // 标签持久化
  useEffect(() => {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({ tabs, activeKey }));
    } catch {
      /* quota 忽略 */
    }
  }, [tabs, activeKey]);

  // URL → 标签同步（直接输 URL/刷新/详情页/浏览器前进后退）：精确或最长前缀匹配则激活；
  // 外部直达菜单路径（或恢复失效）时自动开标签；非菜单路由不动。
  useEffect(() => {
    if (!pathname) return;
    const s = useTabsStore.getState();
    const matched = matchTabKey(pathname, s.tabs);
    if (matched) {
      if (s.activeKey !== matched) activate(matched);
      return;
    }
    if (pathname === HOME_TAB_KEY) {
      if (s.activeKey !== HOME_TAB_KEY) activate(HOME_TAB_KEY);
    } else if (findNav(pathname)) {
      open(pathname);
    }
  }, [pathname, activate, open]);

  return (
    <div className="min-h-screen flex flex-col">
      {/* TopBar 由 (console)/layout 渲染（server session），NavShell 只管其下 */}
      <div className="flex flex-1 overflow-hidden" style={{ minHeight: "calc(100vh - 48px)" }}>
        <LeftNav railHidden={railHidden} onToggleRail={() => setRailHidden(true)} />
        <section className="relative flex-1 flex flex-col min-w-0">
          {/* 左缘悬浮展开小圆钮（第⑧⑨轮：收起后出现，absolute 骑线不占宽） */}
          {railHidden && (
            <button
              onClick={() => setRailHidden(false)}
              data-testid="rail-expand"
              title="展开侧栏"
              aria-label="展开侧栏"
              className="absolute left-[-9px] top-1/2 -translate-y-1/2 z-20 w-[18px] h-[18px] rounded-full bg-white border border-[#DDE0E6] shadow-[0_1px_4px_rgba(31,35,41,0.10)] grid place-items-center text-[#87888D] hover:text-[#1F2329] hover:border-[#B9BDC6] cursor-pointer"
            >
              <ChevronRight size={12} />
            </button>
          )}
          <TabBar />
          <main className="flex-1 p-6 min-w-0 overflow-y-auto">{children}</main>
        </section>
      </div>
    </div>
  );
}

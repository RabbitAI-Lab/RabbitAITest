"use client";

import { ChevronsDown, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { LayoutDashboard } from "lucide-react";
import { useApp } from "@/hooks/useApp";
import { findNav } from "@/lib/nav-config";
import { useTabsStore } from "@/stores/tabs";

/** 供 LeftNav/TopBar 等菜单入口调用：打开并激活标签（超上限 message 提示）。 */
export function useOpenTab() {
  const open = useTabsStore((s) => s.open);
  const { message } = useApp();
  return (key: string) => {
    if (!open(key)) message.warning("标签已达上限 20 个，请先关闭部分标签");
  };
}

/** SYS-010 内容区多标签栏（浏览器式）：自绘 div+Tailwind（布局类不挂 antd 根——antd 无层样式压制坑）。
 *  title/icon 由 nav-config 按 key 派生；路由↔标签双向同步在 (console)/layout 统一编排。 */

interface CtxAction {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

function CtxMenu({
  actions,
  x,
  y,
  mode = "fixed",
}: {
  actions: CtxAction[];
  x?: number;
  y?: number;
  mode?: "fixed" | "absolute";
}) {
  return (
    <div
      className={`${mode === "fixed" ? "fixed" : "absolute"} z-40 w-44 bg-white border border-[#E5E6EB] rounded-lg shadow-lg py-1`}
      style={mode === "fixed" ? { left: x, top: y } : { right: 0, top: "100%" }}
      data-testid={mode === "fixed" ? "tab-ctx-menu" : "tab-ops-menu"}
    >
      {actions.map((a) => (
        <button
          key={a.label}
          disabled={a.disabled}
          onClick={a.onClick}
          className={`w-full text-left px-3 py-1.5 text-[13px] ${a.disabled ? "text-[#C0C4CC] cursor-not-allowed" : "text-[#3D4350] hover:bg-[#F2F3F5]"}`}
        >
          {a.label}
        </button>
      ))}
    </div>
  );
}

export function TabBar() {
  const router = useRouter();
  const { tabs, activeKey, activate, close, closeOthers, closeRight, closeAll } = useTabsStore();
  const [ctx, setCtx] = useState<{ x: number; y: number; key: string } | null>(null);
  const [opsOpen, setOpsOpen] = useState(false);
  const opsRef = useRef<HTMLDivElement>(null);

  // 点击空白处关闭右键菜单/批量下拉
  useEffect(() => {
    if (!ctx && !opsOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (ctx && !(e.target as HTMLElement).closest('[data-testid="tab-ctx-menu"]')) setCtx(null);
      if (opsOpen && opsRef.current && !opsRef.current.contains(e.target as Node))
        setOpsOpen(false);
    };
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, [ctx, opsOpen]);

  /** 关闭并导航到关闭后的激活标签 */
  const closeAndGo = (key: string) => {
    close(key);
    router.push(useTabsStore.getState().activeKey);
  };
  /** 批量动作后路由跟随新激活标签（关闭含激活标签时避免停留在已关路由） */
  const runAndGo = (fn: () => void) => {
    fn();
    router.push(useTabsStore.getState().activeKey);
  };

  const opsItems: CtxAction[] = [
    { label: "关闭其他标签页", onClick: () => runAndGo(closeOthers) },
    { label: "关闭右侧标签页", onClick: () => runAndGo(closeRight) },
    { label: "全部关闭（保留工作台）", onClick: () => runAndGo(closeAll) },
  ];

  return (
    <div
      className="h-9 flex items-stretch bg-[#E9EBF0] border-b border-[#E0E2E8] shrink-0"
      data-testid="tab-bar"
    >
      <div
        className="flex items-end gap-1 overflow-x-auto flex-1 min-w-0 px-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        onWheel={(e) => {
          // 滚动条已隐藏，滚轮转横滚（SYS-010 §1.2 #7）
          if (e.deltaY !== 0) e.currentTarget.scrollLeft += e.deltaY;
        }}
      >
        {tabs.map((t) => {
          const active = t.key === activeKey;
          const nav = findNav(t.key);
          const Icon = nav?.icon ?? LayoutDashboard;
          return (
            <div
              key={t.key}
              data-testid={`tab-${t.key}`}
              onClick={() => {
                activate(t.key);
                router.push(t.key);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                setCtx({
                  x: Math.max(8, Math.min(e.clientX, window.innerWidth - 190)),
                  y: Math.max(8, Math.min(e.clientY, window.innerHeight - 180)),
                  key: t.key,
                });
              }}
              className={`group flex items-center gap-1.5 pl-3 ${t.pinned ? "pr-3" : "pr-1.5"} h-8 mt-1 rounded-t-md cursor-pointer text-[12px] whitespace-nowrap shrink-0 select-none transition-colors ${active ? "bg-white text-[#1F2329] font-medium" : "text-[#646A73] hover:bg-white/60"}`}
              style={active ? { borderTop: "2px solid var(--rabbit-primary, #574BFF)" } : undefined}
            >
              <Icon
                size={14}
                className={`shrink-0 ${active ? "text-[var(--rabbit-primary,#574BFF)]" : "text-[#87888D]"}`}
              />
              <span>{nav?.label ?? t.key}</span>
              {!t.pinned && (
                <span
                  data-testid={`tab-close-${t.key}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    closeAndGo(t.key);
                  }}
                  className={`ml-0.5 w-4 h-4 rounded grid place-items-center text-[#87888D] hover:bg-black/10 hover:text-[#1F2329] ${active ? "" : "opacity-0 group-hover:opacity-100"}`}
                >
                  <X size={12} />
                </span>
              )}
            </div>
          );
        })}
      </div>
      <div ref={opsRef} className="relative shrink-0 flex items-center border-l border-[#E0E2E8]">
        <button
          data-testid="tabs-ops"
          onClick={() => setOpsOpen((v) => !v)}
          className="h-full px-2.5 flex items-center gap-1 text-[12px] text-[#646A73] hover:text-[#1F2329] hover:bg-white/60"
        >
          <ChevronsDown size={14} />
          批量
        </button>
        {opsOpen && <CtxMenu mode="absolute" actions={opsItems} />}
      </div>
      {ctx && (
        <CtxMenu
          x={ctx.x}
          y={ctx.y}
          actions={[
            {
              label: "关闭标签页",
              onClick: () => closeAndGo(ctx.key),
              disabled: tabs.find((x) => x.key === ctx.key)?.pinned,
            },
            { label: "关闭其他标签页", onClick: () => runAndGo(closeOthers) },
            { label: "关闭右侧标签页", onClick: () => runAndGo(closeRight) },
            { label: "全部关闭（保留工作台）", onClick: () => runAndGo(closeAll) },
          ]}
        />
      )}
    </div>
  );
}

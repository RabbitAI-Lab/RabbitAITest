"use client";

import { ArrowLeft, ChevronDown, ChevronLeft } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { NAV_GROUPS, type NavGroup } from "@/lib/nav-config";
import { useOpenTab } from "@/components/TabBar";
import { usePermissions, useProjectInfo } from "@/hooks/usePermissions";
import { realmOf, useTabsStore } from "@/stores/tabs";

/** SYS-010 三域侧栏：域由路由前缀决定（/org* /system* 其余项目域）；多项组可折叠（localStorage
 *  持久化）；单项组仅工作台直点无分组头；组织/系统域附「返回项目」。菜单数据见 lib/nav-config。 */

const COLLAPSED_KEY = "rabbit.nav.collapsed";
/** 多项组默认折叠集合（默认展开：接口测试；组织/系统域各自单组恒展开不持久化） */
const DEFAULT_COLLAPSED = ["tm", "task", "load", "uit", "pset"];

function useCollapsedGroups(): [Set<string>, (id: string) => void] {
  // hydration 对齐：首帧恒默认态（SSR/CSR 一致——浏览器记忆在挂载后恢复，防属性 mismatch 报错）；
  // 持久化仅在恢复完成后生效（否则首帧会把默认态覆盖进 localStorage 清掉用户记忆）
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(DEFAULT_COLLAPSED));
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(COLLAPSED_KEY);
      if (raw) setCollapsed(new Set(JSON.parse(raw) as string[]));
    } catch {
      /* 忽略配额/隐私模式 */
    }
    setRestored(true);
  }, []);
  useEffect(() => {
    if (!restored) return;
    try {
      localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsed]));
    } catch {
      /* 忽略配额/隐私模式 */
    }
  }, [collapsed, restored]);
  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return [collapsed, toggle];
}

function GroupSection({
  group,
  collapsed,
  onToggle,
  canGlobal,
  modules,
  activeKey,
  onNavigate,
}: {
  group: NavGroup;
  collapsed: Set<string>;
  onToggle: (id: string) => void;
  canGlobal: (perm: string) => boolean;
  modules: Record<string, boolean>;
  activeKey: string;
  onNavigate: (href: string) => void;
}) {
  const items = group.items.filter(
    (item) => (!item.perm || canGlobal(item.perm)) && (!item.module || modules[item.module]),
  );
  if (items.length === 0) return null;

  const link = (href: string, label: string, testid?: string) => {
    const active = href === activeKey;
    const cls = `nav-item relative flex items-center gap-2.5 mx-2 px-3 py-[7px] rounded-md text-[13px] transition-colors ${
      active
        ? "bg-[#574BFF]/8 text-[var(--rabbit-primary,#574BFF)] font-medium"
        : "text-[#3D4350] hover:bg-[#F2F3F5]"
    }`;
    const Icon = group.items.find((n) => n.href === href)?.icon;
    return (
      <a
        key={href}
        href={href}
        data-testid={testid}
        className={cls}
        onClick={(e) => {
          e.preventDefault();
          onNavigate(href);
        }}
      >
        {active && (
          <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-4 rounded-r bg-[var(--rabbit-primary,#574BFF)]" />
        )}
        {Icon && <Icon size={15} strokeWidth={1.8} className={active ? "" : "text-[#87888D]"} />}
        <span className="truncate">{label}</span>
      </a>
    );
  };

  // 单项直点（无分组头，仅工作台）
  if (group.single) {
    return <div className="pt-2.5">{items.map((it) => link(it.href, it.label, it.testid))}</div>;
  }

  const open = !collapsed.has(group.id);
  return (
    <div className={open ? "" : "nav-grp-collapsed"}>
      <button
        className="w-full flex items-center gap-1.5 px-4 pt-4 pb-1.5 text-[11px] text-[#909399] tracking-wide hover:text-[#646A73]"
        onClick={() => onToggle(group.id)}
        aria-expanded={open}
      >
        <ChevronDown
          size={12}
          className={`shrink-0 transition-transform ${open ? "" : "-rotate-90"}`}
        />
        <span className="font-medium">{group.label}</span>
      </button>
      <div className={open ? "" : "hidden"}>
        {items.map((it) => link(it.href, it.label, it.testid))}
      </div>
    </div>
  );
}

export function LeftNav({
  railHidden,
  onToggleRail,
}: {
  railHidden: boolean;
  onToggleRail: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const realm = realmOf(pathname ?? "/"); // 域由 URL 决定（唯一事实源；标签联动经 layout 同步 effect）
  const { canGlobal } = usePermissions();
  const project = useProjectInfo();
  const modules = project?.modules ?? {
    case: true,
    api: true,
    plan: true,
    bug: true,
    load: true,
    uit: true,
  };
  const openTab = useOpenTab();
  const activeKey = useTabsStore((s) => s.activeKey);
  const [collapsed, toggleCollapsed] = useCollapsedGroups();

  const navigate = (href: string) => {
    openTab(href);
    router.push(href);
  };

  const groups = NAV_GROUPS.filter((g) => g.realm === realm);
  const nonProject = realm !== "project";

  return (
    <aside
      data-testid="leftnav"
      className={`relative w-[208px] bg-white border-r border-[#E5E6EB] shrink-0 flex-col pb-4 overflow-y-auto transition-all duration-200 ${railHidden ? "!w-0 border-r-0 overflow-hidden" : "flex"} ${railHidden ? "[&>*]:invisible" : ""}`}
    >
      {nonProject && (
        <button
          onClick={() => navigate("/")}
          data-testid="back-to-project"
          className="flex items-center gap-2 m-2 mb-1 px-3 py-2 rounded-md text-[12px] text-[#646A73] hover:bg-[#F2F3F5] border border-[#ECEEF1]"
        >
          <ArrowLeft size={14} className="shrink-0" />
          返回项目
        </button>
      )}
      <div className="flex-1">
        {groups.map((g) => (
          <GroupSection
            key={g.id}
            group={g}
            collapsed={collapsed}
            onToggle={toggleCollapsed}
            canGlobal={canGlobal}
            modules={modules}
            activeKey={activeKey}
            onNavigate={navigate}
          />
        ))}
      </div>
      {/* 分割线中间的收起小圆钮（第③⑧轮：收起=侧栏整体隐藏） */}
      <button
        onClick={onToggleRail}
        data-testid="rail-toggle"
        title="收起侧栏"
        aria-label="收起侧栏"
        className={`absolute right-[-9px] top-1/2 -translate-y-1/2 z-20 w-[18px] h-[18px] rounded-full bg-white border border-[#DDE0E6] shadow-[0_1px_4px_rgba(31,35,41,0.10)] grid place-items-center text-[#87888D] hover:text-[#1F2329] hover:border-[#B9BDC6] cursor-pointer ${railHidden ? "hidden" : ""}`}
      >
        <ChevronLeft size={12} />
      </button>
    </aside>
  );
}

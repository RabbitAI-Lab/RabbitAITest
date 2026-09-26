"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bug,
  FlaskConical,
  LayoutDashboard,
  Network,
  ScrollText,
  Settings,
  Users,
  UserSquare2,
  SlidersHorizontal,
  FolderKanban,
  ClipboardCheck,
} from "lucide-react";
import { usePermissions, useProjectInfo } from "@/hooks/usePermissions";

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
  perm?: string; // 菜单级权限守卫（SYS-004：无权限点菜单不出现）
  module?: "case" | "plan" | "bug" | "api"; // 模块开关（PROJ-001：关闭=菜单隐藏）
  testid?: string;
}

export function LeftNav() {
  const pathname = usePathname();
  const { canGlobal } = usePermissions();
  const project = useProjectInfo();
  const modules = project?.modules ?? { case: true, api: true, plan: true, bug: true };

  const groups: { label: string; items: NavItem[] }[] = [
    {
      label: "工作区",
      items: [
        { href: "/", label: "工作台", icon: <LayoutDashboard size={15} strokeWidth={1.8} /> },
      ],
    },
    {
      label: "测试管理",
      items: [
        {
          href: "/cases",
          label: "测试用例",
          icon: <ScrollText size={15} strokeWidth={1.8} />,
          perm: "PROJECT_CASE:READ",
          module: "case",
        },
        {
          href: "/reviews",
          label: "用例评审",
          icon: <ClipboardCheck size={15} strokeWidth={1.8} />,
          perm: "PROJECT_CASE_REVIEW:READ",
          module: "case",
          testid: "nav-reviews",
        },
        {
          href: "/plans",
          label: "测试计划",
          icon: <Network size={15} strokeWidth={1.8} />,
          perm: "PROJECT_PLAN:READ",
          module: "plan",
          testid: "nav-plans",
        },
        {
          href: "/bugs",
          label: "缺陷管理",
          icon: <Bug size={15} strokeWidth={1.8} />,
          perm: "PROJECT_BUG:READ",
          module: "bug",
          testid: "nav-bugs",
        },
      ],
    },
    {
      label: "接口测试",
      items: [
        {
          href: "/debug",
          label: "接口调试",
          icon: <FlaskConical size={15} strokeWidth={1.8} />,
          module: "api",
        },
      ],
    },
    {
      label: "组织",
      items: [
        {
          href: "/org/projects",
          label: "项目管理",
          icon: <FolderKanban size={15} strokeWidth={1.8} />,
          perm: "ORG_PROJECT:READ",
          testid: "nav-org-projects",
        },
        {
          href: "/org/groups",
          label: "用户组",
          icon: <UserSquare2 size={15} strokeWidth={1.8} />,
          perm: "ORG_GROUP:READ",
          testid: "nav-org-groups",
        },
        {
          href: "/org/templates",
          label: "模板管理",
          icon: <ClipboardCheck size={15} strokeWidth={1.8} />,
          perm: "ORG_TEMPLATE:READ",
          testid: "nav-org-templates",
        },
      ],
    },
    {
      label: "项目设置",
      items: [
        {
          href: "/settings/info",
          label: "基本信息",
          icon: <Settings size={15} strokeWidth={1.8} />,
          testid: "nav-settings-info",
        },
        {
          href: "/settings/members",
          label: "成员管理",
          icon: <Users size={15} strokeWidth={1.8} />,
          perm: "PROJECT_MEMBER:READ",
          testid: "nav-settings-members",
        },
        {
          href: "/settings/groups",
          label: "用户组",
          icon: <UserSquare2 size={15} strokeWidth={1.8} />,
          perm: "PROJECT_GROUP:READ",
          testid: "nav-settings-groups",
        },
        {
          href: "/settings/templates",
          label: "模板管理",
          icon: <SlidersHorizontal size={15} strokeWidth={1.8} />,
          perm: "PROJECT_TEMPLATE:READ",
          testid: "nav-settings-templates",
        },
      ],
    },
    {
      label: "系统设置",
      items: [
        {
          href: "/system/users",
          label: "用户管理",
          icon: <Users size={15} strokeWidth={1.8} />,
          perm: "SYSTEM_USER:READ",
          testid: "nav-system-users",
        },
        {
          href: "/system/groups",
          label: "用户组",
          icon: <UserSquare2 size={15} strokeWidth={1.8} />,
          perm: "SYSTEM_GROUP:READ",
          testid: "nav-system-groups",
        },
        {
          href: "/system/params",
          label: "参数设置",
          icon: <SlidersHorizontal size={15} strokeWidth={1.8} />,
          perm: "SYSTEM_PARAM:READ",
          testid: "nav-system-params",
        },
      ],
    },
  ];

  return (
    <aside
      data-testid="leftnav"
      className="w-[208px] bg-white border-r border-[#E5E6EB] shrink-0 pb-4 overflow-y-auto"
    >
      {groups.map((g) => {
        const items = g.items.filter(
          (item) => (!item.perm || canGlobal(item.perm)) && (!item.module || modules[item.module]),
        );
        if (items.length === 0) return null;
        return (
          <div key={g.label}>
            <p className="nav-group-label">{g.label}</p>
            {items.map((item) => {
              const active =
                item.href === "/"
                  ? pathname === "/"
                  : pathname === item.href || pathname.startsWith(item.href + "/");
              const cls = `relative flex items-center gap-2.5 mx-2 px-3 py-[7px] rounded-md text-[13px] transition-colors ${
                active
                  ? "bg-[#574BFF]/8 text-[#574BFF] font-medium"
                  : "text-[#3D4350] hover:bg-[#F2F3F5]"
              }`;
              return (
                <Link key={item.href} href={item.href} className={cls} data-testid={item.testid}>
                  {active && (
                    <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-4 rounded-r bg-[#574BFF]" />
                  )}
                  {item.icon}
                  {item.label}
                </Link>
              );
            })}
          </div>
        );
      })}
    </aside>
  );
}

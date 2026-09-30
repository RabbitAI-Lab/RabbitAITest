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
  Workflow,
  Sparkles,
  Puzzle,
  RefreshCw,
  KeyRound,
  FileCode2,
  Bell,
  UserCircle2,
  Building2,
  ShieldCheck,
  Gauge,
  MonitorPlay,
} from "lucide-react";
import { usePermissions, useProjectInfo } from "@/hooks/usePermissions";

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
  perm?: string; // 菜单级权限守卫（SYS-004：无权限点菜单不出现）
  module?: "case" | "plan" | "bug" | "api" | "load" | "uit"; // 模块开关（PROJ-001：关闭=菜单隐藏；缺省全开=ENTP-009 开源口径）
  testid?: string;
}

export function LeftNav() {
  const pathname = usePathname();
  const { canGlobal } = usePermissions();
  const project = useProjectInfo();
  const modules = project?.modules ?? { case: true, api: true, plan: true, bug: true, load: true, uit: true };

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
          href: "/apis",
          label: "接口定义",
          icon: <Network size={15} strokeWidth={1.8} />,
          perm: "PROJECT_API:READ",
          module: "api",
          testid: "nav-apis",
        },
        {
          href: "/debug",
          label: "接口调试",
          icon: <FlaskConical size={15} strokeWidth={1.8} />,
          module: "api",
        },
        {
          href: "/scenarios",
          label: "接口场景",
          icon: <Workflow size={15} strokeWidth={1.8} />,
          perm: "PROJECT_SCENARIO:READ",
          module: "api",
          testid: "nav-scenarios",
        },
        {
          href: "/reports",
          label: "接口报告",
          icon: <ScrollText size={15} strokeWidth={1.8} />,
          perm: "PROJECT_REPORT:READ",
          module: "api",
          testid: "nav-reports",
        },
        {
          href: "/files",
          label: "文件管理",
          icon: <FolderKanban size={15} strokeWidth={1.8} />,
          perm: "PROJECT_FILE:READ",
          module: "api",
          testid: "nav-files",
        },
      ],
    },
    {
      label: "任务中心",
      items: [
        {
          href: "/tasks",
          label: "任务中心",
          icon: <ClipboardCheck size={15} strokeWidth={1.8} />,
          perm: "PROJECT_EXEC_TASK:READ",
          testid: "nav-tasks",
        },
      ],
    },
    // S11 LOAD-003/UIT-002：真实模块（三重门控=模块开关 ∧ 权限点 ∧ License 特性；License 不满足时页面层回退占位卡片）
    {
      label: "性能测试",
      items: [
        {
          href: "/load",
          label: "性能测试",
          icon: <Gauge size={15} strokeWidth={1.8} />,
          perm: "PROJECT_LOAD:READ",
          module: "load",
          testid: "nav-load",
        },
      ],
    },
    {
      label: "UI 测试",
      items: [
        {
          href: "/ui-test",
          label: "UI 测试",
          icon: <MonitorPlay size={15} strokeWidth={1.8} />,
          perm: "PROJECT_UIT:READ",
          module: "uit",
          testid: "nav-uit",
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
          href: "/org/members",
          label: "成员管理",
          icon: <Users size={15} strokeWidth={1.8} />,
          perm: "ORG_MEMBER:READ",
          testid: "nav-org-members",
        },
        {
          href: "/org/departments",
          label: "部门管理",
          icon: <Network size={15} strokeWidth={1.8} />,
          perm: "ORG_DEPARTMENT:READ",
          testid: "nav-org-departments",
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
        {
          href: "/settings/environments",
          label: "环境管理",
          icon: <FlaskConical size={15} strokeWidth={1.8} />,
          perm: "PROJECT_ENV:READ",
          testid: "nav-settings-envs",
        },
        {
          href: "/settings/public-scripts",
          label: "公共脚本",
          icon: <FileCode2 size={15} strokeWidth={1.8} />,
          perm: "PROJECT_SCRIPT:READ",
          testid: "nav-settings-public-scripts",
        },
        {
          href: "/settings/messages",
          label: "消息管理",
          icon: <Bell size={15} strokeWidth={1.8} />,
          perm: "PROJECT_MESSAGE:READ",
          testid: "nav-settings-messages",
        },
        {
          href: "/settings/ai-prompts",
          label: "AI 提示词",
          icon: <Sparkles size={15} strokeWidth={1.8} />,
          perm: "PROJECT_AI:READ",
          testid: "nav-settings-ai-prompts",
        },
        {
          href: "/settings/integrations",
          label: "服务集成",
          icon: <Network size={15} strokeWidth={1.8} />,
          perm: "ORG_INTEGRATION:READ",
          testid: "nav-settings-integrations",
        },
        {
          href: "/settings/swagger-sync",
          label: "Swagger 同步",
          icon: <RefreshCw size={15} strokeWidth={1.8} />,
          perm: "PROJECT_API:READ",
          testid: "nav-settings-swagger-sync",
        },
        {
          href: "/personal",
          label: "个人中心",
          icon: <UserCircle2 size={15} strokeWidth={1.8} />,
          testid: "nav-personal-center",
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
        {
          href: "/system/sso",
          label: "认证配置",
          icon: <KeyRound size={15} strokeWidth={1.8} />,
          perm: "ENTP_SSO:READ",
          testid: "nav-system-sso",
        },
        {
          href: "/system/orgs",
          label: "组织管理",
          icon: <Building2 size={15} strokeWidth={1.8} />,
          perm: "ENTP_ORG:READ",
          testid: "nav-system-orgs",
        },
        {
          href: "/system/license",
          label: "授权管理",
          icon: <ShieldCheck size={15} strokeWidth={1.8} />,
          perm: "SYSTEM_LICENSE:READ",
          testid: "nav-system-license",
        },
        {
          href: "/system/pools",
          label: "资源池",
          icon: <LayoutDashboard size={15} strokeWidth={1.8} />,
          perm: "SYSTEM_POOL:READ",
          testid: "nav-system-pools",
        },
        {
          href: "/system/ai-models",
          label: "模型设置",
          icon: <Sparkles size={15} strokeWidth={1.8} />,
          perm: "SYSTEM_AI:READ",
          testid: "nav-system-ai-models",
        },
        {
          href: "/system/plugins",
          label: "插件管理",
          icon: <Puzzle size={15} strokeWidth={1.8} />,
          perm: "SYSTEM_PLUGIN:READ",
          testid: "nav-system-plugins",
        },
        {
          href: "/system/audit-logs",
          label: "系统日志",
          icon: <ScrollText size={15} strokeWidth={1.8} />,
          perm: "SYSTEM_AUDIT:READ",
          testid: "nav-system-audit-logs",
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
                  ? "bg-[#574BFF]/8 text-[var(--rabbit-primary,#574BFF)] font-medium"
                  : "text-[#3D4350] hover:bg-[#F2F3F5]"
              }`;
              return (
                <Link key={item.href} href={item.href} className={cls} data-testid={item.testid}>
                  {active && (
                    <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-4 rounded-r bg-[var(--rabbit-primary,#574BFF)]" />
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

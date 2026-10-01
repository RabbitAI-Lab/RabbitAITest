"use client";

import {
  Bell,
  Bug,
  ClipboardCheck,
  ClipboardList,
  FileCode2,
  FileText,
  FlaskConical,
  FolderKanban,
  Gauge,
  GitBranch,
  KeyRound,
  LayoutDashboard,
  MonitorPlay,
  Network,
  Puzzle,
  RefreshCw,
  ScrollText,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  UserSquare2,
  Users,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import type { TabRealm } from "@/stores/tabs";

/** SYS-010 三域菜单配置：LeftNav（侧栏渲染）与 TabBar（标签 title/icon）共用的事实源。 */

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  perm?: string; // 菜单级权限守卫（SYS-004）
  module?: "case" | "plan" | "bug" | "api" | "load" | "uit"; // 模块开关（PROJ-001）
  testid?: string;
}

export interface NavGroup {
  id: string;
  label: string;
  realm: TabRealm;
  icon?: LucideIcon; // 多项组分组图标（仅元数据保留；窄条方案已废弃，见 SYS-010 §3）
  single?: boolean; // 单项直点（无分组头）——仅工作台
  items: NavItem[];
}

const i = (I: LucideIcon) => ({ icon: I });

export const NAV_GROUPS: NavGroup[] = [
  {
    id: "work",
    label: "工作区",
    realm: "project",
    single: true,
    items: [{ href: "/", label: "工作台", ...i(LayoutDashboard) }],
  },
  {
    id: "tm",
    label: "测试管理",
    realm: "project",
    items: [
      {
        href: "/cases",
        label: "测试用例",
        ...i(ScrollText),
        perm: "PROJECT_CASE:READ",
        module: "case",
      },
      {
        href: "/reviews",
        label: "用例评审",
        ...i(ClipboardCheck),
        perm: "PROJECT_CASE_REVIEW:READ",
        module: "case",
        testid: "nav-reviews",
      },
      {
        href: "/plans",
        label: "测试计划",
        ...i(Network),
        perm: "PROJECT_PLAN:READ",
        module: "plan",
        testid: "nav-plans",
      },
      {
        href: "/bugs",
        label: "缺陷管理",
        ...i(Bug),
        perm: "PROJECT_BUG:READ",
        module: "bug",
        testid: "nav-bugs",
      },
    ],
  },
  {
    id: "api",
    label: "接口测试",
    realm: "project",
    items: [
      {
        href: "/apis",
        label: "接口定义",
        ...i(Network),
        perm: "PROJECT_API:READ",
        module: "api",
        testid: "nav-apis",
      },
      { href: "/debug", label: "接口调试", ...i(FlaskConical), module: "api" },
      {
        href: "/scenarios",
        label: "接口场景",
        ...i(Workflow),
        perm: "PROJECT_SCENARIO:READ",
        module: "api",
        testid: "nav-scenarios",
      },
      {
        href: "/reports",
        label: "接口报告",
        ...i(FileText),
        perm: "PROJECT_REPORT:READ",
        module: "api",
        testid: "nav-reports",
      },
      {
        href: "/files",
        label: "文件管理",
        ...i(FolderKanban),
        perm: "PROJECT_FILE:READ",
        module: "api",
        testid: "nav-files",
      },
    ],
  },
  {
    id: "task",
    label: "任务中心",
    realm: "project",
    items: [
      {
        href: "/tasks",
        label: "任务中心",
        ...i(ClipboardList),
        perm: "PROJECT_EXEC_TASK:READ",
        testid: "nav-tasks",
      },
    ],
  },
  {
    id: "load",
    label: "性能测试",
    realm: "project",
    items: [
      {
        href: "/load",
        label: "性能测试",
        ...i(Gauge),
        perm: "PROJECT_LOAD:READ",
        module: "load",
        testid: "nav-load",
      },
    ],
  },
  {
    id: "uit",
    label: "UI 测试",
    realm: "project",
    items: [
      {
        href: "/ui-test",
        label: "UI 测试",
        ...i(MonitorPlay),
        perm: "PROJECT_UIT:READ",
        module: "uit",
        testid: "nav-uit",
      },
    ],
  },
  {
    id: "pset",
    label: "项目设置",
    realm: "project",
    items: [
      { href: "/settings/info", label: "基本信息", ...i(Settings), testid: "nav-settings-info" },
      {
        href: "/settings/members",
        label: "成员管理",
        ...i(Users),
        perm: "PROJECT_MEMBER:READ",
        testid: "nav-settings-members",
      },
      {
        href: "/settings/groups",
        label: "用户组",
        ...i(UserSquare2),
        perm: "PROJECT_GROUP:READ",
        testid: "nav-settings-groups",
      },
      {
        href: "/settings/templates",
        label: "模板管理",
        ...i(SlidersHorizontal),
        perm: "PROJECT_TEMPLATE:READ",
        testid: "nav-settings-templates",
      },
      {
        href: "/settings/environments",
        label: "环境管理",
        ...i(FlaskConical),
        perm: "PROJECT_ENV:READ",
        testid: "nav-settings-envs",
      },
      {
        href: "/settings/public-scripts",
        label: "公共脚本",
        ...i(FileCode2),
        perm: "PROJECT_SCRIPT:READ",
        testid: "nav-settings-public-scripts",
      },
      {
        href: "/settings/messages",
        label: "消息管理",
        ...i(Bell),
        perm: "PROJECT_MESSAGE:READ",
        testid: "nav-settings-messages",
      },
      {
        href: "/settings/ai-prompts",
        label: "AI 提示词",
        ...i(Sparkles),
        perm: "PROJECT_AI:READ",
        testid: "nav-settings-ai-prompts",
      },
      {
        href: "/settings/integrations",
        label: "服务集成",
        ...i(Network),
        perm: "ORG_INTEGRATION:READ",
        testid: "nav-settings-integrations",
      },
      {
        href: "/settings/swagger-sync",
        label: "Swagger 同步",
        ...i(RefreshCw),
        perm: "PROJECT_API:READ",
        testid: "nav-settings-swagger-sync",
      },
      {
        href: "/settings/code-repos",
        label: "代码仓库",
        ...i(GitBranch),
        perm: "PROJECT_REPO:READ",
        testid: "nav-settings-code-repos",
      },
    ],
  },
  {
    id: "org",
    label: "组织管理",
    realm: "org",
    items: [
      {
        href: "/org/projects",
        label: "项目管理",
        ...i(FolderKanban),
        perm: "ORG_PROJECT:READ",
        testid: "nav-org-projects",
      },
      {
        href: "/org/members",
        label: "成员管理",
        ...i(Users),
        perm: "ORG_MEMBER:READ",
        testid: "nav-org-members",
      },
      {
        href: "/org/departments",
        label: "部门管理",
        ...i(Network),
        perm: "ORG_DEPARTMENT:READ",
        testid: "nav-org-departments",
      },
      {
        href: "/org/groups",
        label: "用户组",
        ...i(UserSquare2),
        perm: "ORG_GROUP:READ",
        testid: "nav-org-groups",
      },
      {
        href: "/org/templates",
        label: "模板管理",
        ...i(ClipboardCheck),
        perm: "ORG_TEMPLATE:READ",
        testid: "nav-org-templates",
      },
    ],
  },
  {
    id: "sys",
    label: "系统设置",
    realm: "system",
    items: [
      {
        href: "/system/users",
        label: "用户管理",
        ...i(Users),
        perm: "SYSTEM_USER:READ",
        testid: "nav-system-users",
      },
      {
        href: "/system/groups",
        label: "用户组",
        ...i(UserSquare2),
        perm: "SYSTEM_GROUP:READ",
        testid: "nav-system-groups",
      },
      {
        href: "/system/params",
        label: "参数设置",
        ...i(SlidersHorizontal),
        perm: "SYSTEM_PARAM:READ",
        testid: "nav-system-params",
      },
      {
        href: "/system/sso",
        label: "认证配置",
        ...i(KeyRound),
        perm: "ENTP_SSO:READ",
        testid: "nav-system-sso",
      },
      {
        href: "/system/orgs",
        label: "组织管理",
        ...i(Network),
        perm: "ENTP_ORG:READ",
        testid: "nav-system-orgs",
      },
      {
        href: "/system/license",
        label: "授权管理",
        ...i(ShieldCheck),
        perm: "SYSTEM_LICENSE:READ",
        testid: "nav-system-license",
      },
      {
        href: "/system/pools",
        label: "资源池",
        ...i(LayoutDashboard),
        perm: "SYSTEM_POOL:READ",
        testid: "nav-system-pools",
      },
      {
        href: "/system/ai-models",
        label: "模型设置",
        ...i(Sparkles),
        perm: "SYSTEM_AI:READ",
        testid: "nav-system-ai-models",
      },
      {
        href: "/system/plugins",
        label: "插件管理",
        ...i(Puzzle),
        perm: "SYSTEM_PLUGIN:READ",
        testid: "nav-system-plugins",
      },
      {
        href: "/system/scm-apps",
        label: "代码平台",
        ...i(GitBranch),
        perm: "SYSTEM_PARAM:READ",
        testid: "nav-system-scm-apps",
      },
      {
        href: "/system/audit-logs",
        label: "系统日志",
        ...i(ScrollText),
        perm: "SYSTEM_AUDIT:READ",
        testid: "nav-system-audit-logs",
      },
    ],
  },
];

/** 全量菜单项（域过滤/权限过滤由 LeftNav 做；TabBar 用 findNav 取元数据）。 */
export const ALL_NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

/** 路径 → 菜单项（含域归属）。 */
export function findNav(href: string): NavItem | undefined {
  return ALL_NAV_ITEMS.find((n) => n.href === href);
}

/**
 * 插件 SPI 单一来源（plugin-architecture.md §3；PLUG-001/002 随规格冻结）。
 * SPI 以语义化版本管理；插件清单声明兼容 SPI 范围，不兼容拒绝加载（70003）。
 */
import { z } from "zod";

/** 宿主当前支持的 SPI 版本（插件 spiVersion 必须等于该值才可加载） */
export const RABBIT_PLUGIN_SPI_VERSION = "1.0";

export const PLUGIN_KINDS = ["protocol", "platform", "driver"] as const;
export type PluginKind = (typeof PLUGIN_KINDS)[number];

/** 插件包清单（tarball 内 package.json → rabbitPlugin 字段） */
export const pluginManifestSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9-]{1,62}$/),
  kind: z.enum(PLUGIN_KINDS),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  spiVersion: z.string().regex(/^\d+\.\d+$/),
  entry: z.string().min(1).max(256),
  description: z.string().max(512).optional(),
});
export type PluginManifest = z.infer<typeof pluginManifestSchema>;

// ── 平台插件 SPI（INTG-001/002：jira / zentao / tapd 适配器实现该接口）──

export const PLATFORMS = ["jira", "zentao", "tapd"] as const;
export type Platform = (typeof PLATFORMS)[number];

/** 平台连接配置（web 侧解密后传入 runner；runner 不落盘） */
export interface PlatformConfig {
  address: string;
  authType: "BASIC" | "BEARER";
  username?: string;
  password?: string;
  token?: string;
}

/** 平台缺陷（拉取回写方向的规范化形态） */
export interface PlatformBug {
  platformKey: string;
  title: string;
  status: string; // 平台原始状态串（映射在 web 侧完成）
  updatedAt: string; // ISO
  url?: string;
}

/** 推送负载（本地 Bug → 平台创建/更新） */
export interface IssuePayload {
  projectKey: string;
  title: string;
  description: string;
  fields: Record<string, unknown>; // 本地模板自定义字段（适配器按平台语义翻译）
  bugType?: string; // 平台缺陷类型（bugTypes 映射后的目标值）
}

export interface PlatformRef {
  platformKey: string;
  url?: string;
}

/** 平台字段映射描述（模板自动生成口径） */
export interface PlatformField {
  localField: string;
  platformField: string;
  required: boolean;
}

export interface PlatformPlugin {
  platform: Platform;
  testConnection(cfg: PlatformConfig): Promise<void>;
  createIssue(cfg: PlatformConfig, payload: IssuePayload): Promise<PlatformRef>;
  updateIssue(
    cfg: PlatformConfig,
    platformKey: string,
    payload: IssuePayload,
  ): Promise<PlatformRef>;
  syncBugs(
    cfg: PlatformConfig,
    projectKey: string,
    since?: string /* ISO——HTTP JSON 序列化契约 */,
  ): Promise<PlatformBug[]>;
  fieldMapping(): PlatformField[];
}

// ── 协议插件 SPI（PLUG-002：engine 进程内加载）──

/** 任意协议采样器的标准化结果（映射进 step-result.responseSummary） */
export interface SamplerResult {
  ok: boolean;
  code: number; // 协议映射码（如 tcp: 0=连通 1=超时 2=拒绝）
  bodyText: string; // 响应/日志摘要（≤4KB）
  responseTimeMs: number;
  headers?: Record<string, string>;
}

export interface Sampler {
  run(): Promise<SamplerResult>;
}

export interface SamplerPlugin {
  protocol: string; // "tcp" / "websocket" / ...
  /** 协议配置 schema（前端动态表单与执行前校验共用） */
  configSchema: z.ZodType<Record<string, unknown>>;
  buildSampler(config: unknown): Sampler;
}

// ── 驱动插件 SPI（PLUG-004 运行时启用：engine in-process 执行面 + plugin-runner 管理面）──

/** 绑定参数值（引擎完成 {var|value} 解析后传入；仓库不提供变量→SQL 文本的插值通道——PLUG-004 §3） */
export interface DriverQueryParam {
  value?: string | number | boolean | null;
}

export interface DriverQueryRequest {
  /** 测试人员编写的语句原文（assertReadOnlySelect 白名单校验后透传；仓库代码不做任何拼装） */
  sqlText: string;
  /** 与语句中 ? 占位符一一对应，仅经驱动绑定通道传入 */
  params: DriverQueryParam[];
  /** 处理器路径恒 true（READ ONLY 事务） */
  readOnly?: boolean;
  timeoutMs?: number;
}

export interface DriverQueryResult {
  rows: Array<Record<string, string | number | boolean | null>>;
  /** 真实行数（rows 截断到上限后仍返回真实数） */
  rowCount: number;
  ms: number;
}

export interface DriverPlugin {
  driver: string; // "postgresql" | "mysql" | "oracle" | "sqlserver" | "dm"（插件 name 必须等于 driver，PLUG-002 勘误口径）
  testConnection(config: { url: string }): Promise<void>;
  query(config: { url: string }, req: DriverQueryRequest): Promise<DriverQueryResult>;
}

// ── 平台元数据（INTG-002：web 前端表单/文案的平台差异单一来源）──

export const PLATFORM_META: Record<
  Platform,
  {
    label: string;
    projectKeyLabel: string;
    projectKeyHint: string;
    authFields: Array<"username" | "password" | "token">;
    authTypeFixed?: "BASIC" | "BEARER";
  }
> = {
  jira: {
    label: "Jira",
    projectKeyLabel: "Jira 项目 Key",
    projectKeyHint: "如 RABBIT",
    authFields: ["username", "password", "token"],
  },
  zentao: {
    label: "禅道",
    projectKeyLabel: "禅道产品 ID",
    projectKeyHint: "数字，如 12",
    authFields: ["username", "password"],
    authTypeFixed: "BASIC",
  },
  tapd: {
    label: "TAPD",
    projectKeyLabel: "TAPD 项目 ID",
    projectKeyHint: "workspace_id，如 48731021",
    authFields: ["username", "password"],
    authTypeFixed: "BASIC",
  },
};

/** 平台状态 → 本地工作流状态的内置默认映射（项目关联配置可覆盖） */
export const PLATFORM_STATUS_DEFAULT_MAPPING: Record<Platform, Record<string, string>> = {
  jira: {
    "in progress": "进行中",
    indeterminate: "进行中",
    done: "已解决",
    resolved: "已解决",
    closed: "已关闭",
  },
  zentao: { active: "进行中", resolved: "已解决", closed: "已关闭" },
  tapd: {
    new: "进行中",
    in_progress: "进行中",
    resolved: "已解决",
    rejected: "已关闭",
    closed: "已关闭",
  },
};

/**
 * TAPD 平台插件（INTG-002 §2）：Basic Auth（api_user/api_password）；projectKey = workspace_id；
 * 拉取增量按 modified 过滤；自定义字段包装为 custom_field.* 。
 */
import type { PlatformConfig, IssuePayload, PlatformBug } from "@rabbit/shared";

function base(address: string): string {
  return address.replace(/\/+$/, "");
}

function authHeader(cfg: PlatformConfig): string {
  return `Basic ${Buffer.from(`${cfg.username ?? ""}:${cfg.password ?? ""}`).toString("base64")}`;
}

async function request<T>(
  cfg: PlatformConfig,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const res = await fetch(`${base(cfg.address)}${path}`, {
    method: init.method ?? "GET",
    headers: { Authorization: authHeader(cfg), "Content-Type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 401 || res.status === 403) {
    throw new Error("PLATFORM_UNAUTHORIZED: TAPD api_user/api_password 失效");
  }
  if (!res.ok) throw new Error(`TAPD ${init.method ?? "GET"} ${path} → ${res.status}`);
  const data = (await res.json()) as { status: number; data?: T; info?: string };
  if (data.status !== 1) throw new Error(`TAPD 业务失败: ${data.info ?? "unknown"}`);
  return data.data as T;
}

interface TapdBug {
  id: string;
  title: string;
  status: string;
  modified: string;
}

export default function createTapdPlugin() {
  return {
    platform: "tapd" as const,
    async testConnection(cfg: PlatformConfig) {
      const me = await request<{ email?: string; user?: string }>(cfg, "/quickstart/testauth");
      return { account: me.user ?? me.email ?? "tapd-user", email: me.email };
    },
    async createIssue(cfg: PlatformConfig, payload: IssuePayload) {
      const bug = await request<{ Bug: { id: string } }>(cfg, "/bugs", {
        method: "POST",
        body: {
          workspace_id: payload.projectKey,
          title: payload.title,
          description: payload.description,
          ...translateFields(payload.fields),
        },
      });
      return { platformKey: bug.Bug.id };
    },
    async updateIssue(cfg: PlatformConfig, platformKey: string, payload: IssuePayload) {
      await request(cfg, `/bugs/${platformKey}`, {
        method: "POST",
        body: {
          workspace_id: payload.projectKey,
          title: payload.title,
          description: payload.description,
          ...translateFields(payload.fields),
        },
      });
      return { platformKey };
    },
    async syncBugs(cfg: PlatformConfig, projectKey: string, since?: string): Promise<PlatformBug[]> {
      const sinceDate = since ? new Date(since) : undefined;
      const sinceParam = sinceDate ? `&modified=${encodeURIComponent(`>=${sinceDate!.toISOString().slice(0, 19).replace("T", " ")}`)}` : "";
      const res = await request<{ data: Array<{ Bug: TapdBug }> }>(
        cfg,
        `/bugs?workspace_id=${encodeURIComponent(projectKey)}&limit=100&order=modified desc${sinceParam}`,
      );
      return res.data.map(({ Bug: b }) => ({
        platformKey: b.id,
        title: b.title,
        status: b.status,
        updatedAt: b.modified,
      }));
    },
    fieldMapping() {
      return [
        { localField: "title", platformField: "title", required: true },
        { localField: "description", platformField: "description", required: false },
      ];
    },
  };
}

/** 自定义字段包装为 custom_field.*（适配器内消化平台差异，INTG-001 §2） */
function translateFields(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v !== null && v !== undefined) out[`custom_field_${k}`] = typeof v === "object" ? JSON.stringify(v) : String(v);
  }
  return out;
}

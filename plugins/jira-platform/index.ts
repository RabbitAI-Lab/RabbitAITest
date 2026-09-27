/**
 * Jira 平台插件（INTG-001 §4）：REST v2；Basic Auth / Bearer Token。
 * 经 plugin-runner worker 隔离执行（三方网络故障不拖垮 web 主进程）。
 * SPI：结构化匹配 @rabbit/shared PlatformPlugin（type-only 依赖，bundle 自包含）。
 */
import type { PlatformConfig, IssuePayload, PlatformBug } from "@rabbit/shared";

interface JiraIssue {
  key: string;
  fields: { summary: string; status: { name: string }; updated: string };
}

function authHeader(cfg: PlatformConfig): string {
  if (cfg.authType === "BEARER" && cfg.token) return `Bearer ${cfg.token}`;
  const basic = Buffer.from(`${cfg.username ?? ""}:${cfg.password ?? ""}`).toString("base64");
  return `Basic ${basic}`;
}

async function request<T>(
  cfg: PlatformConfig,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const res = await fetch(`${cfg.address.replace(/\/+$/, "")}${path}`, {
    method: init.method ?? "GET",
    headers: {
      Authorization: authHeader(cfg),
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 401 || res.status === 403) {
    throw new Error("PLATFORM_UNAUTHORIZED: Jira 凭据失效（401/403）");
  }
  if (!res.ok) {
    throw new Error(`Jira ${init.method ?? "GET"} ${path} → ${res.status}`);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

const CUSTOM_FIELD_PATTERN = /^cf_(\d+)$/;

/** 自定义字段按 cf[id] 约定直传（fields 键形如 cf_10042 → cf[10042]） */
function translateCustomFields(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    const m = k.match(CUSTOM_FIELD_PATTERN);
    if (m && v !== null && v !== undefined) out[`cf[${m[1]}]`] = String(v);
  }
  return out;
}

export default function createJiraPlugin() {
  return {
    platform: "jira" as const,
    async testConnection(cfg: PlatformConfig) {
      const me = await request<{ displayName: string; emailAddress?: string }>(cfg, "/rest/api/2/myself");
      return { account: me.displayName, email: me.emailAddress };
    },
    async createIssue(cfg: PlatformConfig, payload: IssuePayload) {
      const issue = await request<{ key: string }>(cfg, "/rest/api/2/issue", {
        method: "POST",
        body: {
          fields: {
            project: { key: payload.projectKey },
            summary: payload.title,
            description: payload.description,
            issuetype: { name: payload.bugType ?? "Bug" },
            ...translateCustomFields(payload.fields),
          },
        },
      });
      return { platformKey: issue.key };
    },
    async updateIssue(cfg: PlatformConfig, platformKey: string, payload: IssuePayload) {
      await request(cfg, `/rest/api/2/issue/${encodeURIComponent(platformKey)}`, {
        method: "PUT",
        body: {
          fields: {
            summary: payload.title,
            description: payload.description,
            ...translateCustomFields(payload.fields),
          },
        },
      });
      return { platformKey };
    },
    async syncBugs(cfg: PlatformConfig, projectKey: string, since?: Date): Promise<PlatformBug[]> {
      const jql = since
        ? `project = "${projectKey}" AND updated >= "${since.toISOString().slice(0, 19).replace("T", " ")}" ORDER BY updated DESC`
        : `project = "${projectKey}" ORDER BY updated DESC`;
      const res = await request<{ issues: JiraIssue[] }>(
        cfg,
        `/rest/api/2/search?maxResults=100&jql=${encodeURIComponent(jql)}`,
      );
      return res.issues.map((i) => ({
        platformKey: i.key,
        title: i.fields.summary,
        status: i.fields.status.name.toLowerCase(),
        updatedAt: i.fields.updated,
      }));
    },
    fieldMapping() {
      return [
        { localField: "title", platformField: "summary", required: true },
        { localField: "description", platformField: "description", required: false },
      ];
    },
  };
}

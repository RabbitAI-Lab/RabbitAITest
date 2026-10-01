/** FILE-001 Git 平台 REST adapter：四平台（gitea/github/gitlab/gitee）归一化为 listRepoMeta / fetchPath。
 *  fetch 注入可测；平台 API 形态差异（contents 族 vs gitlab tree+raw）在本层吸收。 */
import { DomainError, ErrCode } from "@rabbit/shared";
import type { FileRepoPlatform } from "@rabbit/shared";

export interface RepoRef {
  platform: FileRepoPlatform;
  url: string;
  host: string;
  scheme: string;
  owner: string;
  repo: string;
  apiBase: string;
}

export interface GitRemoteFile {
  path: string;
  content: Buffer;
  size: number;
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export class GitAdapterError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "GitAdapterError";
    this.status = status;
  }
}

/** 解析仓库 URL → API 定位（https://host/owner/repo[.git]）。 */
export function parseRepoUrl(platform: FileRepoPlatform, raw: string): RepoRef {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new DomainError(ErrCode.VALIDATION_FAILED, "仓库地址非法（需 https://host/owner/repo）");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new DomainError(ErrCode.VALIDATION_FAILED, "仓库地址仅允许 http(s)");
  }
  const parts = url.pathname.replace(/^\//, "").replace(/\/+$/, "").split("/");
  if (parts.length < 2 || !parts[0] || !parts[1]) {
    throw new DomainError(ErrCode.VALIDATION_FAILED, "仓库地址需含 owner/repo 路径");
  }
  const owner = parts[0];
  const repo = parts[1].replace(/\.git$/, "");
  const host = url.host; // 含端口（hostname 丢端口→环回 fetch 落 :80，S5 e2e 定位）
  const scheme = url.protocol.replace(":", "");
  let apiBase: string;
  switch (platform) {
    case "gitea":
      apiBase = `${scheme}://${host}/api/v1`;
      break;
    case "github":
      if (url.hostname !== "github.com" && url.hostname !== "www.github.com") {
        // 自建 GitHub Enterprise：/api/v3（S5 简化：仅支持标准路径形态）
        apiBase = `${scheme}://${host}/api/v3`;
      } else {
        apiBase = "https://api.github.com";
      }
      break;
    case "gitlab":
      apiBase = `${scheme}://${host}/api/v4`;
      break;
    case "gitee":
      if (url.hostname !== "gitee.com") apiBase = `${scheme}://${host}/api/v5`;
      else apiBase = "https://gitee.com/api/v5";
      break;
    default:
      throw new DomainError(ErrCode.VALIDATION_FAILED, "不支持的平台");
  }
  return { platform, url: raw, host, scheme, owner, repo, apiBase };
}

function authHeaders(platform: FileRepoPlatform, token: string | null): Record<string, string> {
  if (!token) return {};
  if (platform === "gitlab") return { authorization: `Bearer ${token}` };
  // gitea/github：Basic user:token（github user 惯例任意非空）
  return { authorization: `Basic ${Buffer.from(`token:${token}`).toString("base64")}` };
}

function withGiteeToken(url: string, platform: FileRepoPlatform, token: string | null): string {
  if (platform !== "gitee" || !token) return url;
  return `${url}${url.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(token)}`;
}

async function fetchJson<T>(
  fetchFn: FetchLike,
  url: string,
  headers: Record<string, string>,
): Promise<T> {
  // cache no-store：Route Handler 内 GET fetch 会被 Next 数据缓存层拦截（对重启过的目标端口产生粘滞失败——S5 FILE-001 e2e 定位）
  const res = await fetchFn(url, { headers, cache: "no-store" }).catch((err: unknown) => {
    const cause = (err as { cause?: { code?: string; message?: string } })?.cause;
    throw new GitAdapterError(
      `fetch failed:${cause?.code ?? ""}:${cause?.message ?? (err as Error)?.message ?? ""}`,
      0,
    );
  });
  if (!res.ok) {
    throw new GitAdapterError(`平台响应 ${res.status}`, res.status);
  }
  return (await res.json()) as T;
}

async function fetchText(
  fetchFn: FetchLike,
  url: string,
  headers: Record<string, string>,
): Promise<string> {
  const res = await fetchFn(url, { headers, cache: "no-store" });
  if (!res.ok) throw new GitAdapterError(`平台响应 ${res.status}`, res.status);
  return res.text();
}

/** 连接测试：repo 元信息探活（2xx=成功；401/403=凭据失效）。 */
export async function listRepoMeta(
  ref: RepoRef,
  token: string | null,
  fetchFn: FetchLike,
): Promise<{ ok: boolean; message: string }> {
  const headers = { accept: "application/json", ...authHeaders(ref.platform, token) };
  try {
    let url: string;
    if (ref.platform === "gitlab") {
      url = `${ref.apiBase}/projects/${encodeURIComponent(`${ref.owner}/${ref.repo}`)}`;
    } else {
      url = `${ref.apiBase}/repos/${ref.owner}/${ref.repo}`;
    }
    await fetchJson<unknown>(fetchFn, withGiteeToken(url, ref.platform, token), headers);
    return { ok: true, message: "连接成功" };
  } catch (err) {
    if (err instanceof GitAdapterError && (err.status === 401 || err.status === 403)) {
      return { ok: false, message: "凭据失效或无权限（401/403）" };
    }
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

/** contents 族条目（gitea/github/gitee 共形）。 */
interface ContentsEntry {
  name?: string;
  path?: string;
  type?: string;
  size?: number;
  content?: string | null;
  encoding?: string;
  download_url?: string | null;
}

const MAX_FILES = 50;
const MAX_DEPTH = 3;

async function fetchContentsFile(
  fetchFn: FetchLike,
  url: string,
  headers: Record<string, string>,
): Promise<{ content: Buffer; size: number }> {
  const entry = await fetchJson<ContentsEntry>(fetchFn, url, headers);
  if (typeof entry.content === "string" && entry.encoding === "base64") {
    return { content: Buffer.from(entry.content, "base64"), size: entry.size ?? 0 };
  }
  if (entry.download_url) {
    const text = await fetchText(fetchFn, entry.download_url, headers);
    const buf = Buffer.from(text, "utf8");
    return { content: buf, size: entry.size ?? buf.byteLength };
  }
  throw new GitAdapterError("文件内容不可得（>1MB 或权限不足）", 422);
}

async function fetchContentsDir(
  fetchFn: FetchLike,
  ref: RepoRef,
  token: string | null,
  branch: string,
  dirPath: string,
  depth: number,
  budget: { count: number },
): Promise<GitRemoteFile[]> {
  if (depth > MAX_DEPTH) return [];
  const headers = { accept: "application/json", ...authHeaders(ref.platform, token) };
  const url = `${ref.apiBase}/repos/${ref.owner}/${ref.repo}/contents/${dirPath}?ref=${encodeURIComponent(branch)}`;
  const entries = await fetchJson<ContentsEntry[]>(
    fetchFn,
    withGiteeToken(url, ref.platform, token),
    headers,
  );
  const out: GitRemoteFile[] = [];
  for (const e of entries) {
    if (budget.count >= MAX_FILES) break;
    if (e.type === "file" && e.path) {
      if (typeof e.content === "string" && e.encoding === "base64") {
        out.push({ path: e.path, content: Buffer.from(e.content, "base64"), size: e.size ?? 0 });
        budget.count += 1;
      } else {
        const fileUrl = `${ref.apiBase}/repos/${ref.owner}/${ref.repo}/contents/${e.path}?ref=${encodeURIComponent(branch)}`;
        const { content, size } = await fetchContentsFile(
          fetchFn,
          withGiteeToken(fileUrl, ref.platform, token),
          headers,
        );
        out.push({ path: e.path, content, size });
        budget.count += 1;
      }
    } else if (e.type === "dir" && e.path) {
      out.push(...(await fetchContentsDir(fetchFn, ref, token, branch, e.path, depth + 1, budget)));
    }
  }
  return out;
}

async function fetchGitlab(
  fetchFn: FetchLike,
  ref: RepoRef,
  token: string | null,
  branch: string,
  target: string,
  depth: number,
  budget: { count: number },
): Promise<GitRemoteFile[]> {
  const headers = { accept: "application/json", ...authHeaders(ref.platform, token) };
  const pid = encodeURIComponent(`${ref.owner}/${ref.repo}`);
  const out: GitRemoteFile[] = [];
  const walk = async (dirPath: string, d: number): Promise<void> => {
    if (d > MAX_DEPTH || budget.count >= MAX_FILES) return;
    const treeUrl = `${ref.apiBase}/projects/${pid}/repository/tree?ref=${encodeURIComponent(branch)}&path=${encodeURIComponent(dirPath)}&per_page=100`;
    const entries = await fetchJson<{ type: string; path: string }[]>(fetchFn, treeUrl, headers);
    for (const e of entries) {
      if (budget.count >= MAX_FILES) break;
      if (e.type === "blob") {
        const rawUrl = `${ref.apiBase}/projects/${pid}/repository/files/${encodeURIComponent(e.path)}/raw?ref=${encodeURIComponent(branch)}`;
        const text = await fetchText(fetchFn, rawUrl, headers);
        const buf = Buffer.from(text, "utf8");
        out.push({ path: e.path, content: buf, size: buf.byteLength });
        budget.count += 1;
      } else if (e.type === "tree") {
        await walk(e.path, d + 1);
      }
    }
  };
  // 先按文件试（404 则按目录展开）
  try {
    const rawUrl = `${ref.apiBase}/projects/${pid}/repository/files/${encodeURIComponent(target)}/raw?ref=${encodeURIComponent(branch)}`;
    const text = await fetchText(fetchFn, rawUrl, headers);
    const buf = Buffer.from(text, "utf8");
    out.push({ path: target, content: buf, size: buf.byteLength });
    return out;
  } catch {
    await walk(target, depth);
    return out;
  }
}

/** 拉取（path=文件或目录；目录递归深度≤3、文件数≤50）。 */
export async function fetchPath(
  ref: RepoRef,
  token: string | null,
  branch: string,
  targetPath: string,
  fetchFn: FetchLike,
): Promise<GitRemoteFile[]> {
  const clean = targetPath.replace(/^\/+|\/+$/g, "");
  if (!clean) throw new DomainError(ErrCode.VALIDATION_FAILED, "路径不能为空");
  const budget = { count: 0 };
  try {
    if (ref.platform === "gitlab") {
      return await fetchGitlab(fetchFn, ref, token, branch, clean, 1, budget);
    }
    const headers = { accept: "application/json", ...authHeaders(ref.platform, token) };
    const fileUrl = `${ref.apiBase}/repos/${ref.owner}/${ref.repo}/contents/${clean}?ref=${encodeURIComponent(branch)}`;
    const res = await fetchFn(withGiteeToken(fileUrl, ref.platform, token), {
      headers,
      cache: "no-store",
    });
    if (res.status === 404) {
      throw new GitAdapterError("路径或分支不存在（404）", 404);
    }
    if (!res.ok) throw new GitAdapterError(`平台响应 ${res.status}`, res.status);
    const body = (await res.json()) as ContentsEntry | ContentsEntry[];
    if (Array.isArray(body)) {
      // 目录：条目自带 base64 直取（gitea/github 目录列表内联 content）；缺失再按文件拉
      const out: GitRemoteFile[] = [];
      for (const e of body) {
        if (budget.count >= MAX_FILES) break;
        if (e.type === "file" && e.path) {
          if (typeof e.content === "string" && e.encoding === "base64") {
            out.push({
              path: e.path,
              content: Buffer.from(e.content, "base64"),
              size: e.size ?? 0,
            });
            budget.count += 1;
          } else {
            const u = `${ref.apiBase}/repos/${ref.owner}/${ref.repo}/contents/${e.path}?ref=${encodeURIComponent(branch)}`;
            const { content, size } = await fetchContentsFile(
              fetchFn,
              withGiteeToken(u, ref.platform, token),
              headers,
            );
            out.push({ path: e.path, content, size });
            budget.count += 1;
          }
        }
      }
      // 深层目录：子目录整体再查（递归深度≤3）
      for (const e of body) {
        if (e.type === "dir" && e.path) {
          out.push(...(await fetchContentsDir(fetchFn, ref, token, branch, e.path, 2, budget)));
        }
      }
      return out;
    }
    // 单文件
    if (body.type && body.type !== "file") {
      throw new DomainError(
        ErrCode.VALIDATION_FAILED,
        "路径不是文件（目录请以 / 结尾或直接传目录路径）",
      );
    }
    if (typeof body.content === "string" && body.encoding === "base64") {
      return [{ path: clean, content: Buffer.from(body.content, "base64"), size: body.size ?? 0 }];
    }
    if (body.download_url) {
      const text = await fetchText(fetchFn, body.download_url, headers);
      const buf = Buffer.from(text, "utf8");
      return [{ path: clean, content: buf, size: body.size ?? buf.byteLength }];
    }
    throw new GitAdapterError("文件内容不可得（>1MB 或权限不足）", 422);
  } catch (err) {
    if (err instanceof DomainError) throw err;
    throw new GitAdapterError(err instanceof Error ? err.message : String(err), 500);
  }
}

// ───────────────────────── SCM-001 项目代码仓库（新增函数，FILE-001 既有函数零改动） ─────────────────────────

export type ScmPlatform = FileRepoPlatform | "custom";

/** SCM 绑定解析结果：custom 平台 apiBase=null（仅保存不验证）。 */
export interface ScmRepoRef {
  platform: ScmPlatform;
  url: string;
  scheme: string;
  host: string;
  owner: string;
  repo: string;
  apiBase: string | null;
}

function scmApiBase(platform: ScmPlatform, scheme: string, host: string): string | null {
  switch (platform) {
    case "gitea":
      return `${scheme}://${host}/api/v1`;
    case "github":
      if (host === "github.com" || host === "www.github.com") return "https://api.github.com";
      return `${scheme}://${host}/api/v3`; // GitHub Enterprise（FILE-001 同款简化：标准路径形态）
    case "gitlab":
      return `${scheme}://${host}/api/v4`;
    case "gitee":
      if (host === "gitee.com") return "https://gitee.com/api/v5";
      return `${scheme}://${host}/api/v5`;
    default:
      return null; // custom：API 形态未知，仅保存
  }
}

/**
 * 解析 SCM 仓库地址（https / scp 形态 ssh / ssh:// 三形态），归一 owner/repo 与 apiBase。
 * ssh 地址仅做解析绝不出站（SCM-001 §2）；平台由调用方（UI 自动识别/用户选择）给定。
 */
export function parseScmRepoUrl(platform: ScmPlatform, raw: string): ScmRepoRef {
  const trimmed = raw.trim();
  let scheme = "https";
  let host = "";
  let path = "";
  const scp = trimmed.match(/^git@([\w.\-]+):(.+)$/);
  const sshForm = trimmed.match(/^ssh:\/\/git@([\w.\-]+)(?::(\d+))?\/(.+)$/);
  if (scp) {
    host = scp[1] ?? "";
    path = scp[2] ?? "";
  } else if (sshForm) {
    host = sshForm[1] ?? "";
    path = sshForm[3] ?? "";
  } else {
    let u: URL;
    try {
      u = new URL(trimmed);
    } catch {
      throw new DomainError(
        ErrCode.VALIDATION_FAILED,
        "仓库地址非法（https://host/owner/repo 或 git@host:owner/repo.git）",
      );
    }
    if (u.protocol !== "https:" && u.protocol !== "http:") {
      throw new DomainError(
        ErrCode.VALIDATION_FAILED,
        "仓库地址仅允许 http(s) 或 git@/ssh:// 形态",
      );
    }
    scheme = u.protocol.replace(":", "");
    host = u.host;
    path = u.pathname;
  }
  const segs = path
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .filter(Boolean);
  if (segs.length > 2 && !sshForm && !scp) {
    // https 形态允许子路径部署（如 GHE 前缀），取末两段
    segs.splice(0, segs.length - 2);
  }
  const owner = segs[0] ?? "";
  const repo = (segs[1] ?? "").replace(/\.git$/, "");
  if (!owner || !repo) {
    throw new DomainError(ErrCode.VALIDATION_FAILED, "仓库地址需含 owner/repo 路径");
  }
  return {
    platform,
    url: trimmed,
    scheme,
    host,
    owner,
    repo,
    apiBase: scmApiBase(platform, scheme, host),
  };
}

/** SCM 验证用凭据：OAuth/Token → token；账密 → username+password。 */
export interface ScmAuth {
  token?: string | null;
  username?: string | null;
  password?: string | null;
}

function scmAuthHeaders(platform: ScmPlatform, auth: ScmAuth | null): Record<string, string> {
  if (!auth) return {};
  if (auth.token) {
    if (platform === "gitlab") return { authorization: `Bearer ${auth.token}` };
    return { authorization: `Basic ${Buffer.from(`token:${auth.token}`).toString("base64")}` };
  }
  if (auth.username && auth.password) {
    // gitea/gitee API Basic 账密（github/gitlab 不支持，服务层按能力矩阵拦截）
    return {
      authorization: `Basic ${Buffer.from(`${auth.username}:${auth.password}`).toString("base64")}`,
    };
  }
  return {};
}

function scmWithGiteeToken(url: string, platform: ScmPlatform, auth: ScmAuth | null): string {
  if (platform !== "gitee" || !auth?.token) return url;
  return `${url}${url.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(auth.token)}`;
}

export interface ScmLatestCommit {
  sha: string;
  message: string;
  committedAt: string | null;
}

export interface ScmRepoDetail {
  defaultBranch: string | null;
  visibility: "public" | "private" | "internal" | null;
  latestCommit: ScmLatestCommit | null;
}

/**
 * 仓库元信息（verify 消费）：repo 详情 + 最近一次提交。
 * 失败形态沿用 GitAdapterError（401/403=凭据失效，由服务层映射 INVALID_CRED）。
 */
export async function getScmRepoDetail(
  ref: ScmRepoRef,
  auth: ScmAuth | null,
  fetchFn: FetchLike,
): Promise<ScmRepoDetail> {
  if (!ref.apiBase) throw new GitAdapterError("custom 平台无 API 形态，不支持验证", 422);
  const headers = { accept: "application/json", ...scmAuthHeaders(ref.platform, auth) };
  if (ref.platform === "gitlab") {
    const pid = encodeURIComponent(`${ref.owner}/${ref.repo}`);
    const repoJson = await fetchJson<Record<string, unknown>>(
      fetchFn,
      `${ref.apiBase}/projects/${pid}`,
      headers,
    );
    const commits = await fetchJson<{ id?: string; message?: string; committed_date?: string }[]>(
      fetchFn,
      `${ref.apiBase}/projects/${pid}/repository/commits?per_page=1`,
      headers,
    );
    const c = commits[0];
    return {
      defaultBranch: typeof repoJson.default_branch === "string" ? repoJson.default_branch : null,
      visibility:
        repoJson.visibility === "private" ||
        repoJson.visibility === "internal" ||
        repoJson.visibility === "public"
          ? (repoJson.visibility as "public" | "private" | "internal")
          : null,
      latestCommit: c?.id
        ? {
            sha: c.id,
            message: (c.message ?? "").split("\n")[0] ?? "",
            committedAt: c.committed_date ?? null,
          }
        : null,
    };
  }
  // github / gitea / gitee contents 族同形
  const repoUrl = `${ref.apiBase}/repos/${ref.owner}/${ref.repo}`;
  const repoJson = await fetchJson<Record<string, unknown>>(
    fetchFn,
    scmWithGiteeToken(repoUrl, ref.platform, auth),
    headers,
  );
  const commitUrl =
    ref.platform === "gitea" ? `${repoUrl}/commits?limit=1` : `${repoUrl}/commits?per_page=1`;
  const commits = await fetchJson<
    { sha?: string; commit?: { message?: string; author?: { date?: string } } }[]
  >(fetchFn, scmWithGiteeToken(commitUrl, ref.platform, auth), headers);
  const c = commits[0];
  return {
    defaultBranch:
      typeof repoJson.default_branch === "string"
        ? repoJson.default_branch
        : typeof repoJson.defaultBranch === "string"
          ? repoJson.defaultBranch
          : null,
    visibility: repoJson.private === true ? "private" : "public",
    latestCommit: c?.sha
      ? {
          sha: c.sha,
          message: (c.commit?.message ?? "").split("\n")[0] ?? "",
          committedAt: c.commit?.author?.date ?? null,
        }
      : null,
  };
}

/**
 * SCM-001 项目代码仓库绑定：CRUD（上限 10/项目、默认互斥、软删）/ 连通性验证 + 元信息刷新。
 * 凭据 AES-256-GCM（命名空间 scm-repo:{provider}）落库永不回显；ssh 地址仅解析不出站。
 */
import {
  DomainError,
  ErrCode,
  SCM_PROVIDER_META,
  SCM_REPO_LIMIT,
  type ScmOauthProvider,
  type ScmRepoCreateInput,
  type ScmRepoUpdateInput,
  type ScmRepoVerifyResult,
} from "@rabbit/shared";
import { prisma } from "@rabbit/db";
import {
  decryptCredential,
  encryptCredential,
  integrationSecretConfigured,
} from "@/server/domains/api/credential-crypto";
import { assertSafeOutboundUrl } from "@/server/domains/api/outbound-guard";
import {
  getScmRepoDetail,
  parseScmRepoUrl,
  GitAdapterError,
  type ScmAuth,
  type ScmPlatform,
  type ScmRepoRef,
} from "@/server/domains/project/git-adapters";
import { accountToken, scmOutboundFetch } from "./scm-oauth.service";

type ScmRepoRow = Awaited<ReturnType<typeof prisma.scmRepository.findFirst>>;

async function getRepo(projectId: string, repoId: string): Promise<NonNullable<ScmRepoRow>> {
  const row = await prisma.scmRepository.findFirst({
    where: { id: repoId, projectId, deletedAt: null },
  });
  if (!row) throw new DomainError(ErrCode.SCM_REPO_NOT_FOUND, "代码仓库绑定不存在或已删除");
  return row;
}

function serialize(r: NonNullable<ScmRepoRow>, accountLogin: string | null) {
  return {
    id: r.id,
    name: r.name,
    provider: r.provider as ScmPlatform,
    repoUrl: r.repoUrl,
    sshUrl: r.sshUrl,
    host: r.host,
    owner: r.owner,
    repo: r.repo,
    authType: r.authType as "none" | "oauth" | "token" | "password",
    accountId: r.accountId,
    accountLogin,
    username: r.username,
    hasSecret: Boolean(r.secretEnc),
    defaultBranch: r.defaultBranch,
    visibility: r.visibility,
    isDefault: r.isDefault,
    verifyStatus: r.verifyStatus as "UNVERIFIED" | "OK" | "INVALID_CRED" | "FAILED",
    verifyMessage: r.verifyMessage,
    lastVerifiedAt: r.lastVerifiedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}

export async function listScmRepos(projectId: string) {
  const rows = await prisma.scmRepository.findMany({
    where: { projectId, deletedAt: null },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    include: { account: { select: { login: true } } },
  });
  return { total: rows.length, items: rows.map((r) => serialize(r, r.account?.login ?? null)) };
}

function repoSecretNamespace(provider: string): string {
  return `scm-repo:${provider}`;
}

function ensureSecretEnv() {
  if (!integrationSecretConfigured()) {
    throw new DomainError(
      ErrCode.INTEGRATION_SECRET_MISSING,
      "集成加密密钥未配置（RABBIT_INTEGRATION_SECRET）",
    );
  }
}

/** SSRF 解析期守卫（连接期由 scmOutboundFetch 的 dispatcher 兜底）。 */
async function guardOutbound(ref: ScmRepoRef) {
  if (!ref.apiBase) return;
  try {
    await assertSafeOutboundUrl(ref.apiBase);
  } catch (err) {
    if (err instanceof DomainError && err.code === ErrCode.SWAGGER_SYNC_URL_BLOCKED) {
      throw new DomainError(
        ErrCode.SCM_REPO_URL_BLOCKED,
        "仓库地址不允许（内网/元数据地址被守卫拦截）",
      );
    }
    throw err;
  }
}

/** OAuth 来源 → 平台官方域 https 地址（自建 GitLab 取账号 baseUrl 的 host）。 */
function oauthRepoUrl(
  provider: ScmOauthProvider,
  baseUrl: string | null,
  owner: string,
  repo: string,
): string {
  if (provider === "github") return `https://github.com/${owner}/${repo}.git`;
  if (provider === "gitee") return `https://gitee.com/${owner}/${repo}.git`;
  const host = baseUrl?.replace(/^https?:\/\//, "").replace(/\/$/, "") || "gitlab.com";
  return `https://${host}/${owner}/${repo}.git`;
}

export async function createScmRepo(
  orgId: string,
  projectId: string,
  userId: string,
  input: ScmRepoCreateInput,
) {
  const count = await prisma.scmRepository.count({ where: { projectId, deletedAt: null } });
  if (count >= SCM_REPO_LIMIT) {
    throw new DomainError(
      ErrCode.SCM_REPO_LIMIT_EXCEEDED,
      `代码仓库数量超出上限（${SCM_REPO_LIMIT}/项目）`,
    );
  }

  let provider: ScmPlatform;
  let repoUrl: string;
  let authType: "none" | "oauth" | "token" | "password";
  let accountId: string | null = null;
  let username: string | null = null;
  let secretEnc: string | null = null;

  if (input.source === "oauth") {
    const account = await prisma.scmAccount.findFirst({
      where: { id: input.accountId, orgId, deletedAt: null, status: "ACTIVE" },
    });
    if (!account) {
      throw new DomainError(ErrCode.SCM_ACCOUNT_NOT_FOUND, "授权账号不存在、已撤销或已过期");
    }
    provider = account.provider as ScmOauthProvider;
    repoUrl = oauthRepoUrl(provider, account.baseUrl, input.owner, input.repo);
    authType = "oauth";
    accountId = account.id;
  } else {
    provider = input.provider;
    repoUrl = input.repoUrl;
    authType = input.authType;
    if (authType === "token" && !input.token) {
      throw new DomainError(ErrCode.VALIDATION_FAILED, "Token 认证需填写访问令牌");
    }
    if (authType === "password" && (!input.username || !input.password)) {
      throw new DomainError(ErrCode.VALIDATION_FAILED, "账密认证需填写用户名与密码");
    }
    if (authType === "token" || authType === "password") ensureSecretEnv();
  }

  const ref = parseScmRepoUrl(provider, repoUrl);
  await guardOutbound(ref);

  const dup = await prisma.scmRepository.findFirst({
    where: { projectId, deletedAt: null, host: ref.host, owner: ref.owner, repo: ref.repo },
    select: { id: true },
  });
  if (dup) {
    throw new DomainError(ErrCode.VALIDATION_FAILED, "该项目已绑定该仓库（同 host/owner/repo）");
  }

  if (input.source === "url" && authType === "token" && input.token) {
    secretEnc = encryptCredential(repoSecretNamespace(provider), input.token);
  }
  if (input.source === "url" && authType === "password") {
    username = input.username ?? null;
    secretEnc = encryptCredential(repoSecretNamespace(provider), input.password ?? "");
  }

  const row = await prisma.scmRepository.create({
    data: {
      projectId,
      name: input.name ?? null,
      provider,
      repoUrl,
      host: ref.host,
      owner: ref.owner,
      repo: ref.repo,
      apiBase: ref.apiBase,
      authType,
      accountId,
      username,
      secretEnc,
      isDefault: count === 0, // 首个绑定自动默认
      createdById: userId,
    },
  });
  const account = accountId
    ? await prisma.scmAccount.findUnique({ where: { id: accountId }, select: { login: true } })
    : null;
  return serialize(row, account?.login ?? null);
}

export async function updateScmRepo(projectId: string, repoId: string, input: ScmRepoUpdateInput) {
  const row = await getRepo(projectId, repoId);

  // 设默认：事务内先清后立（项目内互斥）
  if (input.isDefault === true) {
    await prisma.$transaction([
      prisma.scmRepository.updateMany({ where: { projectId }, data: { isDefault: false } }),
      prisma.scmRepository.update({ where: { id: row.id }, data: { isDefault: true } }),
    ]);
  }

  const data: Record<string, unknown> = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.authType !== undefined) {
    // 整体换认证：按新类型全量校验并替换
    const nextType = input.authType;
    if (nextType === "oauth") {
      if (!input.accountId) {
        throw new DomainError(ErrCode.VALIDATION_FAILED, "OAuth 认证需选择授权账号");
      }
      data.accountId = input.accountId;
      data.username = null;
      data.secretEnc = null;
    } else if (nextType === "token") {
      if (!input.token)
        throw new DomainError(ErrCode.VALIDATION_FAILED, "Token 认证需填写访问令牌");
      ensureSecretEnv();
      data.accountId = null;
      data.username = null;
      data.secretEnc = encryptCredential(repoSecretNamespace(row.provider), input.token);
    } else if (nextType === "password") {
      if (!input.username || !input.password) {
        throw new DomainError(ErrCode.VALIDATION_FAILED, "账密认证需填写用户名与密码");
      }
      ensureSecretEnv();
      data.accountId = null;
      data.username = input.username;
      data.secretEnc = encryptCredential(repoSecretNamespace(row.provider), input.password);
    } else {
      data.accountId = null;
      data.username = null;
      data.secretEnc = null;
    }
    data.authType = nextType;
    data.verifyStatus = "UNVERIFIED"; // 换认证后回未验证
    data.verifyMessage = null;
  } else {
    // 同型换凭据（留空=不更新）：token/password/accountId 单独替换
    if (row.authType === "token" && input.token) {
      ensureSecretEnv();
      data.secretEnc = encryptCredential(repoSecretNamespace(row.provider), input.token);
    }
    if (row.authType === "password" && input.username && input.password) {
      ensureSecretEnv();
      data.username = input.username;
      data.secretEnc = encryptCredential(repoSecretNamespace(row.provider), input.password);
    }
    if (row.authType === "oauth" && input.accountId) {
      data.accountId = input.accountId;
    }
    if (data.secretEnc !== undefined || data.accountId !== undefined) {
      data.verifyStatus = "UNVERIFIED"; // 换凭据后回未验证
      data.verifyMessage = null;
    }
  }
  const updated = await prisma.scmRepository.update({
    where: { id: row.id },
    data,
    include: { account: { select: { login: true } } },
  });
  return serialize(updated, updated.account?.login ?? null);
}

/** 软删；默认仓库被删后剩余最早一条自动补位。 */
export async function deleteScmRepo(projectId: string, repoId: string) {
  const row = await getRepo(projectId, repoId);
  await prisma.scmRepository.update({ where: { id: row.id }, data: { deletedAt: new Date() } });
  if (row.isDefault) {
    const next = await prisma.scmRepository.findFirst({
      where: { projectId, deletedAt: null },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    if (next) {
      await prisma.scmRepository.update({ where: { id: next.id }, data: { isDefault: true } });
    }
  }
  return { id: row.id };
}

/** verify 前的凭据装配（OAuth→账号 token（含 gitlab 旋转）；token/password→解密）。 */
async function buildAuth(orgId: string, row: NonNullable<ScmRepoRow>): Promise<ScmAuth | null> {
  if (row.authType === "none") return null;
  if (row.authType === "oauth") {
    if (!row.accountId) return null;
    const account = await prisma.scmAccount.findFirst({
      where: { id: row.accountId, orgId, deletedAt: null },
    });
    if (!account || account.status !== "ACTIVE") {
      throw new DomainError(ErrCode.SCM_ACCOUNT_NOT_FOUND, "授权账号已撤销或过期，请重新授权");
    }
    const token = await accountToken(account.orgId, account.id);
    return { token };
  }
  if (!row.secretEnc) return null;
  const secret = decryptCredential(repoSecretNamespace(row.provider), row.secretEnc);
  if (row.authType === "token") return { token: secret };
  return { username: row.username, password: secret };
}

/** 连通性验证 + 元信息刷新（状态机：OK / INVALID_CRED / FAILED 持久化并回显）。 */
export async function verifyScmRepo(
  orgId: string,
  projectId: string,
  repoId: string,
): Promise<ScmRepoVerifyResult> {
  const row = await getRepo(projectId, repoId);
  const provider = row.provider as ScmPlatform;

  const persist = async (
    status: ScmRepoVerifyResult["status"],
    message: string,
    detail?: {
      defaultBranch?: string | null;
      visibility?: string | null;
    },
  ) => {
    await prisma.scmRepository.update({
      where: { id: row.id },
      data: {
        verifyStatus: status,
        verifyMessage: message.slice(0, 512),
        lastVerifiedAt: new Date(),
        ...(detail?.defaultBranch !== undefined ? { defaultBranch: detail.defaultBranch } : {}),
        ...(detail?.visibility !== undefined ? { visibility: detail.visibility } : {}),
      },
    });
  };

  if (provider === "custom" || !row.apiBase) {
    const msg = "自建/其他平台仅保存地址，不支持平台验证";
    await persist("FAILED", msg);
    throw new DomainError(ErrCode.SCM_VERIFY_FAILED, msg);
  }

  // 账密平台能力矩阵：github/gitlab API 不支持 Basic（可保存，验证给明确指引）
  if (row.authType === "password" && provider !== "gitea" && provider !== "gitee") {
    const msg = `${provider === "github" ? "GitHub" : "GitLab"} API 不支持账号密码验证，建议改用 Token`;
    await persist("FAILED", msg);
    throw new DomainError(ErrCode.SCM_VERIFY_FAILED, msg);
  }

  const ref: ScmRepoRef = {
    platform: provider,
    url: row.repoUrl,
    scheme: "https",
    host: row.host,
    owner: row.owner,
    repo: row.repo,
    apiBase: row.apiBase,
  };
  await guardOutbound(ref);

  let auth: ScmAuth | null;
  try {
    auth = await buildAuth(orgId, row);
  } catch (err) {
    const msg = err instanceof DomainError ? err.message : "凭据装配失败";
    await persist("INVALID_CRED", msg);
    if (err instanceof DomainError && err.code === ErrCode.SCM_ACCOUNT_NOT_FOUND) throw err;
    throw new DomainError(ErrCode.SCM_VERIFY_FAILED, msg);
  }

  try {
    const detail = await getScmRepoDetail(ref, auth, (url, init) => scmOutboundFetch(url, init));
    await persist("OK", "连接成功", {
      defaultBranch: detail.defaultBranch,
      visibility: detail.visibility,
    });
    return {
      status: "OK",
      message: "连接成功",
      defaultBranch: detail.defaultBranch,
      visibility: detail.visibility,
      latestCommit: detail.latestCommit,
    };
  } catch (err) {
    if (err instanceof GitAdapterError && (err.status === 401 || err.status === 403)) {
      const msg = "凭据失效或无权限（401/403）";
      await persist("INVALID_CRED", msg);
      throw new DomainError(ErrCode.SCM_VERIFY_FAILED, msg);
    }
    const msg = err instanceof Error ? err.message : String(err);
    await persist("FAILED", msg);
    throw new DomainError(ErrCode.SCM_VERIFY_FAILED, msg.slice(0, 400));
  }
}

/** FILE-001 Git 存储库：CRUD（token AES-256-GCM）/连接测试/按分支+路径拉取/单文件重拉。 */
import { DomainError, ErrCode } from "@rabbit/shared";
import { FILE_REPO_LIMIT, type FileRepoUpsertInput } from "@rabbit/shared";
import { prisma } from "@rabbit/db";
import { ensureFileModule } from "@rabbit/db";
import { putFileObject } from "@/server/storage";
import {
  encryptCredential,
  decryptCredential,
  integrationSecretConfigured,
} from "@/server/domains/api/credential-crypto";
import { assertSafeOutboundUrl } from "@/server/domains/api/outbound-guard";
import { fileMaxSizeMb } from "@/server/domains/system/param.service";
import { parseRepoUrl, listRepoMeta, fetchPath, GitAdapterError } from "./git-adapters";

const defaultFetch: Parameters<typeof listRepoMeta>[2] = (url, init) => fetch(url, init);

function outboundBlocked(err: unknown): boolean {
  return err instanceof DomainError && err.code === ErrCode.SWAGGER_SYNC_URL_BLOCKED;
}

async function getRepo(projectId: string, id: string) {
  const r = await prisma.fileRepo.findFirst({ where: { id, projectId } });
  if (!r) throw new DomainError(ErrCode.FILE_REPO_NOT_FOUND, "文件存储库不存在");
  return r;
}

function serialize(r: {
  id: string;
  platform: string;
  url: string;
  token: string | null;
  createdAt: Date;
}) {
  // token 永不回显（rules/security）：仅 hasToken 布尔
  return {
    id: r.id,
    platform: r.platform,
    url: r.url,
    hasToken: Boolean(r.token),
    createdAt: r.createdAt.toISOString(),
  };
}

export async function listFileRepos(projectId: string) {
  const rows = await prisma.fileRepo.findMany({
    where: { projectId },
    orderBy: { createdAt: "asc" },
  });
  return { total: rows.length, items: rows.map(serialize) };
}

export async function createFileRepo(projectId: string, input: FileRepoUpsertInput) {
  const count = await prisma.fileRepo.count({ where: { projectId } });
  if (count >= FILE_REPO_LIMIT) {
    throw new DomainError(
      ErrCode.VALIDATION_FAILED,
      `存储库数量超出上限（${FILE_REPO_LIMIT}/项目）`,
    );
  }
  const ref = parseRepoUrl(input.platform, input.url);
  try {
    await assertSafeOutboundUrl(ref.apiBase);
  } catch (err) {
    if (outboundBlocked(err)) {
      throw new DomainError(
        ErrCode.FILE_REPO_URL_BLOCKED,
        "仓库地址不允许（内网/元数据地址被守卫拦截）",
      );
    }
    throw err;
  }
  let tokenEnc: string | null = null;
  if (input.token) {
    if (!integrationSecretConfigured()) {
      throw new DomainError(ErrCode.INTEGRATION_SECRET_MISSING, ErrMsgIntegrationSecretMissing());
    }
    tokenEnc = encryptCredential(`git:${input.platform}`, input.token);
  }
  const r = await prisma.fileRepo.create({
    data: { projectId, platform: input.platform, url: input.url, token: tokenEnc },
  });
  return serialize(r);
}

function ErrMsgIntegrationSecretMissing(): string {
  return "集成加密密钥未配置（RABBIT_INTEGRATION_SECRET）";
}

export async function updateFileRepo(projectId: string, id: string, input: FileRepoUpsertInput) {
  await getRepo(projectId, id);
  const ref = parseRepoUrl(input.platform, input.url);
  try {
    await assertSafeOutboundUrl(ref.apiBase);
  } catch (err) {
    if (outboundBlocked(err)) {
      throw new DomainError(
        ErrCode.FILE_REPO_URL_BLOCKED,
        "仓库地址不允许（内网/元数据地址被守卫拦截）",
      );
    }
    throw err;
  }
  let tokenEnc: string | undefined;
  if (input.token) {
    if (!integrationSecretConfigured()) {
      throw new DomainError(ErrCode.INTEGRATION_SECRET_MISSING, ErrMsgIntegrationSecretMissing());
    }
    tokenEnc = encryptCredential(`git:${input.platform}`, input.token);
  }
  const r = await prisma.fileRepo.update({
    where: { id },
    data: {
      platform: input.platform,
      url: input.url,
      ...(tokenEnc !== undefined ? { token: tokenEnc } : {}), // 留空=不更新
    },
  });
  return serialize(r);
}

/** 删除仓库=物理删；其下文件保留（溯源列保留，徽标灰态——FILE-001 §2）。 */
export async function deleteFileRepo(projectId: string, id: string) {
  await getRepo(projectId, id);
  await prisma.fileRepo.update({ where: { id }, data: { files: { set: [] } } });
  await prisma.fileRepo.delete({ where: { id } });
  return { id };
}

/** 连接测试（repo 元信息探活；凭据问题与网络问题分别回显）。 */
export async function testFileRepo(projectId: string, id: string) {
  const r = await getRepo(projectId, id);
  const ref = parseRepoUrl(r.platform as "gitea", r.url);
  try {
    await assertSafeOutboundUrl(ref.apiBase);
  } catch (err) {
    if (outboundBlocked(err)) {
      throw new DomainError(
        ErrCode.FILE_REPO_URL_BLOCKED,
        "仓库地址不允许（内网/元数据地址被守卫拦截）",
      );
    }
    throw err;
  }
  const token = r.token ? decryptCredential(`git:${r.platform}`, r.token) : null;
  const meta = await listRepoMeta(ref, token, defaultFetch);
  if (!meta.ok) throw new DomainError(ErrCode.FILE_REPO_CONNECT_FAILED, meta.message);
  return meta;
}

async function repoToken(r: { platform: string; token: string | null }): Promise<string | null> {
  return r.token ? decryptCredential(`git:${r.platform}`, r.token) : null;
}

/** 按分支+路径拉取 → storage 落盘 → FileItem（repoId/branch/repoPath 溯源）；重复拉取=覆盖更新并恢复。 */
export async function pullFileRepo(
  projectId: string,
  id: string,
  input: { branch: string; path: string },
) {
  const r = await getRepo(projectId, id);
  const ref = parseRepoUrl(r.platform as "gitea", r.url);
  try {
    await assertSafeOutboundUrl(ref.apiBase);
  } catch (err) {
    if (outboundBlocked(err)) {
      throw new DomainError(
        ErrCode.FILE_REPO_URL_BLOCKED,
        "仓库地址不允许（内网/元数据地址被守卫拦截）",
      );
    }
    throw err;
  }
  const token = await repoToken(r);
  let files;
  try {
    files = await fetchPath(ref, token, input.branch, input.path, defaultFetch);
  } catch (err) {
    if (err instanceof GitAdapterError && (err.status === 401 || err.status === 403)) {
      throw new DomainError(ErrCode.FILE_REPO_CONNECT_FAILED, "凭据失效或无权限（401/403）");
    }
    throw new DomainError(
      ErrCode.FILE_REPO_PULL_FAILED,
      err instanceof Error ? err.message : String(err),
    );
  }
  if (files.length === 0) {
    throw new DomainError(ErrCode.FILE_REPO_PULL_FAILED, "路径下没有文件（或路径不存在）");
  }
  const limit = (await fileMaxSizeMb()) * 1024 * 1024;
  const defaultModule = await ensureFileModule(prisma, projectId);
  let pulled = 0;
  let refreshed = 0;
  for (const f of files) {
    if (f.content.byteLength > limit) {
      throw new DomainError(
        ErrCode.FILE_REPO_PULL_FAILED,
        `文件超上限：${f.path}（>${limit / 1024 / 1024}MB）`,
      );
    }
    const name = f.path.split("/").pop() ?? f.path;
    const existing = await prisma.fileItem.findFirst({
      where: { projectId, repoId: r.id, branch: input.branch, repoPath: f.path },
      select: { id: true },
    });
    const storageKey = await putFileObject(f.content);
    if (existing) {
      await prisma.fileItem.update({
        where: { id: existing.id },
        data: { storageKey, size: f.content.byteLength, deletedAt: null, name: name.slice(0, 256) },
      });
      refreshed += 1;
    } else {
      await prisma.fileItem.create({
        data: {
          projectId,
          moduleId: defaultModule,
          name: name.slice(0, 256),
          storageKey,
          size: f.content.byteLength,
          mime: null,
          repoId: r.id,
          branch: input.branch.slice(0, 128),
          repoPath: f.path.slice(0, 512),
        },
      });
      pulled += 1;
    }
  }
  return { pulled, refreshed, skipped: 0 };
}

/** 单文件重新拉取（仓库文件行操作）。 */
export async function syncRepoFile(projectId: string, fileId: string) {
  const f = await prisma.fileItem.findFirst({
    where: { id: fileId, projectId, deletedAt: null, repoId: { not: null } },
  });
  if (!f) throw new DomainError(ErrCode.FILE_NOT_FOUND, "文件不存在或不是仓库文件");
  if (!f.repoId) {
    throw new DomainError(ErrCode.FILE_REPO_NOT_FOUND, "来源仓库已删除或溯源信息缺失");
  }
  const r = await prisma.fileRepo.findFirst({ where: { id: f.repoId } });
  if (!r || !f.branch || !f.repoPath) {
    throw new DomainError(ErrCode.FILE_REPO_NOT_FOUND, "来源仓库已删除或溯源信息缺失");
  }
  const ref = parseRepoUrl(r.platform as "gitea", r.url);
  try {
    await assertSafeOutboundUrl(ref.apiBase);
  } catch (err) {
    if (outboundBlocked(err)) {
      throw new DomainError(
        ErrCode.FILE_REPO_URL_BLOCKED,
        "仓库地址不允许（内网/元数据地址被守卫拦截）",
      );
    }
    throw err;
  }
  const token = await repoToken(r);
  let files;
  try {
    files = await fetchPath(ref, token, f.branch, f.repoPath, defaultFetch);
  } catch (err) {
    throw new DomainError(
      ErrCode.FILE_REPO_PULL_FAILED,
      err instanceof Error ? err.message : String(err),
    );
  }
  const hit = files.find((x) => x.path === f.repoPath) ?? files[0];
  if (!hit) throw new DomainError(ErrCode.FILE_REPO_PULL_FAILED, "远端文件已不存在");
  const storageKey = await putFileObject(hit.content);
  await prisma.fileItem.update({
    where: { id: f.id },
    data: { storageKey, size: hit.content.byteLength },
  });
  return { id: f.id, size: hit.content.byteLength };
}

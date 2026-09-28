/** PROJ-004 文件管理：上传（白名单+大小上限）/列表/更新（重命名/移动/JAR 开关）/软删/下载/internal 读。 */
import { DomainError, ErrCode, FILE_ALLOWED_EXTS } from "@rabbit/shared";
import type { z } from "zod";
import { fileListQuerySchema } from "@rabbit/shared";
import { ensureFileModule, prisma } from "@rabbit/db";
import { putFileObject, readFileObject } from "@/server/storage";
import { moduleSubtreeIds } from "@/server/domains/api/api.service";
import { fileMaxSizeMb } from "@/server/domains/system/param.service";
import path from "node:path";

type ListQuery = z.infer<typeof fileListQuerySchema>;

/** 上限来自 SYS-005 file.maxSizeMb（默认 50，param.service 单一来源）。 */
async function maxUploadBytes(): Promise<number> {
  return (await fileMaxSizeMb()) * 1024 * 1024;
}

export function isAllowedFileName(name: string): boolean {
  const ext = path.extname(name).toLowerCase();
  return (FILE_ALLOWED_EXTS as readonly string[]).includes(ext);
}

function humanSize(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${n} B`;
}
export async function listFiles(projectId: string, query: ListQuery) {
  await ensureFileModule(prisma, projectId); // 懒创建默认模块（幂等）
  const moduleIds = query.moduleId
    ? await moduleSubtreeIds(projectId, "file", query.moduleId, query.includeChildren)
    : undefined;
  const where = {
    projectId,
    deletedAt: query.recycled ? { not: null } : null,
    ...(moduleIds ? { moduleId: { in: moduleIds } } : {}),
    ...(query.keyword ? { name: { contains: query.keyword } } : {}),
  };
  const [total, files] = await Promise.all([
    prisma.fileItem.count({ where }),
    prisma.fileItem.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);
  // S5 FILE-001：仓库文件溯源徽标（repoId → platform；仓库已删=灰态）
  const repoIds = [...new Set(files.map((f) => f.repoId).filter((x): x is string => Boolean(x)))];
  const repos = repoIds.length
    ? await prisma.fileRepo.findMany({
        where: { id: { in: repoIds } },
        select: { id: true, platform: true },
      })
    : [];
  const repoPlatform = new Map(repos.map((r) => [r.id, r.platform]));
  return {
    total,
    items: files.map((f) => ({
      id: f.id,
      moduleId: f.moduleId,
      name: f.name,
      size: f.size,
      sizeText: humanSize(f.size),
      mime: f.mime ?? undefined,
      isJar: f.name.toLowerCase().endsWith(".jar"),
      jarEnabled: f.jarEnabled,
      repoId: f.repoId ?? null,
      repoPlatform: f.repoId ? (repoPlatform.get(f.repoId) ?? null) : null,
      branch: f.branch ?? null,
      repoPath: f.repoPath ?? null,
      deletedAt: f.deletedAt?.toISOString() ?? null,
      createdAt: f.createdAt.toISOString(),
    })),
  };
}

export async function uploadFile(
  projectId: string,
  _userId: string,
  file: { name: string; mime?: string; buffer: Buffer },
) {
  if (!isAllowedFileName(file.name)) {
    throw new DomainError(
      ErrCode.VALIDATION_FAILED,
      `不支持的文件类型（白名单：${FILE_ALLOWED_EXTS.join("/")}）`,
    );
  }
  const limit = await maxUploadBytes();
  if (file.buffer.byteLength > limit) {
    throw new DomainError(ErrCode.VALIDATION_FAILED, `文件超过上限（${humanSize(limit)}）`);
  }
  const defaultModule = await ensureFileModule(prisma, projectId);
  const storageKey = await putFileObject(file.buffer);
  const f = await prisma.fileItem.create({
    data: {
      projectId,
      moduleId: defaultModule,
      name: file.name.slice(0, 256),
      storageKey,
      size: file.buffer.byteLength,
      mime: file.mime ?? null,
      jarEnabled: false, // JAR 启用制：默认禁用（PROJ-004 §1.2）
    },
  });
  return { id: f.id, name: f.name, size: f.size };
}

async function getFile(projectId: string, id: string) {
  const f = await prisma.fileItem.findFirst({ where: { id, projectId, deletedAt: null } });
  if (!f) throw new DomainError(ErrCode.FILE_NOT_FOUND, "文件不存在或已删除");
  return f;
}

export async function updateFile(
  projectId: string,
  id: string,
  input: { name?: string; moduleId?: string; jarEnabled?: boolean },
) {
  const f = await getFile(projectId, id);
  if (input.jarEnabled !== undefined) {
    if (!f.name.toLowerCase().endsWith(".jar"))
      throw new DomainError(ErrCode.VALIDATION_FAILED, "仅 JAR 文件可切换启用状态");
  }
  if (input.moduleId) {
    const m = await prisma.moduleNode.findFirst({
      where: { id: input.moduleId, projectId, scene: "file" },
      select: { id: true },
    });
    if (!m) throw new DomainError(ErrCode.MODULE_NOT_FOUND, "文件模块不存在");
  }
  const updated = await prisma.fileItem.update({
    where: { id: f.id },
    data: {
      ...(input.name ? { name: input.name.slice(0, 256) } : {}),
      ...(input.moduleId ? { moduleId: input.moduleId } : {}),
      ...(input.jarEnabled !== undefined ? { jarEnabled: input.jarEnabled } : {}),
    },
  });
  return {
    id: updated.id,
    jarEnabled: updated.jarEnabled,
    moduleId: updated.moduleId,
    name: updated.name,
  };
}

export async function deleteFile(projectId: string, id: string) {
  const f = await getFile(projectId, id);
  await prisma.fileItem.update({ where: { id: f.id }, data: { deletedAt: new Date() } });
  return { id };
}

/** S5 FILE-001：回收站恢复（PROJ-004 登记兑现）。 */
export async function restoreFile(projectId: string, id: string) {
  const f = await prisma.fileItem.findFirst({ where: { id, projectId, deletedAt: { not: null } } });
  if (!f) throw new DomainError(ErrCode.FILE_NOT_FOUND, "文件不在回收站");
  await prisma.fileItem.update({ where: { id }, data: { deletedAt: null } });
  return { id };
}

/** S5 FILE-001：彻底删除（物理删记录 + best-effort 清理对象存储）。 */
export async function purgeFile(projectId: string, id: string) {
  const f = await prisma.fileItem.findFirst({ where: { id, projectId, deletedAt: { not: null } } });
  if (!f) throw new DomainError(ErrCode.FILE_NOT_FOUND, "文件不在回收站");
  const { deleteObject } = await import("@/server/storage");
  await deleteObject(f.storageKey).catch(() => {}); // best-effort
  await prisma.fileItem.delete({ where: { id } });
  return { id };
}

export async function downloadFile(projectId: string, id: string) {
  const f = await getFile(projectId, id);
  const buffer = await readFileObject(f.storageKey);
  return { name: f.name, mime: f.mime ?? "application/octet-stream", buffer };
}

/** engine 内部读（X-Internal-Token；form-data/binary 请求体消费，API-004 §4）。 */
export async function internalReadFile(id: string) {
  const f = await prisma.fileItem.findFirst({ where: { id, deletedAt: null } });
  if (!f) throw new DomainError(ErrCode.FILE_NOT_FOUND, "文件不存在或已删除");
  const buffer = await readFileObject(f.storageKey);
  return { name: f.name, mime: f.mime ?? "application/octet-stream", buffer };
}

/** SYS-007 个人中心：个人信息/修改密码/本地执行配置/个人默认模型（personal 段无权限点，登录即本人）。 */
import { DomainError, ErrCode } from "@rabbit/shared";
import type { Prisma } from "@rabbit/db";
import { prisma } from "@rabbit/db";
import { hash, verify } from "@node-rs/argon2";

const toJson = (v: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(v ?? {})) as Prisma.InputJsonValue;

export async function getMe(userId: string) {
  const u = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: { email: true, name: true, phone: true, createdAt: true },
  });
  if (!u) throw new DomainError(ErrCode.USER_NOT_FOUND, "用户不存在");
  return { email: u.email, name: u.name, phone: u.phone ?? "", createdAt: u.createdAt.toISOString() };
}

export async function updateMe(userId: string, input: { name: string; phone: string }) {
  const u = await prisma.user.update({
    where: { id: userId },
    data: { name: input.name, phone: input.phone },
    select: { email: true, name: true, phone: true },
  });
  return { email: u.email, name: u.name, phone: u.phone ?? "" };
}

/**
 * 修改密码：旧密码 argon2 校验（错 422 10020）+ 新 ≥8（zod 层）。
 * 会话口径：iron-session 为无状态加密 Cookie，无法服务端吊销其他会话——
 * SYS-007 §8 勘误 1 登记（其余会话随 Cookie 自然过期）。
 */
export async function changePassword(userId: string, oldPassword: string, newPassword: string) {
  const u = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: { passwordHash: true },
  });
  if (!u) throw new DomainError(ErrCode.USER_NOT_FOUND, "用户不存在");
  const ok = await verify(u.passwordHash, oldPassword);
  if (!ok) throw new DomainError(ErrCode.PERSONAL_PASSWORD_MISMATCH, "当前密码错误");
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await hash(newPassword) },
  });
  return { ok: true };
}

// ── 本地执行（UserPreference key=local_runner，projectId="" 全局）──

export interface LocalRunnerPref {
  address: string | null;
  preferLocal: boolean;
}

export async function getLocalRunner(userId: string): Promise<LocalRunnerPref> {
  const pref = await prisma.userPreference.findUnique({
    where: { userId_projectId_key: { userId, projectId: "", key: "local_runner" } },
  });
  const value = (pref?.value as Partial<LocalRunnerPref> | null) ?? {};
  return { address: value.address ?? null, preferLocal: Boolean(value.preferLocal) };
}

/** 环回校验（SYS-007 §2：仅 127.0.0.1/localhost/::1；端口任意）。 */
export function assertLoopbackUrl(address: string): URL {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    throw new DomainError(ErrCode.PERSONAL_LOCAL_RUNNER_INVALID, "地址非法");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new DomainError(ErrCode.PERSONAL_LOCAL_RUNNER_INVALID, "仅允许 http(s) 地址");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1" && host !== "[::1]") {
    throw new DomainError(ErrCode.PERSONAL_LOCAL_RUNNER_INVALID, "本地 runner 地址仅允许环回（127.0.0.1/localhost/::1）");
  }
  return url;
}

export async function putLocalRunner(
  userId: string,
  input: { address?: string | null; preferLocal: boolean },
): Promise<LocalRunnerPref> {
  const address = input.address?.trim() ? input.address.trim() : null;
  if (address) assertLoopbackUrl(address);
  await prisma.userPreference.upsert({
    where: { userId_projectId_key: { userId, projectId: "", key: "local_runner" } },
    update: { value: toJson({ address, preferLocal: input.preferLocal }) },
    create: { userId, projectId: "", key: "local_runner", value: toJson({ address, preferLocal: input.preferLocal }) },
  });
  return { address, preferLocal: input.preferLocal };
}

/** 连通检测（3s 超时；GET address；仅环回——SSRF 面收敛）。 */
export async function checkLocalRunner(userId: string): Promise<{ reachable: boolean; detail: string }> {
  const { address } = await getLocalRunner(userId);
  if (!address) throw new DomainError(ErrCode.VALIDATION_FAILED, "尚未配置地址");
  assertLoopbackUrl(address);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  const startedAt = Date.now();
  try {
    const res = await fetch(address, { signal: controller.signal, cache: "no-store" });
    return { reachable: res.ok, detail: `HTTP ${res.status}（${Date.now() - startedAt}ms）` };
  } catch (err) {
    return { reachable: false, detail: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

// ── 个人默认模型（S7 挂点兑现：UserPreference key=ai_model）──

export async function getPersonalAiModel(userId: string) {
  const pref = await prisma.userPreference.findUnique({
    where: { userId_projectId_key: { userId, projectId: "", key: "ai_model" } },
  });
  const modelId = (pref?.value as { modelId?: string } | null)?.modelId ?? null;
  if (!modelId) return { modelId: null };
  const m = await prisma.aiModel.findFirst({
    where: { id: modelId },
    select: { id: true, name: true, enabled: true },
  });
  return { modelId: m?.enabled ? m.id : null };
}

export async function putPersonalAiModel(userId: string, modelId: string | null) {
  if (modelId) {
    const m = await prisma.aiModel.findFirst({
      where: { id: modelId, enabled: true },
      select: { id: true },
    });
    if (!m) throw new DomainError(ErrCode.PERSONAL_AI_MODEL_INVALID, "模型不存在或未启用");
  }
  await prisma.userPreference.upsert({
    where: { userId_projectId_key: { userId, projectId: "", key: "ai_model" } },
    update: { value: toJson({ modelId }) },
    create: { userId, projectId: "", key: "ai_model", value: toJson({ modelId }) },
  });
  return { modelId };
}

/** 供 ai 域解析：个人默认（启用中）> 系统默认（resolveRuntime 既有链）。 */
export async function personalAiModelId(userId: string): Promise<string | null> {
  const { modelId } = await getPersonalAiModel(userId);
  return modelId;
}

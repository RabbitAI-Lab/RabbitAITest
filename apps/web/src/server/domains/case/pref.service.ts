/** CASE-002 自定义视图（user_preference case_views，上限 10）+ 通用偏好读写。 */
import { DomainError, ErrCode } from "@rabbit/shared";
import { prisma } from "@rabbit/db";
import type { Prisma } from "@rabbit/db";

const toJson = (v: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(v ?? {})) as Prisma.InputJsonValue;

export interface CaseView {
  id: string;
  name: string;
  query: Record<string, unknown>;
  columns?: string[];
  isDefault: boolean;
}

async function loadViews(userId: string, projectId: string): Promise<CaseView[]> {
  const pref = await prisma.userPreference.findFirst({
    where: { userId, projectId, key: "case_views" },
    select: { value: true },
  });
  return ((pref?.value as { views?: CaseView[] } | null)?.views ?? []) as CaseView[];
}

async function saveViews(userId: string, projectId: string, views: CaseView[]) {
  await prisma.userPreference.upsert({
    where: { userId_projectId_key: { userId, projectId, key: "case_views" } },
    update: { value: toJson({ views }) },
    create: { userId, projectId, key: "case_views", value: toJson({ views }) },
  });
}

export async function listViews(userId: string, projectId: string) {
  return { views: await loadViews(userId, projectId) };
}

export async function createView(userId: string, projectId: string, input: Omit<CaseView, "id">) {
  const views = await loadViews(userId, projectId);
  if (views.length >= 10) throw new DomainError(ErrCode.VALIDATION_FAILED, "自定义视图上限 10 个");
  const view: CaseView = {
    id: `v_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    ...input,
  };
  const next = input.isDefault ? views.map((v) => ({ ...v, isDefault: false })) : views;
  await saveViews(userId, projectId, [...next, view]);
  return view;
}

export async function updateView(
  userId: string,
  projectId: string,
  id: string,
  input: Omit<CaseView, "id">,
) {
  const views = await loadViews(userId, projectId);
  const idx = views.findIndex((v) => v.id === id);
  if (idx < 0) throw new DomainError(ErrCode.VALIDATION_FAILED, "视图不存在");
  const next = input.isDefault ? views.map((v) => ({ ...v, isDefault: false })) : views;
  next[idx] = { id, ...input };
  await saveViews(userId, projectId, next);
  return next[idx];
}

export async function deleteView(userId: string, projectId: string, id: string) {
  const views = await loadViews(userId, projectId);
  const next = views.filter((v) => v.id !== id);
  if (next.length === views.length) throw new DomainError(ErrCode.VALIDATION_FAILED, "视图不存在");
  await saveViews(userId, projectId, next);
  return { ok: true };
}

// ── 通用偏好（列配置 / Tab 记忆 / 卡片布局）──

export async function getPreference(userId: string, key: string, projectId: string) {
  const pref = await prisma.userPreference.findFirst({
    where: { userId, projectId, key },
    select: { value: true },
  });
  return { value: pref?.value ?? null };
}

export async function putPreference(
  userId: string,
  key: string,
  projectId: string,
  value: unknown,
) {
  await prisma.userPreference.upsert({
    where: { userId_projectId_key: { userId, projectId, key } },
    update: { value: toJson(value) },
    create: { userId, projectId, key, value: toJson(value) },
  });
  return { value };
}

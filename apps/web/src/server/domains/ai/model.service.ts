/** AI-001 模型管理：系统级 CRUD/默认语义/连接测试/掩码脱敏。 */
import { DomainError, ErrCode } from "@rabbit/shared";
import type { z } from "zod";
import { AI_MODELS_LIMIT, aiModelSaveSchema, maskApiKey } from "@rabbit/shared";
import { prisma } from "@rabbit/db";
import { assertAiBaseUrl } from "./baseurl-guard";
import { callChat, type AiModelRuntime } from "./chat-client";
import { decryptSecret, encryptSecret } from "./crypto";

type SaveInput = z.infer<typeof aiModelSaveSchema>;

function toRow(m: { id: string; name: string; provider: string; baseUrl: string; model: string; apiKeyEnc: string; enabled: boolean; isDefault: boolean; createdAt: Date; updatedAt: Date }) {
  return {
    id: m.id,
    name: m.name,
    provider: m.provider,
    baseUrl: m.baseUrl,
    model: m.model,
    /** 掩码从密文不可逆，展示用尾 4 位存明文摘要不可行——以密文不可解密为前提，展示「已配置」+名称位 */
    apiKeyMasked: "sk-****",
    apiKeyConfigured: true,
    enabled: m.enabled,
    isDefault: m.isDefault,
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
  };
}

export async function listModels() {
  const models = await prisma.aiModel.findMany({ orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }] });
  return { total: models.length, list: models.map(toRow) };
}

export async function createModel(input: SaveInput) {
  await assertAiBaseUrl(input.baseUrl);
  if (!input.apiKey) throw new DomainError(ErrCode.VALIDATION_FAILED, "API Key 必填");
  const count = await prisma.aiModel.count();
  if (count >= AI_MODELS_LIMIT) throw new DomainError(ErrCode.RULES_LIMIT_EXCEEDED, `模型数量上限 ${AI_MODELS_LIMIT} 个`);
  const existingDefault = await prisma.aiModel.count({ where: { isDefault: true } });
  const m = await prisma.aiModel.create({
    data: {
      name: input.name,
      provider: input.provider,
      baseUrl: input.baseUrl,
      model: input.model,
      apiKeyEnc: encryptSecret(input.apiKey),
      enabled: input.enabled,
      isDefault: existingDefault === 0 && input.enabled,
    },
  });
  return { id: m.id };
}

export async function updateModel(id: string, input: SaveInput) {
  await assertAiBaseUrl(input.baseUrl);
  const existing = await prisma.aiModel.findFirst({ where: { id } });
  if (!existing) throw new DomainError(ErrCode.AI_MODEL_NOT_FOUND, "模型不存在");
  await prisma.aiModel.update({
    where: { id },
    data: {
      name: input.name,
      provider: input.provider,
      baseUrl: input.baseUrl,
      model: input.model,
      // 编辑留空=不改（apiKey optional；掩码不回填）
      ...(input.apiKey ? { apiKeyEnc: encryptSecret(input.apiKey) } : {}),
      enabled: input.enabled,
    },
  });
  return { id };
}

export async function deleteModel(id: string) {
  const existing = await prisma.aiModel.findFirst({ where: { id } });
  if (!existing) throw new DomainError(ErrCode.AI_MODEL_NOT_FOUND, "模型不存在");
  await prisma.aiModel.delete({ where: { id } });
  return { id };
}

/** 连接测试：1 条 ping（小额 max_tokens），返回耗时与回声 */
export async function testModel(id: string): Promise<{ ok: true; latencyMs: number; echo: string }> {
  const m = await prisma.aiModel.findFirst({ where: { id } });
  if (!m) throw new DomainError(ErrCode.AI_MODEL_NOT_FOUND, "模型不存在");
  const started = Date.now();
  const echo = await callChat(
    { id: m.id, baseUrl: m.baseUrl, model: m.model, apiKey: decryptSecret(m.apiKeyEnc) },
    [
      { role: "system", content: "You are a connectivity probe. Reply with exactly: pong" },
      { role: "user", content: "ping" },
    ],
    { maxTokens: 8 },
  );
  return { ok: true, latencyMs: Date.now() - started, echo: echo.trim().slice(0, 64) };
}

/** 设默认：事务内清旧置新 */
export async function setDefaultModel(id: string) {
  const m = await prisma.aiModel.findFirst({ where: { id } });
  if (!m) throw new DomainError(ErrCode.AI_MODEL_NOT_FOUND, "模型不存在");
  if (!m.enabled) throw new DomainError(ErrCode.VALIDATION_FAILED, "停用模型不可设为默认");
  await prisma.$transaction([
    prisma.aiModel.updateMany({ where: { isDefault: true }, data: { isDefault: false } }),
    prisma.aiModel.update({ where: { id }, data: { isDefault: true, enabled: true } }),
  ]);
  return { id };
}

/** 解析可用模型：显式 id > 默认 > 首台启用；无可用 → 70444 */
export async function resolveRuntime(modelId?: string | null): Promise<AiModelRuntime & { name: string }> {
  const m = modelId
    ? await prisma.aiModel.findFirst({ where: { id: modelId, enabled: true } })
    : await prisma.aiModel.findFirst({ where: { enabled: true }, orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }] });
  if (!m) {
    throw modelId
      ? new DomainError(ErrCode.AI_MODEL_NOT_FOUND, "模型不存在或未启用")
      : new DomainError(ErrCode.AI_NO_MODEL_AVAILABLE, "尚未配置任何启用的 AI 模型");
  }
  return { id: m.id, name: m.name, baseUrl: m.baseUrl, model: m.model, apiKey: decryptSecret(m.apiKeyEnc) };
}

/** 登录可见的启用模型下拉（无敏感字段） */
export async function listEnabledModelsForPicker() {
  const models = await prisma.aiModel.findMany({
    where: { enabled: true },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    select: { id: true, name: true, provider: true, model: true, isDefault: true },
  });
  return { total: models.length, list: models };
}

export { maskApiKey };

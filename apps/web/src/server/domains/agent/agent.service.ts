/**
 * AGENT-001 项目 Agent CRUD + A2A 密钥：六要素校验（modelId 启用/repoIds ⊆ 项目仓库/
 * toolKeys ⊆ 目录/skillIds ⊆ 项目技能 ≤5/runAs=项目成员）、名称唯一（软删不计）、乐观锁。
 */
import { createHash, randomBytes } from "node:crypto";
import {
  AGENT_KEY_PREFIX,
  AGENT_TEMPLATE_MAP,
  AGENT_TOOL_MAP,
  DomainError,
  ErrCode,
  type AgentCreateInput,
  type AgentSkillView,
  type AgentUpdateInput,
  type AgentView,
} from "@rabbit/shared";
import { Prisma, prisma } from "@rabbit/db";

type AgentRow = NonNullable<Awaited<ReturnType<typeof prisma.projectAgent.findFirst>>>;

async function getAgent(projectId: string, agentId: string): Promise<AgentRow> {
  const row = await prisma.projectAgent.findFirst({
    where: { id: agentId, projectId, deletedAt: null },
  });
  if (!row) throw new DomainError(ErrCode.AGENT_NOT_FOUND, "Agent 不存在或已删除");
  return row;
}

/** 六要素应用层校验（422 AGENT_CONFIG_INVALID / AGENT_MODEL_INVALID） */
async function validateConfig(
  projectId: string,
  input: Partial<AgentCreateInput> & {
    skillIds?: string[];
    repoIds?: string[];
    toolKeys?: string[];
  },
) {
  if (input.modelId !== undefined) {
    const m = await prisma.aiModel.findFirst({ where: { id: input.modelId, enabled: true } });
    if (!m) throw new DomainError(ErrCode.AGENT_MODEL_INVALID, "所选模型不存在或未启用");
  }
  if (input.repoIds?.length) {
    const n = await prisma.scmRepository.count({
      where: { projectId, deletedAt: null, id: { in: input.repoIds } },
    });
    if (n !== input.repoIds.length)
      throw new DomainError(ErrCode.AGENT_CONFIG_INVALID, "代码仓库不在本项目绑定列表内");
  }
  if (input.toolKeys?.some((k) => !AGENT_TOOL_MAP.has(k)))
    throw new DomainError(ErrCode.AGENT_CONFIG_INVALID, "存在未知工具 key");
  if (input.skillIds?.length) {
    const n = await prisma.agentSkill.count({
      where: { projectId, deletedAt: null, id: { in: input.skillIds } },
    });
    if (n !== input.skillIds.length)
      throw new DomainError(ErrCode.AGENT_CONFIG_INVALID, "引用的技能不在本项目技能库");
  }
}

async function assertNameFree(projectId: string, name: string, excludeId?: string) {
  const dup = await prisma.projectAgent.findFirst({
    where: { projectId, name, deletedAt: null, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { id: true },
  });
  if (dup) throw new DomainError(ErrCode.AGENT_NAME_EXISTS, "Agent 名称已存在");
}

async function assertMember(projectId: string, userId: string) {
  const m = await prisma.projectMember.findFirst({
    where: { projectId, userId },
    select: { id: true },
  });
  if (!m) throw new DomainError(ErrCode.AGENT_CONFIG_INVALID, "运行身份必须是项目成员");
}

export async function serializeAgent(r: AgentRow): Promise<AgentView> {
  const [model, runAs] = await Promise.all([
    prisma.aiModel.findUnique({ where: { id: r.modelId }, select: { name: true } }),
    prisma.user.findUnique({ where: { id: r.runAsUserId }, select: { name: true } }),
  ]);
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    role: r.role as AgentView["role"],
    mode: r.mode as AgentView["mode"],
    modelId: r.modelId,
    modelName: model?.name ?? null,
    systemPrompt: r.systemPrompt,
    modelParams: (r.modelParams ?? {}) as AgentView["modelParams"],
    maxIterations: r.maxIterations,
    timeoutMs: r.timeoutMs,
    repoIds: (r.repoIds ?? []) as string[],
    toolKeys: (r.toolKeys ?? []) as string[],
    skillIds: (r.skillIds ?? []) as string[],
    runAsUserId: r.runAsUserId,
    runAsUserName: runAs?.name ?? null,
    a2aEnabled: r.a2aEnabled,
    apiKeyPrefix: r.apiKeyPrefix,
    keyGeneratedAt: r.keyGeneratedAt?.toISOString() ?? null,
    lastCalledAt: r.lastCalledAt?.toISOString() ?? null,
    enabled: r.enabled,
    version: r.version,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export async function listAgents(projectId: string): Promise<AgentView[]> {
  const rows = await prisma.projectAgent.findMany({
    where: { projectId, deletedAt: null },
    orderBy: { createdAt: "asc" },
  });
  return Promise.all(rows.map(serializeAgent));
}

export async function getAgentView(projectId: string, agentId: string): Promise<AgentView> {
  return serializeAgent(await getAgent(projectId, agentId));
}

export async function createAgent(
  projectId: string,
  userId: string,
  input: AgentCreateInput,
): Promise<AgentView> {
  // 模板合并：缺省字段取模板默认（modelId 必须显式或默认模型）
  let merged: AgentCreateInput = { ...input };
  if (input.fromTemplate) {
    const tpl = AGENT_TEMPLATE_MAP.get(input.fromTemplate);
    if (!tpl) throw new DomainError(ErrCode.AGENT_CONFIG_INVALID, "未知模板");
    merged = { ...tpl.defaults, ...input } as AgentCreateInput;
  }
  if (!merged.modelId) {
    const def = await prisma.aiModel.findFirst({
      where: { enabled: true },
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
      select: { id: true },
    });
    if (!def)
      throw new DomainError(
        ErrCode.AGENT_MODEL_INVALID,
        "尚无可用模型，请先在系统设置配置 AI 模型",
      );
    merged.modelId = def.id;
  }
  await validateConfig(projectId, merged);
  await assertNameFree(projectId, merged.name);
  const runAsUserId = merged.runAsUserId ?? userId;
  await assertMember(projectId, runAsUserId);
  const created = await prisma.projectAgent.create({
    data: {
      projectId,
      name: merged.name,
      description: merged.description,
      role: merged.role,
      mode: merged.mode,
      pipelineConfig: merged.pipelineConfig ?? undefined,
      modelId: merged.modelId,
      systemPrompt: merged.systemPrompt,
      modelParams: merged.modelParams,
      maxIterations: merged.maxIterations,
      timeoutMs: merged.timeoutMs,
      repoIds: merged.repoIds,
      toolKeys: merged.toolKeys,
      skillIds: merged.skillIds,
      runAsUserId,
      enabled: merged.enabled,
      createdById: userId,
    },
  });
  return serializeAgent(created);
}

export async function updateAgent(
  projectId: string,
  agentId: string,
  input: AgentUpdateInput,
): Promise<AgentView> {
  const row = await getAgent(projectId, agentId);
  if (input.version !== undefined && input.version !== row.version) {
    throw new DomainError(
      ErrCode.AGENT_CONFIG_INVALID,
      "配置已被他人修改，请刷新后重试（版本冲突）",
    );
  }
  const next = {
    modelId: input.modelId ?? row.modelId,
    repoIds: input.repoIds ?? ((row.repoIds ?? []) as string[]),
    toolKeys: input.toolKeys ?? ((row.toolKeys ?? []) as string[]),
    skillIds: input.skillIds ?? ((row.skillIds ?? []) as string[]),
    runAsUserId: input.runAsUserId ?? row.runAsUserId,
  };
  await validateConfig(projectId, next);
  if (input.name && input.name !== row.name) await assertNameFree(projectId, input.name, agentId);
  await assertMember(projectId, next.runAsUserId);
  const updated = await prisma.projectAgent.update({
    where: { id: agentId },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.role !== undefined ? { role: input.role } : {}),
      ...(input.mode !== undefined ? { mode: input.mode } : {}),
      ...(input.pipelineConfig !== undefined
        ? { pipelineConfig: input.pipelineConfig ?? null }
        : {}),
      ...(input.modelId !== undefined ? { modelId: input.modelId } : {}),
      ...(input.systemPrompt !== undefined ? { systemPrompt: input.systemPrompt } : {}),
      ...(input.modelParams !== undefined ? { modelParams: input.modelParams } : {}),
      ...(input.maxIterations !== undefined ? { maxIterations: input.maxIterations } : {}),
      ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
      ...(input.repoIds !== undefined ? { repoIds: input.repoIds } : {}),
      ...(input.toolKeys !== undefined ? { toolKeys: input.toolKeys } : {}),
      ...(input.skillIds !== undefined ? { skillIds: input.skillIds } : {}),
      ...(input.runAsUserId !== undefined ? { runAsUserId: input.runAsUserId } : {}),
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      version: { increment: 1 },
    } as Prisma.ProjectAgentUncheckedUpdateInput,
  });
  return serializeAgent(updated);
}

export async function deleteAgent(projectId: string, agentId: string): Promise<void> {
  await getAgent(projectId, agentId);
  const running = await prisma.agentRun.findFirst({
    where: { agentId, status: { in: ["PENDING", "RUNNING"] } },
    select: { id: true },
  });
  if (running)
    throw new DomainError(ErrCode.AGENT_RUN_NOT_CANCELLABLE, "Agent 有进行中的运行，无法删除");
  await prisma.projectAgent.update({ where: { id: agentId }, data: { deletedAt: new Date() } });
}

// ── A2A 密钥（§1.2 #9）：rag_ + 32 base62；SHA-256 落库；明文仅生成时一次回显 ──

const B62 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

export function generateAgentKey(): { apiKey: string; prefix: string; hash: string } {
  const bytes = randomBytes(32);
  let s = "";
  for (const b of bytes) s += B62[b % 62];
  const apiKey = `${AGENT_KEY_PREFIX}${s.slice(0, 32)}`;
  return {
    apiKey,
    prefix: apiKey.slice(0, AGENT_KEY_PREFIX.length + 5),
    hash: createHash("sha256").update(apiKey).digest("hex"),
  };
}

export function hashAgentKey(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex");
}

/** 开启/轮换（旧钥即失效）——返回明文（唯一一次） */
export async function rotateAgentKey(projectId: string, agentId: string) {
  await getAgent(projectId, agentId);
  const k = generateAgentKey();
  await prisma.projectAgent.update({
    where: { id: agentId },
    data: {
      a2aEnabled: true,
      apiKeyPrefix: k.prefix,
      apiKeyHash: k.hash,
      keyGeneratedAt: new Date(),
    },
  });
  return { apiKey: k.apiKey, prefix: k.prefix, generatedAt: new Date().toISOString() };
}

/** 吊销（同时关 a2aEnabled） */
export async function revokeAgentKey(projectId: string, agentId: string): Promise<void> {
  await getAgent(projectId, agentId);
  await prisma.projectAgent.update({
    where: { id: agentId },
    data: { a2aEnabled: false, apiKeyPrefix: null, apiKeyHash: null, keyGeneratedAt: null },
  });
}

/** 技能引用计数（列表聚合用） */
export async function skillRefCounts(projectId: string): Promise<Map<string, number>> {
  const rows = await prisma.projectAgent.findMany({
    where: { projectId, deletedAt: null },
    select: { skillIds: true },
  });
  const counts = new Map<string, number>();
  for (const r of rows)
    for (const id of (r.skillIds ?? []) as string[]) counts.set(id, (counts.get(id) ?? 0) + 1);
  return counts;
}

export type { AgentSkillView };

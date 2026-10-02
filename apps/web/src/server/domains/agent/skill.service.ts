/** AGENT-001 技能库：项目级 markdown 指令包 CRUD（名称项目内唯一；被引用删除 → 409）。 */
import {
  DomainError,
  ErrCode,
  type AgentSkillCreateInput,
  type AgentSkillUpdateInput,
  type AgentSkillView,
} from "@rabbit/shared";
import { prisma } from "@rabbit/db";
import { skillRefCounts } from "./agent.service";

type SkillRow = NonNullable<Awaited<ReturnType<typeof prisma.agentSkill.findFirst>>>;

function serialize(r: SkillRow, refCount = 0): AgentSkillView {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    content: r.content,
    enabled: r.enabled,
    refCount,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export async function listSkills(projectId: string): Promise<AgentSkillView[]> {
  const [rows, refs] = await Promise.all([
    prisma.agentSkill.findMany({
      where: { projectId, deletedAt: null },
      orderBy: { createdAt: "asc" },
    }),
    skillRefCounts(projectId),
  ]);
  return rows.map((r) => serialize(r, refs.get(r.id) ?? 0));
}

async function getSkill(projectId: string, skillId: string): Promise<SkillRow> {
  const row = await prisma.agentSkill.findFirst({
    where: { id: skillId, projectId, deletedAt: null },
  });
  if (!row) throw new DomainError(ErrCode.AGENT_SKILL_NOT_FOUND, "技能不存在或已删除");
  return row;
}

export async function createSkill(
  projectId: string,
  userId: string,
  input: AgentSkillCreateInput,
): Promise<AgentSkillView> {
  const dup = await prisma.agentSkill.findFirst({
    where: { projectId, name: input.name, deletedAt: null },
  });
  if (dup) throw new DomainError(ErrCode.AGENT_SKILL_NAME_EXISTS, "技能名称已存在");
  const row = await prisma.agentSkill.create({
    data: { projectId, createdById: userId, ...input },
  });
  return serialize(row);
}

export async function updateSkill(
  projectId: string,
  skillId: string,
  input: AgentSkillUpdateInput,
): Promise<AgentSkillView> {
  const row = await getSkill(projectId, skillId);
  if (input.name && input.name !== row.name) {
    const dup = await prisma.agentSkill.findFirst({
      where: { projectId, name: input.name, deletedAt: null, id: { not: skillId } },
    });
    if (dup) throw new DomainError(ErrCode.AGENT_SKILL_NAME_EXISTS, "技能名称已存在");
  }
  const updated = await prisma.agentSkill.update({ where: { id: skillId }, data: input });
  const refs = await skillRefCounts(projectId);
  return serialize(updated, refs.get(skillId) ?? 0);
}

export async function deleteSkill(projectId: string, skillId: string): Promise<void> {
  await getSkill(projectId, skillId);
  const refs = await skillRefCounts(projectId);
  if ((refs.get(skillId) ?? 0) > 0)
    throw new DomainError(
      ErrCode.AGENT_SKILL_IN_USE,
      "技能已被 Agent 引用，请先在 Agent 编辑中解除引用",
    );
  await prisma.agentSkill.update({ where: { id: skillId }, data: { deletedAt: new Date() } });
}

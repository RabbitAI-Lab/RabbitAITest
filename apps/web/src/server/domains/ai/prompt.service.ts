/** AI-005 提示词模板：项目级 CRUD + 占位符定义域校验 + 默认事务。 */
import { DomainError, ErrCode } from "@rabbit/shared";
import type { z } from "zod";
import { aiPromptSaveSchema, scanPlaceholders } from "@rabbit/shared";
import { prisma } from "@rabbit/db";

type SaveInput = z.infer<typeof aiPromptSaveSchema>;

function validatePlaceholders(input: SaveInput) {
  const unknown = scanPlaceholders(input.template, input.scene);
  if (unknown.length > 0) {
    throw new DomainError(ErrCode.AI_PROMPT_PLACEHOLDER_INVALID, `占位符 {{${unknown[0]}}} 未定义`);
  }
}

export async function listTemplates(projectId: string) {
  const rows = await prisma.aiPromptTemplate.findMany({
    where: { projectId },
    orderBy: [{ scene: "asc" }, { isDefault: "desc" }, { updatedAt: "desc" }],
  });
  return {
    total: rows.length,
    list: rows.map((r) => ({
      id: r.id,
      name: r.name,
      scene: r.scene,
      template: r.template,
      designMethod: r.designMethod,
      isDefault: r.isDefault,
      enabled: r.enabled,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    })),
  };
}

export async function createTemplate(projectId: string, input: SaveInput) {
  validatePlaceholders(input);
  const dup = await prisma.aiPromptTemplate.findFirst({ where: { projectId, name: input.name } });
  if (dup) throw new DomainError(ErrCode.AI_PROMPT_DUP, "模板名称已存在");
  const t = await prisma.$transaction(async (tx) => {
    if (input.isDefault) {
      await tx.aiPromptTemplate.updateMany({ where: { projectId, scene: input.scene }, data: { isDefault: false } });
    }
    return tx.aiPromptTemplate.create({
      data: {
        projectId,
        name: input.name,
        scene: input.scene,
        template: input.template,
        designMethod: input.designMethod,
        isDefault: input.isDefault,
        enabled: input.enabled,
      },
    });
  });
  return { id: t.id };
}

export async function updateTemplate(projectId: string, id: string, input: SaveInput) {
  validatePlaceholders(input);
  const existing = await prisma.aiPromptTemplate.findFirst({ where: { id, projectId } });
  if (!existing) throw new DomainError(ErrCode.AI_PROMPT_NOT_FOUND, "模板不存在");
  const dup = await prisma.aiPromptTemplate.findFirst({ where: { projectId, name: input.name, NOT: { id } } });
  if (dup) throw new DomainError(ErrCode.AI_PROMPT_DUP, "模板名称已存在");
  await prisma.$transaction(async (tx) => {
    if (input.isDefault) {
      await tx.aiPromptTemplate.updateMany({ where: { projectId, scene: input.scene }, data: { isDefault: false } });
    }
    await tx.aiPromptTemplate.update({
      where: { id },
      data: {
        name: input.name,
        template: input.template,
        designMethod: input.designMethod,
        isDefault: input.isDefault,
        enabled: input.enabled,
      },
    });
  });
  return { id };
}

export async function deleteTemplate(projectId: string, id: string) {
  const existing = await prisma.aiPromptTemplate.findFirst({ where: { id, projectId } });
  if (!existing) throw new DomainError(ErrCode.AI_PROMPT_NOT_FOUND, "模板不存在");
  await prisma.aiPromptTemplate.delete({ where: { id } });
  return { id };
}

/** 生成侧取模板：显式 id（启用态）> 该 scene 默认 > null（调用方回退内置） */
export async function resolveTemplate(
  projectId: string,
  scene: "case_gen" | "api_gen",
  templateId?: string,
): Promise<{ template: string; designMethod: string | null } | null> {
  const t = templateId
    ? await prisma.aiPromptTemplate.findFirst({ where: { id: templateId, projectId, enabled: true } })
    : await prisma.aiPromptTemplate.findFirst({ where: { projectId, scene, enabled: true, isDefault: true } });
  if (!t) return null;
  return { template: t.template, designMethod: t.designMethod };
}

/** AGENT-002 草稿服务：行级 CRUD / 冲突检测 / 选择 / 导入（人工确认红线）/ 采纳率。 */
import {
  DomainError,
  ErrCode,
  type AgentAssetType,
  type DraftView,
  type PipelineStage,
} from "@rabbit/shared";
import { prisma } from "@rabbit/db";
import { createCase } from "@/server/domains/case/case.service";

type DraftRow = NonNullable<Awaited<ReturnType<typeof prisma.agentGenDraft.findFirst>>>;

function serialize(r: DraftRow): DraftView {
  return {
    id: r.id,
    stage: r.stage as PipelineStage,
    assetType: r.assetType as AgentAssetType,
    name: r.name,
    payload: r.payload,
    meta: r.meta,
    conflictStatus: r.conflictStatus as DraftView["conflictStatus"],
    conflictRef: r.conflictRef,
    selected: r.selected,
    importStatus: r.importStatus as DraftView["importStatus"],
    importedRef: r.importedRef,
    error: r.error,
    createdAt: r.createdAt.toISOString(),
  };
}

/** 冲突检测：功能用例=同模块同名；接口=同 method+path；场景/UI/脚本=同名 */
async function detectConflict(
  projectId: string,
  assetType: string,
  payload: Record<string, unknown>,
): Promise<{ status: "NEW" | "CONFLICT"; ref?: Record<string, unknown> }> {
  if (assetType === "functional_case") {
    const name = String(payload.name ?? "");
    const existing = await prisma.functionalCase.findFirst({
      where: { projectId, deletedAt: null, name },
      select: { id: true, num: true, name: true },
    });
    if (existing)
      return {
        status: "CONFLICT",
        ref: { type: "functional_case", id: existing.id, num: existing.num, name: existing.name },
      };
  } else if (assetType === "api_definition") {
    const method = String(payload.method ?? "GET");
    const apiPath = String(payload.path ?? "");
    const existing = await prisma.apiDefinition.findFirst({
      where: { projectId, deletedAt: null, method, path: apiPath },
      select: { id: true, num: true, name: true },
    });
    if (existing)
      return {
        status: "CONFLICT",
        ref: { type: "api_definition", id: existing.id, num: existing.num, name: existing.name },
      };
  } else if (["scenario", "ui_case", "playwright_script"].includes(assetType)) {
    const name = String(payload.name ?? "");
    const existing = await prisma.scenario.findFirst({
      where: { projectId, deletedAt: null, name },
      select: { id: true, name: true },
    });
    if (existing)
      return {
        status: "CONFLICT",
        ref: { type: "scenario", id: existing.id, name: existing.name },
      };
  }
  return { status: "NEW" };
}

/** 保存草稿（含冲突检测） */
export async function saveDraft(
  projectId: string,
  runId: string,
  stage: PipelineStage,
  assetType: string,
  name: string,
  payload: Record<string, unknown>,
): Promise<DraftRow> {
  const conflict = await detectConflict(projectId, assetType, payload).catch(() => ({
    status: "NEW" as const,
    ref: undefined,
  }));
  return prisma.agentGenDraft.create({
    data: {
      runId,
      projectId,
      stage,
      assetType,
      name,
      payload: JSON.parse(JSON.stringify(payload)) as object,
      conflictStatus: conflict.status,
      conflictRef: conflict.ref ? (JSON.parse(JSON.stringify(conflict.ref)) as object) : undefined,
      selected: false,
      importStatus: "PENDING",
    },
  });
}

/** 列表（分组信封 + 采纳率统计） */
export async function listDrafts(projectId: string, runId: string, assetType?: string) {
  const where = { runId, projectId, ...(assetType ? { assetType } : {}) };
  const [rows, total] = await Promise.all([
    prisma.agentGenDraft.findMany({ where, orderBy: { createdAt: "asc" }, take: 500 }),
    prisma.agentGenDraft.count({ where }),
  ]);

  const byType: Record<string, { total: number; adopted: number; pending: number }> = {};
  let adopted = 0;
  let decided = 0;
  for (const r of rows) {
    const t = (byType[r.assetType] ??= { total: 0, adopted: 0, pending: 0 });
    t.total++;
    if (r.importStatus === "IMPORTED") {
      t.adopted++;
      adopted++;
      decided++;
    } else if (r.importStatus === "DISCARDED") {
      decided++;
    } else {
      t.pending++;
    }
  }

  return {
    total,
    items: rows.map(serialize),
    stats: {
      byType,
      ...(decided > 0 ? { adoptionRate: Math.round((adopted / decided) * 1000) / 10 } : {}),
    },
  };
}

/** 批量选择/取消选择 */
export async function updateSelection(
  projectId: string,
  runId: string,
  draftIds: string[],
  selected: boolean,
) {
  const result = await prisma.agentGenDraft.updateMany({
    where: { runId, projectId, id: { in: draftIds }, importStatus: "PENDING" },
    data: { selected },
  });
  return { updated: result.count };
}

/** 批量废弃 */
export async function discardDrafts(projectId: string, runId: string, draftIds: string[]) {
  const result = await prisma.agentGenDraft.updateMany({
    where: { runId, projectId, id: { in: draftIds }, importStatus: "PENDING" },
    data: { importStatus: "DISCARDED", selected: false },
  });
  return { discarded: result.count };
}

/** 导入选中草稿（人工确认红线；功能用例→ case.service；其余类型 v1 逐补） */
export async function importDrafts(
  projectId: string,
  runId: string,
  userId: string,
  draftIds: string[],
  importMode: "direct" | "review",
) {
  const drafts = await prisma.agentGenDraft.findMany({
    where: { runId, projectId, id: { in: draftIds }, importStatus: "PENDING" },
  });

  let imported = 0;
  let failed = 0;
  const results: { id: string; status: string; ref?: Record<string, unknown>; error?: string }[] =
    [];

  for (const d of drafts) {
    try {
      const payload = d.payload as Record<string, unknown>;
      let ref: Record<string, unknown> | undefined;

      if (d.assetType === "functional_case") {
        const created = await createCase(projectId, userId, {
          name: String(payload.name ?? "未命名"),
          precondition: String(payload.precondition ?? ""),
          steps: (payload.steps as { desc: string; expect: string }[]) ?? [],
          level: (payload.level as "P0" | "P1" | "P2" | "P3") ?? "P2",
          tags: (payload.tags as string[]) ?? [],
        });
        ref = { type: "functional_case", id: created.id, num: created.num };
      } else {
        // 其余类型 v1 登记为 SKIPPED（导入链路逐 sprint 补全）
        await prisma.agentGenDraft.update({
          where: { id: d.id },
          data: { importStatus: "SKIPPED", error: `类型 ${d.assetType} 导入链路待补` },
        });
        results.push({ id: d.id, status: "SKIPPED", error: `类型 ${d.assetType} 导入链路待补` });
        continue;
      }

      await prisma.agentGenDraft.update({
        where: { id: d.id },
        data: {
          importStatus: "IMPORTED",
          importedRef: JSON.parse(JSON.stringify(ref)) as object,
          selected: false,
        },
      });
      results.push({ id: d.id, status: "IMPORTED", ref });
      imported++;
    } catch (e) {
      const msg = (e as Error).message?.slice(0, 512) ?? "导入失败";
      await prisma.agentGenDraft
        .update({ where: { id: d.id }, data: { importStatus: "FAILED", error: msg } })
        .catch(() => {});
      results.push({ id: d.id, status: "FAILED", error: msg });
      failed++;
    }
  }

  return { imported, failed, skipped: drafts.length - imported - failed, results };
}

/** Agent 累计采纳率 */
export async function agentAdoptionRate(
  projectId: string,
  agentId: string,
): Promise<{
  generated: number;
  adopted: number;
  rate: number | null;
}> {
  const [generated, adopted] = await Promise.all([
    prisma.agentGenDraft.count({ where: { projectId, run: { agentId } } }),
    prisma.agentGenDraft.count({
      where: { projectId, run: { agentId }, importStatus: "IMPORTED" },
    }),
  ]);
  const decided = await prisma.agentGenDraft.count({
    where: { projectId, run: { agentId }, importStatus: { in: ["IMPORTED", "DISCARDED"] } },
  });
  return {
    generated,
    adopted,
    rate: decided > 0 ? Math.round((adopted / decided) * 1000) / 10 : null,
  };
}

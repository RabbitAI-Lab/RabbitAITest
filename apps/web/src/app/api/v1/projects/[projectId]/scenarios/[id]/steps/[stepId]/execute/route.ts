import { NextResponse } from "next/server";
import { ok } from "@rabbit/shared";
import { withProjectScope, toResponse } from "@/server/guard";
import { prisma } from "@rabbit/db";
import { createAdhocScenarioTask } from "@/server/domains/exec/exec.service";
import type { ScenarioStepNode } from "@rabbit/shared/execution";

export const runtime = "nodejs";

/** 单步执行（API-006 §2）：以该步骤为根（含子树）的临时场景执行，不入 Scenario 表。 */
export const POST = withProjectScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm("PROJECT_SCENARIO:CREATE");
    const { id, stepId } = await (seg as { params: Promise<{ id: string; stepId: string }> })
      .params;
    const body = (await req.json().catch(() => ({}))) as { envId?: string };
    const scenario = await prisma.scenario.findFirst({
      where: { id, projectId: ctx.projectId, deletedAt: null },
    });
    if (!scenario)
      return NextResponse.json(
        { code: 40474, message: "场景不存在或已删除", data: null },
        { status: 404 },
      );
    const step = await prisma.scenarioStep.findFirst({ where: { id: stepId, scenarioId: id } });
    if (!step)
      return NextResponse.json(
        { code: 40484, message: "场景步骤不存在", data: null },
        { status: 404 },
      );
    // 子树（含自身）构造临时根节点
    const children = await prisma.scenarioStep.findMany({ where: { scenarioId: id } });
    const byParent = new Map<string | null, typeof children>();
    for (const s of children) {
      if (!byParent.has(s.parentId)) byParent.set(s.parentId, []);
      byParent.get(s.parentId)!.push(s);
    }
    const build = (root: (typeof children)[number]): ScenarioStepNode => ({
      uid: root.id,
      stepType: root.stepType as ScenarioStepNode["stepType"],
      name: root.name,
      enabled: root.enabled,
      config: (root.config as Record<string, unknown>) ?? {},
      children: (byParent.get(root.id) ?? []).map(build),
    });
    const cfg = (scenario.config ?? {}) as { params?: unknown; settings?: unknown };
    const params = (cfg.params ?? {
      constants: [],
      lists: [],
      csv: { source: "inline", delimiter: ",", hasHeader: true },
    }) as {
      constants: { name: string; value: string }[];
      lists: { name: string; values: string[] }[];
      csv: { columns: string[]; rows: string[][] };
    };
    const settings = (cfg.settings ?? {}) as {
      cookieMode?: "off" | "keep";
      thinkTimeMs?: number;
      onFailure?: "continue" | "abort";
    };
    const r = await createAdhocScenarioTask(ctx.projectId, ctx.userId, {
      name: `单步调试 · ${step.name}`,
      steps: [build(step)],
      params: {
        constants: (params.constants ?? []).map((c) => ({
          name: c.name,
          value: c.value,
          description: "",
        })),
        lists: params.lists ?? [],
        csv: params.csv ?? { columns: [], rows: [] },
      },
      settings: {
        cookieMode: settings.cookieMode ?? "off",
        thinkTimeMs: settings.thinkTimeMs ?? 0,
        onFailure: settings.onFailure ?? "abort",
      },
      envId: body.envId,
    });
    return NextResponse.json(ok(r), { status: 201 });
  } catch (err) {
    return toResponse(err);
  }
});

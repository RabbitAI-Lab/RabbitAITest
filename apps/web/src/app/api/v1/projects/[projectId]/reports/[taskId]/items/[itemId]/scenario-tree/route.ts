import { NextResponse } from "next/server";
import { ok } from "@rabbit/shared";
import { withProjectScope, toResponse } from "@/server/guard";
import { scenarioTree } from "@/server/domains/exec/exec.service";

export const runtime = "nodejs";

/** 场景步骤树视图（RPT-003 §4：stepPath 树 + 迭代分组 + 变量终值）。 */
export const GET = withProjectScope(async (ctx, _req, seg) => {
  try {
    ctx.requirePerm("PROJECT_REPORT:READ");
    const { taskId, itemId } = await (seg as { params: Promise<{ taskId: string; itemId: string }> }).params;
    return NextResponse.json(ok(await scenarioTree(ctx.projectId, taskId, itemId)));
  } catch (err) {
    return toResponse(err);
  }
});

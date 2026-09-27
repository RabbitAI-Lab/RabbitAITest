import { NextResponse } from "next/server";
import { toResponse, okResponse } from "@/server/guard";
import { openExecApiCaseSchema } from "@rabbit/shared";
import { withApiKey, assertProjectVisible } from "@/server/open-api-guard";
import { createApiCaseTask } from "@/server/domains/exec/exec.service";
import { prisma } from "@rabbit/db";

export const runtime = "nodejs";

/** INTG-003：CI 触发接口用例执行（open；返回 taskId 长任务约定）。 */
export const POST = withApiKey(async (ctx, req) => {
  try {
    const body = openExecApiCaseSchema.parse(await req.json());
    const apiCase = await prisma.apiCase.findFirst({
      where: { id: body.apiCaseId, deletedAt: null },
      select: { projectId: true },
    });
    if (!apiCase) return NextResponse.json({ code: 40424, message: "接口用例不存在", data: null }, { status: 404 });
    await assertProjectVisible(ctx.userId, apiCase.projectId);
    const { taskId } = await createApiCaseTask(apiCase.projectId, ctx.userId, {
      caseIds: [body.apiCaseId],
      envId: body.envId,
      stopOnFail: false,
    });
    return okResponse({ taskId }, 201);
  } catch (err) {
    return toResponse(err);
  }
});

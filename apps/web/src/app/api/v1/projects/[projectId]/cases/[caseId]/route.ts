import { withProjectScope, toResponse, okResponse } from "@/server/guard";
import { caseUpdateV2Schema } from "@rabbit/shared";
import * as svc from "@/server/domains/case/caseV2.service";

export const GET = withProjectScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm("PROJECT_CASE:READ");
    const { caseId } = await (seg as { params: Promise<{ caseId: string }> }).params;
    return okResponse(await svc.getCaseV2(ctx.projectId, caseId));
  } catch (err) {
    return toResponse(err);
  }
});

export const PUT = withProjectScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm("PROJECT_CASE:UPDATE");
    ctx.requireWritable();
    const { caseId } = await (seg as { params: Promise<{ caseId: string }> }).params;
    const body = caseUpdateV2Schema.parse(await req.json());
    return okResponse(await svc.updateCaseV2(ctx.projectId, ctx.orgId, ctx.userId, caseId, body));
  } catch (err) {
    return toResponse(err);
  }
});

export const DELETE = withProjectScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm("PROJECT_CASE:DELETE");
    ctx.requireWritable();
    const { caseId } = await (seg as { params: Promise<{ caseId: string }> }).params;
    // ?purge=true：回收站内彻底删除（物理删除，与 bugs 路由同款约定；否则软删进回收站）
    const purge = new URL(req.url).searchParams.get("purge") === "true";
    if (purge) {
      const { purgeCase } = await import("@/server/domains/case/case.service");
      return okResponse(await purgeCase(ctx.projectId, caseId));
    }
    return okResponse(await svc.deleteCaseV2(ctx.projectId, caseId, ctx.userId));
  } catch (err) {
    return toResponse(err);
  }
});

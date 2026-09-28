import { withProjectScope, toResponse, okResponse, zodParse } from "@/server/guard";
import { NextResponse } from "next/server";
import { ok } from "@rabbit/shared";
import { mindmapSaveSchema } from "@rabbit/shared";
import * as svc from "@/server/domains/case/mindmap.service";

/** S4 CASE-007：脑图批量保存（模块批+用例批一次提交；tmpId→idMap 回传；版本冲突软收集）。 */
export const POST = withProjectScope(async (ctx, req) => {
  try {
    ctx.requirePerm("PROJECT_CASE:UPDATE");
    ctx.requireWritable();
    const body = zodParse(mindmapSaveSchema, await req.json());
    return NextResponse.json(
      ok(await svc.saveMindmap(ctx.projectId, ctx.orgId, ctx.userId, body)),
      { status: 201 },
    );
  } catch (err) {
    return toResponse(err);
  }
});

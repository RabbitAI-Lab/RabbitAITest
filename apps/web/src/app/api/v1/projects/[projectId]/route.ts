import { NextResponse } from "next/server";
import { withProjectScope, toResponse, okResponse } from "@/server/guard";
import { ErrCode, projectUpdateSchema } from "@rabbit/shared";
import * as svc from "@/server/domains/project/project.service";

export const runtime = "nodejs";

/** PROJ-001 项目信息更新；S-future 修复：zod 失败曾 .parse 抛 ZodError → 500，改 safeParse → 422（rules §4.5 无效参数禁 500；LOAD-001 jmx T3-1 抓获）。 */
export const PUT = withProjectScope(async (ctx, req, _seg) => {
  try {
    ctx.requirePerm("ORG_PROJECT:UPDATE");
    ctx.requireWritable();
    const parsed = projectUpdateSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        {
          code: ErrCode.VALIDATION_FAILED,
          message: parsed.error.issues[0]?.message ?? "参数校验失败",
          data: null,
        },
        { status: 422 },
      );
    }
    return okResponse(await svc.updateProject(ctx.projectId, ctx.userId, parsed.data));
  } catch (err) {
    return toResponse(err);
  }
});

export const DELETE = withProjectScope(async (ctx, _req, _seg) => {
  try {
    ctx.requirePerm("ORG_PROJECT:DELETE");
    return okResponse(await svc.softDeleteProject(ctx.projectId, ctx.userId));
  } catch (err) {
    return toResponse(err);
  }
});

import { NextResponse } from "next/server";
import { ok } from "@rabbit/shared";
import { withProjectScope, toResponse } from "@/server/guard";
import { listUiRunners, installUiRunner } from "@/server/domains/exec/ui-runner.service";
import { uiRunnerInstallBodySchema } from "@rabbit/shared";

export const runtime = "nodejs";

/** S14 UIT-004：Runner 列表（仅本项目 + 内置虚拟行）。 */
export const GET = withProjectScope(async (ctx) => {
  try {
    ctx.requirePerm("PROJECT_UIT:READ");
    return NextResponse.json(ok(await listUiRunners(ctx.projectId)));
  } catch (err) {
    return toResponse(err);
  }
});

/** S14 UIT-004：安装项目 Runner（npm 精确版本 → runner-jobs 队列）。 */
export const POST = withProjectScope(async (ctx, req) => {
  try {
    ctx.requirePerm("PROJECT_UIT:RUNNER_MANAGE");
    ctx.requireWritable();
    const parsed = uiRunnerInstallBodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { code: 90086, message: parsed.error.issues[0]?.message ?? "版本非法", data: null },
        { status: 422 },
      );
    }
    return NextResponse.json(ok(await installUiRunner(ctx.projectId, ctx.userId, parsed.data)), {
      status: 202,
    });
  } catch (err) {
    return toResponse(err);
  }
});

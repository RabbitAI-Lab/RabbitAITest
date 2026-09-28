import { NextResponse } from "next/server";
import { ok } from "@rabbit/shared";
import { withProjectScope, toResponse } from "@/server/guard";
import { copyEnvironment } from "@/server/domains/project/environment.service";

export const runtime = "nodejs";

export const POST = withProjectScope(async (ctx, _req, seg) => {
  try {
    ctx.requirePerm("PROJECT_ENV:CREATE");
    ctx.requireWritable();
    const { envId } = await (seg as { params: Promise<{ envId: string }> }).params;
    return NextResponse.json(ok(await copyEnvironment(ctx.projectId, envId)), { status: 201 });
  } catch (err) {
    return toResponse(err);
  }
});

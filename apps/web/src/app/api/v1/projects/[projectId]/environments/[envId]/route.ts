import { NextResponse } from "next/server";
import { ok, environmentUpsertSchema } from "@rabbit/shared";
import { withProjectScope, toResponse } from "@/server/guard";
import {
  getEnvironment,
  updateEnvironment,
  deleteEnvironment,
} from "@/server/domains/project/environment.service";

export const runtime = "nodejs";

const unprocessable = (message?: string) =>
  NextResponse.json(
    { code: 20422, message: message ?? "参数校验失败", data: null },
    { status: 422 },
  );

export const GET = withProjectScope(async (ctx, _req, seg) => {
  try {
    ctx.requirePerm("PROJECT_ENV:READ");
    const { envId } = await (seg as { params: Promise<{ envId: string }> }).params;
    return NextResponse.json(ok(await getEnvironment(ctx.projectId, envId)));
  } catch (err) {
    return toResponse(err);
  }
});

export const PUT = withProjectScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm("PROJECT_ENV:UPDATE");
    ctx.requireWritable();
    const { envId } = await (seg as { params: Promise<{ envId: string }> }).params;
    const parsed = environmentUpsertSchema.partial().safeParse(await req.json());
    if (!parsed.success) return unprocessable(parsed.error.issues[0]?.message);
    return NextResponse.json(
      ok(await updateEnvironment(ctx.projectId, envId, parsed.data)),
    );
  } catch (err) {
    return toResponse(err);
  }
});

export const DELETE = withProjectScope(async (ctx, _req, seg) => {
  try {
    ctx.requirePerm("PROJECT_ENV:DELETE");
    ctx.requireWritable();
    const { envId } = await (seg as { params: Promise<{ envId: string }> }).params;
    return NextResponse.json(ok(await deleteEnvironment(ctx.projectId, envId)));
  } catch (err) {
    return toResponse(err);
  }
});

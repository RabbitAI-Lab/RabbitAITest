import { NextResponse } from "next/server";
import { ok, falseAlarmRuleSaveSchema } from "@rabbit/shared";
import { withProjectScope, toResponse } from "@/server/guard";
import { listRules, createRule } from "@/server/domains/api/false-alarm.service";

export const runtime = "nodejs";

const unprocessable = (message?: string) =>
  NextResponse.json(
    { code: 20422, message: message ?? "参数校验失败", data: null },
    { status: 422 },
  );

export const GET = withProjectScope(async (ctx) => {
  try {
    ctx.requirePerm("PROJECT_SCENARIO:READ");
    return NextResponse.json(ok(await listRules(ctx.projectId)));
  } catch (err) {
    return toResponse(err);
  }
});

export const POST = withProjectScope(async (ctx, req) => {
  try {
    ctx.requirePerm("PROJECT_SCENARIO:UPDATE");
    ctx.requireWritable();
    const parsed = falseAlarmRuleSaveSchema.safeParse(await req.json());
    if (!parsed.success) return unprocessable(parsed.error.issues[0]?.message);
    return NextResponse.json(ok(await createRule(ctx.projectId, ctx.userId, parsed.data)), {
      status: 201,
    });
  } catch (err) {
    return toResponse(err);
  }
});

import { NextResponse } from "next/server";
import { ok, aiPromptSaveSchema } from "@rabbit/shared";
import { withProjectScope, toResponse } from "@/server/guard";
import { updateTemplate, deleteTemplate } from "@/server/domains/ai/prompt.service";

export const runtime = "nodejs";

const unprocessable = (message?: string) =>
  NextResponse.json({ code: 20422, message: message ?? "参数校验失败", data: null }, { status: 422 });

export const PUT = withProjectScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm("PROJECT_AI:UPDATE");
    ctx.requireWritable();
    const { id } = await (seg as { params: Promise<{ id: string }> }).params;
    const parsed = aiPromptSaveSchema.safeParse(await req.json());
    if (!parsed.success) return unprocessable(parsed.error.issues[0]?.message);
    return NextResponse.json(ok(await updateTemplate(ctx.projectId, id, parsed.data)));
  } catch (err) {
    return toResponse(err);
  }
});

export const DELETE = withProjectScope(async (ctx, _req, seg) => {
  try {
    ctx.requirePerm("PROJECT_AI:DELETE");
    ctx.requireWritable();
    const { id } = await (seg as { params: Promise<{ id: string }> }).params;
    return NextResponse.json(ok(await deleteTemplate(ctx.projectId, id)));
  } catch (err) {
    return toResponse(err);
  }
});

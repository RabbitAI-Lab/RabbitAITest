import { NextResponse } from "next/server";
import { ok, aiModelSaveSchema } from "@rabbit/shared";
import { withSystemPerm, toResponse } from "@/server/guard";
import { updateModel, deleteModel } from "@/server/domains/ai/model.service";

export const runtime = "nodejs";

const unprocessable = (message?: string) =>
  NextResponse.json(
    { code: 20422, message: message ?? "参数校验失败", data: null },
    { status: 422 },
  );

export const PUT = withSystemPerm("SYSTEM_AI:UPDATE")(async (ctx, req, seg) => {
  try {
    const { id } = await (seg as { params: Promise<{ id: string }> }).params;
    const parsed = aiModelSaveSchema.safeParse(await req.json());
    if (!parsed.success) return unprocessable(parsed.error.issues[0]?.message);
    return NextResponse.json(ok(await updateModel(id, parsed.data)));
  } catch (err) {
    return toResponse(err);
  }
});

export const DELETE = withSystemPerm("SYSTEM_AI:DELETE")(async (ctx, req, seg) => {
  try {
    const { id } = await (seg as { params: Promise<{ id: string }> }).params;
    return NextResponse.json(ok(await deleteModel(id)));
  } catch (err) {
    return toResponse(err);
  }
});

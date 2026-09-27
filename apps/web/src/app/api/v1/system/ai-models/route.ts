import { NextResponse } from "next/server";
import { ok, aiModelCreateSchema } from "@rabbit/shared";
import { withSystemPerm, toResponse } from "@/server/guard";
import { listModels, createModel } from "@/server/domains/ai/model.service";

export const runtime = "nodejs";

const unprocessable = (message?: string) =>
  NextResponse.json({ code: 20422, message: message ?? "参数校验失败", data: null }, { status: 422 });

export const GET = withSystemPerm("SYSTEM_AI:READ")(async (_ctx) => {
  try {
    return NextResponse.json(ok(await listModels()));
  } catch (err) {
    return toResponse(err);
  }
});

export const POST = withSystemPerm("SYSTEM_AI:CREATE")(async (ctx, req) => {
  try {
    const parsed = aiModelCreateSchema.safeParse(await req.json());
    if (!parsed.success) return unprocessable(parsed.error.issues[0]?.message);
    return NextResponse.json(ok(await createModel(parsed.data)), { status: 201 });
  } catch (err) {
    return toResponse(err);
  }
});

import { NextResponse } from "next/server";
import { ok } from "@rabbit/shared";
import { withSystemPerm, toResponse } from "@/server/guard";
import { testModel } from "@/server/domains/ai/model.service";

export const runtime = "nodejs";

export const POST = withSystemPerm("SYSTEM_AI:UPDATE")(async (ctx, _req, seg) => {
  try {
    const { id } = await (seg as { params: Promise<{ id: string }> }).params;
    return NextResponse.json(ok(await testModel(id)));
  } catch (err) {
    return toResponse(err);
  }
});

import { NextResponse } from "next/server";
import { ok } from "@rabbit/shared";
import { withSystemPerm, toResponse } from "@/server/guard";
import { setDefaultModel } from "@/server/domains/ai/model.service";

export const runtime = "nodejs";

export const PUT = withSystemPerm("SYSTEM_AI:UPDATE")(async (ctx, _req, seg) => {
  try {
    const { id } = await (seg as { params: Promise<{ id: string }> }).params;
    return NextResponse.json(ok(await setDefaultModel(id)));
  } catch (err) {
    return toResponse(err);
  }
});

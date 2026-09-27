import { NextResponse } from "next/server";
import { ok } from "@rabbit/shared";
import { withProjectScope, toResponse } from "@/server/guard";
import { apiReferences } from "@/server/domains/api/api.service";

export const runtime = "nodejs";

export const GET = withProjectScope(async (ctx, _req, seg) => {
  try {
    ctx.requirePerm("PROJECT_API:READ");
    const { apiId } = await (seg as { params: Promise<{ apiId: string }> }).params;
    return NextResponse.json(ok(await apiReferences(ctx.projectId, apiId)));
  } catch (err) {
    return toResponse(err);
  }
});

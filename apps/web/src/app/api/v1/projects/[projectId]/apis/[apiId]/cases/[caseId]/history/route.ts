import { NextResponse } from "next/server";
import { ok } from "@rabbit/shared";
import { withProjectScope, toResponse } from "@/server/guard";
import { caseHistory } from "@/server/domains/api/api-case.service";

export const runtime = "nodejs";

export const GET = withProjectScope(async (ctx, _req, seg) => {
  try {
    ctx.requirePerm("PROJECT_API:READ");
    const { caseId } = await (seg as { params: Promise<{ caseId: string }> }).params;
    return NextResponse.json(ok(await caseHistory(ctx.projectId, caseId)));
  } catch (err) {
    return toResponse(err);
  }
});

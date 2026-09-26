import { NextResponse } from "next/server";
import { ok } from "@rabbit/shared";
import { withProjectScope } from "@/server/guard";
import { reportDetail } from "@/server/domains/exec/exec.service";

export const runtime = "nodejs";

export const GET = withProjectScope(
  async (ctx, _req, seg: { params: Promise<{ taskId: string }> }) => {
    const { taskId } = await seg.params;
    return NextResponse.json(ok(await reportDetail(ctx.projectId, taskId)));
  },
);

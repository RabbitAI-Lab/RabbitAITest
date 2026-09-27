import { NextResponse } from "next/server";
import { ok } from "@rabbit/shared";
import { withProjectScope, toResponse } from "@/server/guard";
import { reportDetail, deleteReport } from "@/server/domains/exec/exec.service";

export const runtime = "nodejs";

export const GET = withProjectScope(
  async (ctx, _req, seg: { params: Promise<{ taskId: string }> }) => {
    try {
      ctx.requirePerm("PROJECT_REPORT:READ");
      const { taskId } = await seg.params;
      return NextResponse.json(ok(await reportDetail(ctx.projectId, taskId)));
    } catch (err) {
      return toResponse(err);
    }
  },
);

export const DELETE = withProjectScope(
  async (ctx, _req, seg: { params: Promise<{ taskId: string }> }) => {
    try {
      ctx.requirePerm("PROJECT_REPORT:READ");
      ctx.requireWritable();
      const { taskId } = await seg.params;
      return NextResponse.json(ok(await deleteReport(ctx.projectId, taskId)));
    } catch (err) {
      return toResponse(err);
    }
  },
);

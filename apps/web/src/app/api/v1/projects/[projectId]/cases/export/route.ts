import { toResponse, withProjectScope } from "@/server/guard";
import { exportOptionsSchema } from "@rabbit/shared";
import * as svc from "@/server/domains/case/caseIo.service";

export const POST = withProjectScope(async (ctx, req) => {
  try {
    ctx.requirePerm("PROJECT_CASE:READ");
    const body = exportOptionsSchema.parse(await req.json());
    const { buffer, filename, contentType } = await svc.exportCases(ctx.projectId, ctx.orgId, {
      format: body.format,
      fields: body.fields,
      caseIds: body.caseIds,
    });
    const res = new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition":
          "attachment; filename=" + JSON.stringify(encodeURIComponent(filename)),
      },
    });
    return res as unknown as import("next/server").NextResponse;
  } catch (err) {
    return toResponse(err);
  }
});

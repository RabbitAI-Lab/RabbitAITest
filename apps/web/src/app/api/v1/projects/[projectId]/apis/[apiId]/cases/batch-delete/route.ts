import { NextResponse } from "next/server";
import { z } from "zod";
import { ok } from "@rabbit/shared";
import { withProjectScope, toResponse } from "@/server/guard";
import { batchDelete } from "@/server/domains/api/api-case.service";

export const runtime = "nodejs";

const schema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(200),
});

export const POST = withProjectScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm("PROJECT_API:DELETE");
    ctx.requireWritable();
    const { apiId } = await (seg as { params: Promise<{ apiId: string }> }).params;
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        {
          code: 20422,
          message: parsed.error.issues[0]?.message ?? "参数校验失败",
          data: null,
        },
        { status: 422 },
      );
    }
    return NextResponse.json(
      ok(await batchDelete(ctx.projectId, apiId, parsed.data.ids)),
    );
  } catch (err) {
    return toResponse(err);
  }
});

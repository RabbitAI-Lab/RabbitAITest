import { NextResponse } from "next/server";
import { z } from "zod";
import { ok } from "@rabbit/shared";
import { withProjectScope, toResponse } from "@/server/guard";
import { debugMock } from "@/server/domains/api/mock.service";

export const runtime = "nodejs";

const debugSchema = z.object({
  query: z.record(z.string(), z.string()).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  body: z
    .string()
    .max(64 * 1024)
    .optional(),
});

export const POST = withProjectScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm("PROJECT_API:READ");
    const { mockId } = await (seg as { params: Promise<{ mockId: string }> }).params;
    const parsed = debugSchema.safeParse(await req.json());
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
    return NextResponse.json(ok(await debugMock(ctx.projectId, mockId, parsed.data)));
  } catch (err) {
    return toResponse(err);
  }
});

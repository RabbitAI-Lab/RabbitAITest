import { NextResponse } from "next/server";
import { ok, curlParseSchema } from "@rabbit/shared";
import { withProjectScope, toResponse } from "@/server/guard";
import { parseCurl } from "@/server/domains/api/import.service";

export const runtime = "nodejs";

export const POST = withProjectScope(async (ctx, req) => {
  try {
    ctx.requirePerm("PROJECT_API:READ");
    const parsed = curlParseSchema.safeParse(await req.json());
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
    return NextResponse.json(ok(await parseCurl(parsed.data.curl)));
  } catch (err) {
    return toResponse(err);
  }
});

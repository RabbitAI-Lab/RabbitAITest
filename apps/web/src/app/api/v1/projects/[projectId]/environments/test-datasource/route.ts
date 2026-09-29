import { NextResponse } from "next/server";
import { ok, datasourceTestSchema } from "@rabbit/shared";
import { withProjectScope, toResponse } from "@/server/guard";
import { testDatasource } from "@/server/domains/project/environment.service";

export const runtime = "nodejs";

const unprocessable = (message?: string) =>
  NextResponse.json(
    { code: 20422, message: message ?? "参数校验失败", data: null },
    { status: 422 },
  );

/** 连接失败不是 500：统一返回 {ok:false,message}。 */
export const POST = withProjectScope(async (ctx, req) => {
  try {
    ctx.requirePerm("PROJECT_ENV:UPDATE");
    const parsed = datasourceTestSchema.safeParse(await req.json());
    if (!parsed.success) return unprocessable(parsed.error.issues[0]?.message);
    try {
      const r = await testDatasource(parsed.data.driver, parsed.data.url);
      return NextResponse.json(ok(r));
    } catch (e) {
      return NextResponse.json(
        ok({ ok: false, message: e instanceof Error ? e.message : String(e) }),
      );
    }
  } catch (err) {
    return toResponse(err);
  }
});

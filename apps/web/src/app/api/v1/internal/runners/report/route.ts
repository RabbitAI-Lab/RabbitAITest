import { NextResponse } from "next/server";
import { ok, runnerReportSchema } from "@rabbit/shared";
import { withInternalToken, toResponse } from "@/server/guard";
import { handleRunnerReport } from "@/server/domains/exec/ui-runner.service";

export const runtime = "nodejs";

/** S14 UIT-004：engine runner 作业回调（X-Internal-Token）：安装进度/终态、检测结果（内置→Redis 缓存、
 * 项目→行回写）、目录清理结果。载荷白名单=runnerReportSchema，非法 422 拒收。 */
export const POST = withInternalToken(async (req) => {
  try {
    const parsed = runnerReportSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { code: 50001, message: "回调载荷非法", data: null },
        { status: 422 },
      );
    }
    await handleRunnerReport(parsed.data);
    return NextResponse.json(ok({ accepted: true }));
  } catch (err) {
    return toResponse(err);
  }
});

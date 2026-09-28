import { okResponse, toResponse, withProjectScope } from "@/server/guard";
import * as svc from "@/server/domains/project/public-script.service";

export const runtime = "nodejs";

type Seg = { params: Promise<{ scriptId: string }> };

/** PROJ-005：引用清单（删除确认弹窗数据；api 用例/场景/环境三处扫描）。 */
export const GET = withProjectScope(async (ctx, _req, seg) => {
  try {
    ctx.requirePerm("PROJECT_SCRIPT:READ");
    const { scriptId } = await (seg as Seg).params;
    return okResponse(await svc.listScriptReferences(ctx.projectId, scriptId));
  } catch (err) {
    return toResponse(err);
  }
});

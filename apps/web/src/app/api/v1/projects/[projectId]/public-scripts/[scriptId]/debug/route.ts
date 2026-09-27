import { okResponse, toResponse, withProjectScope, zodParse } from "@/server/guard";
import { publicScriptDebugSchema } from "@rabbit/shared";
import * as svc from "@/server/domains/project/public-script.service";

export const runtime = "nodejs";

type Seg = { params: Promise<{ scriptId: string }> };

/** PROJ-005：在线调试（两态均可；vars+params 注入；控制台输出）。 */
export const POST = withProjectScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm("PROJECT_SCRIPT:READ");
    const { scriptId } = await (seg as Seg).params;
    const body = zodParse(publicScriptDebugSchema, await req.json());
    return okResponse(await svc.debugPublicScript(ctx.projectId, scriptId, body));
  } catch (err) {
    return toResponse(err);
  }
});

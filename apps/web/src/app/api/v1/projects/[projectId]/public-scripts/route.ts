import { okResponse, toResponse, withProjectScope, zodParse } from "@/server/guard";
import { recordAudit, flushAudit } from "@/server/domains/system/audit.service";
import { publicScriptUpsertSchema } from "@rabbit/shared";
import * as svc from "@/server/domains/project/public-script.service";

export const runtime = "nodejs";

/** PROJ-005：公共脚本列表/新建（PROJECT_SCRIPT 点，S5 扩四动作）。 */
export const GET = withProjectScope(async (ctx, req) => {
  try {
    ctx.requirePerm("PROJECT_SCRIPT:READ");
    const keyword = new URL(req.url).searchParams.get("keyword") ?? undefined;
    return okResponse(await svc.listPublicScripts(ctx.projectId, { keyword }));
  } catch (err) {
    return toResponse(err);
  }
});

export const POST = withProjectScope(async (ctx, req) => {
  try {
    ctx.requirePerm("PROJECT_SCRIPT:CREATE");
    ctx.requireWritable();
    const body = zodParse(publicScriptUpsertSchema, await req.json());
    const created = await svc.createPublicScript(ctx.projectId, body);
    recordAudit({
      userId: ctx.userId,
      scope: "project",
      projectId: ctx.projectId,
      action: "public_script.create",
      objectType: "public_script",
      objectId: created.id,
      detail: { name: created.name },
    });
    void flushAudit();
    return okResponse(created, 201);
  } catch (err) {
    return toResponse(err);
  }
});

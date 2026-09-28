import { NextResponse } from "next/server";
import { okResponse, toResponse, withProjectScope, zodParse } from "@/server/guard";
import { recordAudit, flushAudit } from "@/server/domains/system/audit.service";
import { ok, publicScriptUpsertSchema, publicScriptStatusSchema } from "@rabbit/shared";
import * as svc from "@/server/domains/project/public-script.service";

export const runtime = "nodejs";

type Seg = { params: Promise<{ scriptId: string }> };

/** PROJ-005：脚本详情/编辑（PATCH 兼字段与状态流转）/删除（被引用 409，?force=true 强删）。 */
export const GET = withProjectScope(async (ctx, _req, seg) => {
  try {
    ctx.requirePerm("PROJECT_SCRIPT:READ");
    const { scriptId } = await (seg as Seg).params;
    const s = await svc.listPublicScripts(ctx.projectId, {});
    const hit = s.items.find((i) => i.id === scriptId);
    if (!hit) {
      return NextResponse.json(
        { code: 20450, message: "公共脚本不存在或已删除", data: null },
        { status: 404 },
      );
    }
    return okResponse(hit);
  } catch (err) {
    return toResponse(err);
  }
});

export const PATCH = withProjectScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm("PROJECT_SCRIPT:UPDATE");
    ctx.requireWritable();
    const { scriptId } = await (seg as Seg).params;
    const raw = (await req.json()) as Record<string, unknown>;
    if (Object.keys(raw).length === 1 && "status" in raw) {
      const body = zodParse(publicScriptStatusSchema, raw);
      const updated = await svc.setPublicScriptStatus(ctx.projectId, scriptId, body.status);
      recordAudit({
        userId: ctx.userId,
        scope: "project",
        projectId: ctx.projectId,
        action: "public_script.status",
        objectType: "public_script",
        objectId: scriptId,
        detail: { status: body.status },
      });
      void flushAudit();
      return okResponse(updated);
    }
    const body = zodParse(publicScriptUpsertSchema, raw);
    const updated = await svc.updatePublicScript(ctx.projectId, scriptId, body);
    recordAudit({
      userId: ctx.userId,
      scope: "project",
      projectId: ctx.projectId,
      action: "public_script.update",
      objectType: "public_script",
      objectId: scriptId,
      detail: { name: updated.name },
    });
    void flushAudit();
    return okResponse(updated);
  } catch (err) {
    return toResponse(err);
  }
});

export const DELETE = withProjectScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm("PROJECT_SCRIPT:DELETE");
    ctx.requireWritable();
    const { scriptId } = await (seg as Seg).params;
    const force = new URL(req.url).searchParams.get("force") === "true";
    const r = await svc.deletePublicScript(ctx.projectId, scriptId, force);
    recordAudit({
      userId: ctx.userId,
      scope: "project",
      projectId: ctx.projectId,
      action: "public_script.delete",
      objectType: "public_script",
      objectId: scriptId,
      detail: { force },
    });
    void flushAudit();
    return NextResponse.json(ok(r));
  } catch (err) {
    return toResponse(err);
  }
});

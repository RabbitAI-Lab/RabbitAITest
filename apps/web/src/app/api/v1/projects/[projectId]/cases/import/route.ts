import { toResponse, okResponse, withProjectScope } from "@/server/guard";
import * as svc from "@/server/domains/case/caseIo.service";

export const POST = withProjectScope(async (ctx, req) => {
  try {
    ctx.requirePerm("PROJECT_CASE:CREATE");
    ctx.requireWritable();
    const form = await req.formData();
    const file = form.get("file");
    const mode = (String(form.get("mode") ?? "skip") === "overwrite" ? "overwrite" : "skip") as
      | "overwrite"
      | "skip";
    const moduleId = String(form.get("moduleId") ?? "") || undefined;
    if (!(file instanceof File)) return okResponse({ ok: false, message: "缺少文件" }, 422);
    const buffer = Buffer.from(await file.arrayBuffer());
    const report = await svc.importCases(ctx.projectId, ctx.orgId, ctx.userId, {
      buffer,
      filename: file.name,
      mode,
      moduleId,
    });
    return okResponse(report);
  } catch (err) {
    return toResponse(err);
  }
});

import { toResponse, okResponse, withProjectScope } from "@/server/guard";
import * as svc from "@/server/domains/bug/bug.service";

export const POST = withProjectScope(async (ctx, req) => {
  try {
    ctx.requirePerm("PROJECT_BUG:CREATE");
    ctx.requireWritable();
    const form = await req.formData();
    const file = form.get("file");
    const entity = String(form.get("entity") ?? "");
    if (!(file instanceof File) || !entity.includes(":"))
      return okResponse({ ok: false, message: "缺少 file/entity" }, 422);
    const [entityType, entityId] = entity.split(":") as [string, string];
    const buffer = Buffer.from(await file.arrayBuffer());
    return okResponse(
      await svc.addAttachment(ctx.projectId, ctx.userId, entityType, entityId, {
        name: file.name,
        mime: file.type || undefined,
        size: buffer.byteLength,
        buffer,
      }),
      201,
    );
  } catch (err) {
    return toResponse(err);
  }
});

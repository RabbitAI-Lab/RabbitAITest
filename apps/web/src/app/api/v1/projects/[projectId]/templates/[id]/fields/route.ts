import { toResponse, okResponse, withProjectScope } from "@/server/guard";
import { templateFieldsUpdateSchema } from "@rabbit/shared";
import * as svc from "@/server/domains/project/template.service";

export const PUT = withProjectScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm("PROJECT_TEMPLATE:UPDATE");
    ctx.requireWritable();
    const { id } = await (seg as { params: Promise<{ id: string }> }).params;
    const body = templateFieldsUpdateSchema.parse(await req.json());
    return okResponse(await svc.updateTemplateFields(ctx.orgId, id, body.fields));
  } catch (err) {
    return toResponse(err);
  }
});

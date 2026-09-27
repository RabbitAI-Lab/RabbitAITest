import { toResponse, okResponse, withAuth } from "@/server/guard";
import { apiKeyCreateSchema } from "@rabbit/shared";
import * as svc from "@/server/domains/api/apikey.service";
import { recordAudit, flushAudit } from "@/server/domains/system/audit.service";

export const runtime = "nodejs";

/** INTG-003：APIKEY 列表（本人）。 */
export const GET = withAuth(async (ctx) => {
  try {
    return okResponse(await svc.listApiKeys(ctx.userId));
  } catch (err) {
    return toResponse(err);
  }
});

/** INTG-003：创建（sk 仅此一次返回；上限 5 条 10011）。 */
export const POST = withAuth(async (ctx, req: Request) => {
  try {
    const body = apiKeyCreateSchema.parse(await req.json());
    const created = await svc.createApiKey(ctx.userId, body.name);
    recordAudit({
      userId: ctx.userId,
      scope: "system",
      action: "apikey.create",
      objectType: "api_key",
      objectId: created.prefix,
      detail: { name: created.name },
    });
    void flushAudit();
    return okResponse(created, 201);
  } catch (err) {
    return toResponse(err);
  }
});

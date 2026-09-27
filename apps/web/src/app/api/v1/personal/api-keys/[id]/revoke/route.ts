import { toResponse, okResponse, withAuth } from "@/server/guard";
import * as svc from "@/server/domains/api/apikey.service";
import { recordAudit, flushAudit } from "@/server/domains/system/audit.service";

export const runtime = "nodejs";

/** INTG-003：吊销（本人；已吊销再吊销 → 10010）。 */
export const PUT = withAuth(async (ctx, _req, seg) => {
  try {
    const { id } = await (seg as { params: Promise<{ id: string }> }).params;
    await svc.revokeApiKey(ctx.userId, id);
    recordAudit({
      userId: ctx.userId,
      scope: "system",
      action: "apikey.revoke",
      objectType: "api_key",
      objectId: id,
    });
    void flushAudit();
    return okResponse({ ok: true });
  } catch (err) {
    return toResponse(err);
  }
});

import { okResponse, toResponse, withAuth, zodParse } from "@/server/guard";
import { recordAudit, flushAudit } from "@/server/domains/system/audit.service";
import { personalAiModelSchema } from "@rabbit/shared";
import * as svc from "@/server/domains/system/personal.service";

export const runtime = "nodejs";

/** SYS-007：个人默认模型（S7 AI-001 挂点兑现：助手/生成优先使用）。 */
export const GET = withAuth(async (ctx) => {
  try {
    return okResponse(await svc.getPersonalAiModel(ctx.userId));
  } catch (err) {
    return toResponse(err);
  }
});

export const PUT = withAuth(async (ctx, req: Request) => {
  try {
    const body = zodParse(personalAiModelSchema, await req.json());
    const r = await svc.putPersonalAiModel(ctx.userId, body.modelId);
    recordAudit({
      userId: ctx.userId,
      scope: "system",
      action: "personal.ai_model",
      objectType: "user_preference",
      objectId: ctx.userId,
      detail: { modelId: body.modelId },
    });
    void flushAudit();
    return okResponse(r);
  } catch (err) {
    return toResponse(err);
  }
});

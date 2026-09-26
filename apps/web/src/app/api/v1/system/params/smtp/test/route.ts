import { withSystemPerm, toResponse, okResponse } from "@/server/guard";
import { smtpParamSchema } from "@rabbit/shared";
import * as svc from "@/server/domains/system/param.service";

export const POST = withSystemPerm("SYSTEM_PARAM:UPDATE")(async (ctx, req, _seg) => {
  try {
    const body = smtpParamSchema.parse(await req.json());
    return okResponse(await svc.testSmtp(body));
  } catch (err) {
    return toResponse(err);
  }
});

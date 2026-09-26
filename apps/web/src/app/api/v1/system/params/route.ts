import { withSystemPerm, toResponse, okResponse } from "@/server/guard";
import * as svc from "@/server/domains/system/param.service";

export const GET = withSystemPerm("SYSTEM_PARAM:READ")(async (ctx, _req, _seg) => {
  try {
    return okResponse(await svc.getParams());
  } catch (err) {
    return toResponse(err);
  }
});

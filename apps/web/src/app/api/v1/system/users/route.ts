import { withSystemPerm, toResponse, okResponse } from "@/server/guard";
import { userListQuerySchema, userCreateSchema } from "@rabbit/shared";
import * as svc from "@/server/domains/system/user.service";

export const GET = withSystemPerm("SYSTEM_USER:READ")(async (ctx, req, _seg) => {
  try {
    const q = userListQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
    return okResponse(await svc.listUsers(q));
  } catch (err) {
    return toResponse(err);
  }
});

export const POST = withSystemPerm("SYSTEM_USER:CREATE")(async (ctx, req, _seg) => {
  try {
    const body = userCreateSchema.parse(await req.json());
    return okResponse(await svc.createUser(ctx.userId, body), 201);
  } catch (err) {
    return toResponse(err);
  }
});

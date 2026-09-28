import { NextResponse } from "next/server";
import { withSystemPerm, toResponse, okResponse } from "@/server/guard";
import { userListQuerySchema, userCreateSchema } from "@rabbit/shared";
import * as svc from "@/server/domains/system/user.service";

export const GET = withSystemPerm("SYSTEM_USER:READ")(async (ctx, req, _seg) => {
  try {
    const qp = userListQuerySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
    if (!qp.success) {
      return NextResponse.json(
        { code: 20422, message: qp.error.issues[0]?.message ?? "参数校验失败", data: null },
        { status: 422 },
      );
    }
    const q = qp.data;
    return okResponse(await svc.listUsers(q));
  } catch (err) {
    return toResponse(err);
  }
});

export const POST = withSystemPerm("SYSTEM_USER:CREATE")(async (ctx, req, _seg) => {
  try {
    const bp = userCreateSchema.safeParse(await req.json());
    if (!bp.success) {
      return NextResponse.json(
        { code: 20422, message: bp.error.issues[0]?.message ?? "参数校验失败", data: null },
        { status: 422 },
      );
    }
    const body = bp.data;
    return okResponse(await svc.createUser(ctx.userId, body), 201);
  } catch (err) {
    return toResponse(err);
  }
});

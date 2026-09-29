import { NextResponse } from "next/server";
import { withProjectScope, toResponse, okResponse } from "@/server/guard";
import { caseListQueryV2Schema, caseCreateV2Schema } from "@rabbit/shared";
import * as svc from "@/server/domains/case/caseV2.service";

export const GET = withProjectScope(async (ctx, req, _seg) => {
  try {
    ctx.requirePerm("PROJECT_CASE:READ");
    const qp = caseListQueryV2Schema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
    if (!qp.success) {
      return NextResponse.json(
        { code: 20422, message: qp.error.issues[0]?.message ?? "参数校验失败", data: null },
        { status: 422 },
      );
    }
    const q = qp.data;
    return okResponse(await svc.listCasesV2(ctx.projectId, q, ctx.userId));
  } catch (err) {
    return toResponse(err);
  }
});

export const POST = withProjectScope(async (ctx, req, _seg) => {
  try {
    ctx.requirePerm("PROJECT_CASE:CREATE");
    ctx.requireWritable();
    const bp = caseCreateV2Schema.safeParse(await req.json());
    if (!bp.success) {
      return NextResponse.json(
        { code: 20422, message: bp.error.issues[0]?.message ?? "参数校验失败", data: null },
        { status: 422 },
      );
    }
    const body = bp.data;
    return okResponse(await svc.createCaseV2(ctx.projectId, ctx.orgId, ctx.userId, body), 201);
  } catch (err) {
    return toResponse(err);
  }
});

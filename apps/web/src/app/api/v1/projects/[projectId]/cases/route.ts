import { NextResponse } from 'next/server';
import { ok, caseCreateSchema, caseListQuerySchema } from '@rabbit/shared';
import { withProjectScope } from '@/server/guard';
import { createCase, listCases } from '@/server/domains/case/case.service';

export const runtime = 'nodejs';

export const GET = withProjectScope(async (ctx, req) => {
  const url = new URL(req.url);
  const q = Object.fromEntries(url.searchParams.entries());
  const parsed = caseListQuerySchema.safeParse(q);
  if (!parsed.success) {
    return NextResponse.json({ code: 20422, message: '查询参数校验失败', data: null }, { status: 422 });
  }
  return NextResponse.json(ok(await listCases(ctx.projectId, parsed.data)));
});

export const POST = withProjectScope(async (ctx, req) => {
  const parsed = caseCreateSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ code: 20422, message: parsed.error.issues[0]?.message ?? '参数校验失败', data: null }, { status: 422 });
  }
  const created = await createCase(ctx.projectId, ctx.userId, parsed.data);
  return NextResponse.json(ok(created), { status: 201 });
});

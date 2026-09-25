import { NextResponse } from 'next/server';
import { ok, caseUpdateSchema } from '@rabbit/shared';
import { withProjectScope } from '@/server/guard';
import { getCase, updateCase, softDeleteCase, purgeCase } from '@/server/domains/case/case.service';

export const runtime = 'nodejs';

type Seg = { params: Promise<{ projectId: string; caseId: string }> };

async function segs(seg: Seg) {
  return { projectId: (await seg.params).projectId, caseId: (await seg.params).caseId };
}

export const GET = withProjectScope(async (ctx, _req, seg) => {
  const { caseId } = await segs(seg as Seg);
  return NextResponse.json(ok(await getCase(ctx.projectId, caseId)));
});

export const PUT = withProjectScope(async (ctx, req, seg) => {
  const { caseId } = await segs(seg as Seg);
  const parsed = caseUpdateSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ code: 20422, message: parsed.error.issues[0]?.message ?? '参数校验失败', data: null }, { status: 422 });
  }
  return NextResponse.json(ok(await updateCase(ctx.projectId, caseId, ctx.userId, parsed.data)));
});

export const DELETE = withProjectScope(async (ctx, req, seg) => {
  const { caseId } = await segs(seg as Seg);
  const purge = new URL(req.url).searchParams.get('purge') === 'true';
  if (purge) {
    await purgeCase(ctx.projectId, caseId);
  } else {
    await softDeleteCase(ctx.projectId, caseId, ctx.userId);
  }
  return NextResponse.json(ok(null));
});

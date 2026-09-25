import { NextResponse } from 'next/server';
import { ok } from '@rabbit/shared';
import { withProjectScope } from '@/server/guard';
import { restoreCase } from '@/server/domains/case/case.service';

export const runtime = 'nodejs';

export const POST = withProjectScope(async (ctx, _req, seg: { params: Promise<{ caseId: string }> }) => {
  const { caseId } = await seg.params;
  await restoreCase(ctx.projectId, caseId);
  return NextResponse.json(ok(null));
});

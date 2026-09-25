import { NextResponse } from 'next/server';
import { z } from 'zod';
import { debugRequestSchema, assertSchema, ok } from '@rabbit/shared';
import { withProjectScope } from '@/server/guard';
import { createDebugTask, debugHistory } from '@/server/domains/exec/exec.service';

export const runtime = 'nodejs';

const createSchema = z.object({
  type: z.literal('api_debug'),
  request: debugRequestSchema,
  asserts: z.array(assertSchema).max(20).default([]),
  clientTaskId: z.string().max(128).optional(),
});

export const POST = withProjectScope(async (ctx, req) => {
  const parsed = createSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ code: 20422, message: parsed.error.issues[0]?.message ?? '参数校验失败', data: null }, { status: 422 });
  }
  const { request, asserts, clientTaskId } = parsed.data;
  const r = await createDebugTask(ctx.projectId, ctx.userId, request, asserts, clientTaskId);
  return NextResponse.json(ok(r), { status: 201 });
});

export const GET = withProjectScope(async (ctx, req) => {
  const url = new URL(req.url);
  const pageSize = Math.min(Number(url.searchParams.get('pageSize') ?? 20) || 20, 50);
  return NextResponse.json(ok(await debugHistory(ctx.projectId, pageSize)));
});

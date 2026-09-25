import { NextResponse } from 'next/server';
import { execCallbackSchema, ok } from '@rabbit/shared';
import { withInternalToken, toResponse } from '@/server/guard';
import { handleCallback } from '@/server/domains/exec/exec.service';

export const runtime = 'nodejs';

export const POST = withInternalToken(async (req, seg) => {
  try {
    const { taskId } = await seg.params;
    if (!taskId) {
      return NextResponse.json({ code: 50001, message: '缺少 taskId', data: null }, { status: 422 });
    }
    const parsed = execCallbackSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ code: 50001, message: '回调载荷非法', data: null }, { status: 422 });
    }
    return NextResponse.json(ok(await handleCallback(taskId, parsed.data)));
  } catch (err) {
    return toResponse(err);
  }
});

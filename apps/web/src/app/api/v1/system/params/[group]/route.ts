import { NextResponse } from "next/server";
import { toResponse, okResponse, withSystemPerm } from '@/server/guard';
import { paramGroupSchema } from '@rabbit/shared';
import * as svc from '@/server/domains/system/param.service';

export const PUT = withSystemPerm('SYSTEM_PARAM:UPDATE')(async (_ctx, req, seg) => {
  try {
    const { group } = await (seg as { params: Promise<{ group: string }> }).params;
    const pp = paramGroupSchema.safeParse(await req.json());
    if (!pp.success) {
      return NextResponse.json(
        { code: 20422, message: pp.error.issues[0]?.message ?? "参数校验失败", data: null },
        { status: 422 },
      );
    }
    const parsed = pp.data;
    if (parsed.group !== group) {
      return okResponse({ ok: false, message: '参数组不匹配' }, 422);
    }
    await svc.updateParam(parsed.group, parsed.value);
    return okResponse({ ok: true });
  } catch (err) { return toResponse(err); }
});

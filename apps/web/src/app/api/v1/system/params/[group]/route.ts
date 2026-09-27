import { NextResponse } from "next/server";
import { toResponse, okResponse, withSystemPerm } from '@/server/guard';
import { paramGroupSchema } from '@rabbit/shared';
import * as svc from '@/server/domains/system/param.service';
import { recordAudit, flushAudit } from '@/server/domains/system/audit.service';

export const PUT = withSystemPerm('SYSTEM_PARAM:UPDATE')(async (ctx, req, seg) => {
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
    // SYS-008 回补清单：系统参数写操作审计（detail 白名单——参数值不含敏感面，仅记组名）
    recordAudit({
      userId: ctx.userId,
      scope: "system",
      action: `param.update`,
      objectType: "system_param",
      objectId: group,
      detail: { group },
    });
    void flushAudit();
    return okResponse({ ok: true });
  } catch (err) { return toResponse(err); }
});

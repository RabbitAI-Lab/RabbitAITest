import { NextResponse } from "next/server";
import { withSystemPerm, toResponse, okResponse } from "@/server/guard";
import { groupMembersSchema } from "@rabbit/shared";
import * as svc from "@/server/domains/system/group.service";

export const POST = withSystemPerm("SYSTEM_GROUP:UPDATE")(async (ctx, req, seg) => {
  try {
    const { id } = await (seg as { params: Promise<{ id: string }> }).params;
    const bp = groupMembersSchema.safeParse(await req.json());
    if (!bp.success) {
      return NextResponse.json(
        { code: 20422, message: bp.error.issues[0]?.message ?? "参数校验失败", data: null },
        { status: 422 },
      );
    }
    return okResponse(await svc.addMembers(id, bp.data.userIds));
  } catch (err) {
    return toResponse(err);
  }
});

import { NextResponse } from "next/server";
import { ok } from "@rabbit/shared";
import { withAuth, toResponse } from "@/server/guard";
import { listMessages } from "@/server/domains/ai/chat.service";

export const runtime = "nodejs";

export const GET = withAuth(async (ctx, _req, seg) => {
  try {
    const { id } = await (seg as { params: Promise<{ id: string }> }).params;
    return NextResponse.json(ok(await listMessages(ctx.userId, id)));
  } catch (err) {
    return toResponse(err);
  }
});

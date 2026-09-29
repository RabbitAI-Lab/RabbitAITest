import { NextResponse } from "next/server";
import { z } from "zod";
import { ok } from "@rabbit/shared";
import { withAuth, toResponse } from "@/server/guard";
import { renameConversation, deleteConversation } from "@/server/domains/ai/chat.service";

export const runtime = "nodejs";

const renameSchema = z.object({ title: z.string().trim().min(1, "标题必填").max(128) });

const unprocessable = (message?: string) =>
  NextResponse.json(
    { code: 20422, message: message ?? "参数校验失败", data: null },
    { status: 422 },
  );

export const PUT = withAuth(async (ctx, req: Request, seg: unknown) => {
  try {
    const { id } = await (seg as { params: Promise<{ id: string }> }).params;
    const parsed = renameSchema.safeParse(await req.json());
    if (!parsed.success) return unprocessable(parsed.error.issues[0]?.message);
    return NextResponse.json(ok(await renameConversation(ctx.userId, id, parsed.data.title)));
  } catch (err) {
    return toResponse(err);
  }
});

export const DELETE = withAuth(async (ctx, _req, seg) => {
  try {
    const { id } = await (seg as { params: Promise<{ id: string }> }).params;
    return NextResponse.json(ok(await deleteConversation(ctx.userId, id)));
  } catch (err) {
    return toResponse(err);
  }
});

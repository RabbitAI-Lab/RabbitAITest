import { NextResponse } from "next/server";
import { ok, aiConversationCreateSchema } from "@rabbit/shared";
import { withAuth, toResponse } from "@/server/guard";
import { listConversations, createConversation } from "@/server/domains/ai/chat.service";

export const runtime = "nodejs";

const unprocessable = (message?: string) =>
  NextResponse.json(
    { code: 20422, message: message ?? "参数校验失败", data: null },
    { status: 422 },
  );

export const GET = withAuth(async (ctx) => {
  try {
    return NextResponse.json(ok(await listConversations(ctx.userId)));
  } catch (err) {
    return toResponse(err);
  }
});

export const POST = withAuth(async (ctx, req: Request) => {
  try {
    const parsed = aiConversationCreateSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return unprocessable(parsed.error.issues[0]?.message);
    return NextResponse.json(ok(await createConversation(ctx.userId, parsed.data)), {
      status: 201,
    });
  } catch (err) {
    return toResponse(err);
  }
});

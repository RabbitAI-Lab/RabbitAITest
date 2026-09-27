import { NextResponse } from "next/server";
import { aiChatSchema } from "@rabbit/shared";
import { withAuth, toResponse } from "@/server/guard";
import { chat } from "@/server/domains/ai/chat.service";

export const runtime = "nodejs";

/** SSE 流式对话（AI-004）：成功响应 text/event-stream；校验/权限错误仍为 JSON 信封。 */
export const POST = withAuth(async (ctx, req: Request) => {
  try {
    const parsed = aiChatSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { code: 20422, message: parsed.error.issues[0]?.message ?? "参数校验失败", data: null },
        { status: 422 },
      );
    }
    const sse = await chat(ctx.userId, parsed.data);
    return new NextResponse(sse.body, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store",
        "x-accel-buffering": "no",
      },
    });
  } catch (err) {
    return toResponse(err);
  }
});

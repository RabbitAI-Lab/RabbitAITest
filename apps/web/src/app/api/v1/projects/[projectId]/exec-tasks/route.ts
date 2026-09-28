import { NextResponse } from "next/server";
import { z } from "zod";
import {
  ok,
  requestSpecSchema,
  assertSchema,
  processorSchema,
  extractorSchema,
  execTaskListQuerySchema,
} from "@rabbit/shared";
import { withProjectScope, toResponse } from "@/server/guard";
import { createDebugTask, listExecTasks, debugHistory } from "@/server/domains/exec/exec.service";

export const runtime = "nodejs";

const unprocessable = (message?: string) =>
  NextResponse.json(
    { code: 20422, message: message ?? "参数校验失败", data: null },
    { status: 422 },
  );

const createSchema = z.object({
  type: z.literal("api_debug"),
  request: requestSpecSchema,
  asserts: z.array(assertSchema).max(50).default([]),
  pre: z.array(processorSchema).max(20).default([]),
  post: z.array(processorSchema).max(20).default([]),
  extracts: z.array(extractorSchema).max(20).default([]),
  envId: z.string().uuid().optional(),
  clientTaskId: z.string().max(128).optional(),
});

export const POST = withProjectScope(async (ctx, req) => {
  try {
    ctx.requirePerm("PROJECT_API:CREATE");
    ctx.requireWritable();
    const parsed = createSchema.safeParse(await req.json());
    if (!parsed.success) return unprocessable(parsed.error.issues[0]?.message);
    const { type: _type, ...input } = parsed.data;
    return NextResponse.json(ok(await createDebugTask(ctx.projectId, ctx.userId, input)), {
      status: 201,
    });
  } catch (err) {
    return toResponse(err);
  }
});

export const GET = withProjectScope(async (ctx, req) => {
  try {
    const url = new URL(req.url);
    // 旧调试历史口径兼容（无 query 参数时）
    if (url.searchParams.size === 0) {
      return NextResponse.json(ok(await debugHistory(ctx.projectId, 20)));
    }
    ctx.requirePerm("PROJECT_EXEC_TASK:READ");
    const parsed = execTaskListQuerySchema.safeParse(Object.fromEntries(url.searchParams));
    if (!parsed.success) return unprocessable(parsed.error.issues[0]?.message);
    return NextResponse.json(ok(await listExecTasks(ctx.projectId, [ctx.projectId], parsed.data)));
  } catch (err) {
    return toResponse(err);
  }
});

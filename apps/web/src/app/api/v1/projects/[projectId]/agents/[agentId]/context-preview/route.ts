/** AGENT-002：上下文装配预估（dry-run，不建 Run）。 */
import { toResponse, okResponse, withProjectScope, zodParse } from "@/server/guard";
import { contextSourceSchema } from "@rabbit/shared";
import { previewContext } from "@/server/domains/agent/pipeline/executor";

type Seg = { params: Promise<{ agentId: string }> };

export const POST = withProjectScope(async (ctx, req, segArg) => {
  try {
    ctx.requirePerm("PROJECT_AGENT:RUN");
    const body = zodParse(contextSourceSchema, await req.json());
    return okResponse(await previewContext(ctx.projectId, body));
  } catch (err) {
    return toResponse(err);
  }
});

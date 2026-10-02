/** AGENT-002：草稿选择/废弃/导入（三端点合一——body 中 action 区分）。 */
import { toResponse, okResponse, withProjectScope, zodParse } from "@/server/guard";
import { z } from "zod";
import { recordAudit, flushAudit } from "@/server/domains/system/audit.service";
import {
  updateSelection,
  discardDrafts,
  importDrafts,
} from "@/server/domains/agent/pipeline/drafts.service";

type Seg = { params: Promise<{ runId: string }> };

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("select"),
    draftIds: z.array(z.string().uuid()).min(1).max(500),
    selected: z.boolean(),
  }),
  z.object({ action: z.literal("discard"), draftIds: z.array(z.string().uuid()).min(1).max(500) }),
  z.object({
    action: z.literal("import"),
    draftIds: z.array(z.string().uuid()).min(1).max(500),
    importMode: z.enum(["direct", "review"]).default("review"),
  }),
]);

export const POST = withProjectScope(async (ctx, req, segArg) => {
  try {
    ctx.requirePerm("PROJECT_AGENT:RUN");
    ctx.requireWritable();
    const { runId } = await (segArg as Seg).params;
    const body = zodParse(actionSchema, await req.json());

    let result: unknown;
    if (body.action === "select") {
      result = await updateSelection(ctx.projectId, runId, body.draftIds, body.selected);
    } else if (body.action === "discard") {
      result = await discardDrafts(ctx.projectId, runId, body.draftIds);
      recordAudit({
        userId: ctx.userId,
        scope: "project",
        projectId: ctx.projectId,
        action: "agent_gen.discard",
        objectType: "agent_run",
        objectId: runId,
        detail: { count: (result as { discarded: number }).discarded },
      });
      void flushAudit();
    } else {
      result = await importDrafts(ctx.projectId, runId, ctx.userId, body.draftIds, body.importMode);
      recordAudit({
        userId: ctx.userId,
        scope: "project",
        projectId: ctx.projectId,
        action: "agent_gen.import",
        objectType: "agent_run",
        objectId: runId,
        detail: {
          count: body.draftIds.length,
          mode: body.importMode,
          ...(result as { imported: number; failed: number }),
        },
      });
      void flushAudit();
    }

    return okResponse(result);
  } catch (err) {
    return toResponse(err);
  }
});

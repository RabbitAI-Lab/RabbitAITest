/** AGENT-002：需求提示词 AI 生成（向导内轻量调用——单次 LLM，≤1K 字符精简）。 */
import { toResponse, okResponse, withProjectScope, zodParse } from "@/server/guard";
import { suggestRequirementSchema } from "@rabbit/shared";
import { prisma } from "@rabbit/db";
import { callChat } from "@/server/domains/ai/chat-client";
import { resolveRuntime } from "@/server/domains/ai/model.service";

type Seg = { params: Promise<{ agentId: string }> };

export const POST = withProjectScope(async (ctx, req, segArg) => {
  try {
    ctx.requirePerm("PROJECT_AGENT:RUN");
    const { agentId } = await (segArg as Seg).params;
    const body = zodParse(suggestRequirementSchema, await req.json());

    // 收集文档名/路径作为输入
    const docNames: string[] = [];
    if (body.platformDocIds?.length) {
      const docs = await prisma.fileItem.findMany({
        where: { projectId: ctx.projectId, deletedAt: null, id: { in: body.platformDocIds } },
        select: { name: true },
      });
      docNames.push(...docs.map((d) => d.name));
    }
    if (body.docPaths?.length) docNames.push(...body.docPaths);

    if (!docNames.length) {
      return okResponse({ text: "请先选择文档后再生成提示词（未选文档时使用默认提示词）" });
    }

    const agent = await prisma.projectAgent.findFirst({
      where: { id: agentId, projectId: ctx.projectId, deletedAt: null },
      select: { modelId: true },
    });
    const model = await resolveRuntime(agent?.modelId);

    const prompt = `基于以下文档，生成一条精简的测试需求提示词（≤500 字符，中文，聚焦测试目标/范围/关注点，不罗列文档原文）：\n${docNames.join("\n")}`;

    const text = await callChat(model, [{ role: "user", content: prompt }], { maxTokens: 1024 });

    return okResponse({ text: text.slice(0, 1000) });
  } catch (err) {
    return toResponse(err);
  }
});

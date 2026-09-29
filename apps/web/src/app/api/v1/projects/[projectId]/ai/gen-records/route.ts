import { NextResponse } from "next/server";
import { ok } from "@rabbit/shared";
import { withProjectScope, toResponse } from "@/server/guard";
import { prisma } from "@rabbit/db";

export const runtime = "nodejs";

/** AI 生成留痕（只读；AI-002/003 审计回溯）。 */
export const GET = withProjectScope(async (ctx) => {
  try {
    ctx.requirePerm("PROJECT_AI:READ");
    const rows = await prisma.aiGenRecord.findMany({
      where: { projectId: ctx.projectId },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        modelId: true,
        scene: true,
        generatedCount: true,
        importedCount: true,
        createdAt: true,
      },
    });
    return NextResponse.json(
      ok({
        total: rows.length,
        list: rows.map((r) => ({
          id: r.id,
          modelId: r.modelId,
          scene: r.scene,
          generatedCount: r.generatedCount,
          importedCount: r.importedCount,
          createdAt: r.createdAt.toISOString(),
        })),
      }),
    );
  } catch (err) {
    return toResponse(err);
  }
});

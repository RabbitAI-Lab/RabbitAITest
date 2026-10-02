/** AGENT-001 PR-2：A2A Agent Card（发现面；enabled && a2aEnabled 才 200，否则 404 防枚举）。 */
import { NextResponse } from "next/server";
import { buildAgentCard } from "@/server/domains/agent/a2a.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Seg = { params: Promise<{ projectId: string; agentId: string }> };

export async function GET(req: Request, ...args: unknown[]) {
  const { projectId, agentId } = await (args[0] as Seg).params;
  const origin = new URL(req.url).origin;
  const card = await buildAgentCard(projectId, agentId, origin);
  if (!card) {
    return NextResponse.json(
      { code: 70604, message: "Agent 不存在或 A2A 未开启", data: null },
      { status: 404 },
    );
  }
  return NextResponse.json(card);
}

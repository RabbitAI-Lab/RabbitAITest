/** AGENT-001 PR-2：A2A JSON-RPC 端点（密钥鉴权 + JSON-RPC 2.0 分发 + SSE 流式）。 */
import { NextResponse } from "next/server";
import {
  authenticateA2aKey,
  checkA2aRateLimit,
  handleA2aRpc,
  type A2aRpcRequest,
} from "@/server/domains/agent/a2a.service";
import { logFor } from "@rabbit/shared/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Seg = { params: Promise<{ projectId: string; agentId: string }> };

export async function POST(req: Request, ...args: unknown[]) {
  const { projectId, agentId } = await (args[0] as Seg).params;
  const origin = new URL(req.url).origin;
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;

  const auth = await authenticateA2aKey(projectId, agentId, bearer);
  if (!auth) {
    return NextResponse.json(
      { jsonrpc: "2.0", id: null, error: { code: -32000, message: "Invalid or revoked API key" } },
      { status: 401 },
    );
  }

  const allowed = await checkA2aRateLimit(auth.keyPrefix);
  if (!allowed) {
    return NextResponse.json(
      { jsonrpc: "2.0", id: null, error: { code: -32000, message: "Rate limit exceeded (10 QPS)" } },
      { status: 429 },
    );
  }

  let body: A2aRpcRequest;
  try {
    body = (await req.json()) as A2aRpcRequest;
  } catch {
    return NextResponse.json(
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } },
      { status: 400 },
    );
  }

  const a2aVersion = req.headers.get("a2a-version") ?? undefined;
  (body as unknown as { __a2aVersion?: string }).__a2aVersion = a2aVersion ?? undefined;

  const result = await handleA2aRpc(projectId, agentId, auth, body, origin);

  if ("sse" in result && result.sse) {
    return new NextResponse(result.stream, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
      },
    }) as unknown as NextResponse;
  }

  logFor("a2a").info({ agentId, method: body.method }, "a2a rpc");
  return NextResponse.json(result);
}

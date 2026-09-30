import { NextResponse } from "next/server";
import { logFor } from "@rabbit/shared/logger";
import { parseScope } from "@rabbit/shared";
import { rateLimit } from "@/server/rate-limit";
import { issueDeviceCode } from "@/server/domains/api/oauth.service";

export const runtime = "nodejs";

/**
 * SYS-009：Device Flow 发码（RFC 8628 §3.1）——**RFC 原生 JSON，不走平台信封**（api-conventions 例外登记）。
 * form-encoded（脚手架 cmd_auth.go 契约）：client_id + scope（可选，空=read）。
 */
export async function POST(req: Request) {
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
    const rl = await rateLimit("oauth-code", ip ?? "local", 10, 60);
    if (!rl.allowed) {
      return NextResponse.json({ error: "slow_down" }, { status: 429 });
    }
    const form = new URLSearchParams(await req.text());
    const clientId = form.get("client_id") ?? "";
    const scopeRaw = form.get("scope") ?? "";
    const scopes = parseScope(scopeRaw);
    if (!scopes) {
      return NextResponse.json({ error: "invalid_scope" }, { status: 400 });
    }
    const issued = await issueDeviceCode({
      clientId,
      scope: scopes.join(","),
      deviceName: form.get("device_name") || null,
      ip,
      userAgent: req.headers.get("user-agent"),
      origin: new URL(req.url).origin,
    });
    return NextResponse.json(issued);
  } catch (err) {
    logFor("http").error({ err }, "oauth device/code failed");
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
}

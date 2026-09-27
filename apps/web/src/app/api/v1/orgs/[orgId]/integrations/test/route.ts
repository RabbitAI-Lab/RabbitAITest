import { toResponse, okResponse, withOrgScope } from "@/server/guard";
import * as svc from "@/server/domains/api/integration.service";

export const runtime = "nodejs";

/** INTG-001/002：测试连接（经 runner 平台插件；成功回填账号展示名，失败 70011/70014）。 */
export const POST = withOrgScope(async (ctx, req) => {
  try {
    ctx.requirePerm("ORG_INTEGRATION:UPDATE");
    const { platform } = (await req.json()) as { platform: string };
    const account = await svc.testConnection(ctx.orgId, platform);
    return okResponse(account);
  } catch (err) {
    return toResponse(err);
  }
});

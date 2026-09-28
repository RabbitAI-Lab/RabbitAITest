import { NextResponse } from "next/server";
import { ok } from "@rabbit/shared";
import { withAuth, toResponse } from "@/server/guard";
import { prisma } from "@rabbit/db";

export const runtime = "nodejs";

/** S-future PLUG-003：已启用协议插件名单（会话级——协议选择器数据源）。
 * 管理端点 system/plugins 需 SYSTEM_PLUGIN:READ，普通项目成员不可见会导致协议选项缺失
 * （协议名/版本非敏感、用例编辑必需）；只读、仅 enabled 的 kind=protocol 行。 */
export const GET = withAuth(async () => {
  try {
    const rows = await prisma.plugin.findMany({
      where: { kind: "protocol", enabled: true },
      select: { name: true, version: true, description: true },
      orderBy: { name: "asc" },
    });
    return NextResponse.json(ok({ items: rows }));
  } catch (err) {
    return toResponse(err);
  }
});

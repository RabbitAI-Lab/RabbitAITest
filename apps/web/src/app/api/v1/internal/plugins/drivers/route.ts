import { NextResponse } from "next/server";
import { ok } from "@rabbit/shared";
import { prisma } from "@rabbit/db";
import { withInternalToken, toResponse } from "@/server/guard";
import { pluginDir } from "@/server/domains/api/plugin.service";

export const runtime = "nodejs";

interface DriverInfo {
  driver: string;
  name: string;
  version: string;
  dir: string;
  entry: string;
}

/**
 * PLUG-004：engine 消费的驱动插件清单（30s 轮询；internal token 鉴权）——
 * 与 protocols 端点同模式（协议注册表 PLUG-002 §4）。driver 标识=插件名。
 */
export const GET = withInternalToken(async () => {
  try {
    const rows = await prisma.plugin.findMany({
      where: { kind: "driver", enabled: true },
      select: { name: true, version: true },
    });
    const plugins: DriverInfo[] = rows.map((r) => ({
      driver: r.name,
      name: r.name,
      version: r.version,
      dir: `${pluginDir}/${r.name}/${r.version}`,
      entry: "index.js",
    }));
    return NextResponse.json(ok(plugins));
  } catch (err) {
    return toResponse(err);
  }
});

import { NextResponse } from "next/server";
import { ok } from "@rabbit/shared";
import { prisma } from "@rabbit/db";
import { withInternalToken, toResponse } from "@/server/guard";
import { pluginDir } from "@/server/domains/api/plugin.service";

export const runtime = "nodejs";

interface ProtocolInfo {
  protocol: string;
  name: string;
  version: string;
  dir: string;
  entry: string;
}

/**
 * PLUG-002：engine 消费的协议插件清单（30s 轮询；internal token 鉴权）。
 * 返回启用的协议插件（含解包目录绝对路径，engine dynamic import 用）。
 */
export const GET = withInternalToken(async () => {
  try {
    const rows = await prisma.plugin.findMany({
      where: { kind: "protocol", enabled: true },
      select: { name: true, version: true },
    });
    const plugins: ProtocolInfo[] = rows.map((r) => ({
      protocol: r.name, // 协议标识=插件名（tcp-conn → tcp 由引擎侧映射：去掉 -conn 后缀约定见 PLUG-002）
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

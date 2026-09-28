import { NextResponse } from "next/server";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@rabbit/db";
import { redis } from "@/server/redis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** readiness：db + redis + 存储可写 + 默认池心跳（INFRA-002-T1 → INFRA-004 增强；rules/observability.md §5）。 */
export async function GET() {
  const checks: Record<string, boolean> = {};
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.db = true;
  } catch {
    checks.db = false;
  }
  try {
    const pong = await redis().ping();
    checks.redis = pong === "PONG";
  } catch {
    checks.redis = false;
  }
  // 存储探针：附件根目录可建（本地磁盘驱动口径；MinIO 驱动接入后替换为桶级 head）
  try {
    const root = process.env.ATTACHMENT_DIR ?? path.join(process.cwd(), "data", "attachments");
    await mkdir(root, { recursive: true });
    checks.storage = true;
  } catch {
    checks.storage = false;
  }
  // 默认资源池心跳：engine 10s/拍，3 拍（30s）内有心跳视为就绪；NO_ENGINE=1（无引擎部署）跳过不阻塞
  const skipped: string[] = [];
  if (process.env.NO_ENGINE === "1") {
    skipped.push("pool");
  } else {
    try {
      const pool = await prisma.resourcePool.findFirst({
        where: { isDefault: true },
        select: { lastBeatAt: true },
      });
      checks.pool = Boolean(pool?.lastBeatAt && Date.now() - pool.lastBeatAt.getTime() < 30_000);
    } catch {
      checks.pool = false;
    }
  }
  const ready = Object.values(checks).every(Boolean);
  return NextResponse.json(
    { code: 0, message: "ok", data: { ready, checks, skipped } },
    { status: ready ? 200 : 503 },
  );
}

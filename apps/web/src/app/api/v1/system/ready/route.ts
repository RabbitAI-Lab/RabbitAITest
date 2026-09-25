import { NextResponse } from 'next/server';
import { prisma } from '@rabbit/db';
import { redis } from '@/server/redis';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** readiness：db + redis（INFRA-002-T1；部署与 CI 启动等待以此为准）。 */
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
    checks.redis = pong === 'PONG';
  } catch {
    checks.redis = false;
  }
  const ready = Object.values(checks).every(Boolean);
  return NextResponse.json(
    { code: 0, message: 'ok', data: { ready, checks } },
    { status: ready ? 200 : 503 },
  );
}

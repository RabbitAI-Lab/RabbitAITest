/** S-future RPT-004 §2：跨报告统计——趋势（连续日期补零）/类型分布/失败 TOP5。
 * 独立文件（不并入 exec.service：避免测试导入拉起 redis/队列副作用）；
 * 窗口 ≤30 天报告量级 << 1 万（QA-001 口径），一次窗口查询后内存聚合；
 * 日界=服务器本地时区（Intl 格式化，不手算跨时区）；passRate=Σpassed/Σtotal（分母 0 → null）。 */
import { prisma } from "@rabbit/db";

/** 与 exec.service parseSummary 同形（summary 为落库 JSON 字符串） */
function parseSummary(
  raw: string | null | undefined,
):
  | { total?: number; passed?: number; failed?: number; fakeError?: number; durationMs?: number }
  | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as {
      total?: number;
      passed?: number;
      failed?: number;
      fakeError?: number;
      durationMs?: number;
    };
  } catch {
    return undefined;
  }
}

export async function reportStats(projectId: string, days: 7 | 14 | 30) {
  const toDateKey = (d: Date) => d.toLocaleDateString("sv-SE"); // YYYY-MM-DD（服务器本地时区）
  const today = new Date();
  const from = new Date(today);
  from.setDate(from.getDate() - (days - 1));
  from.setHours(0, 0, 0, 0);
  const rows = await prisma.report.findMany({
    where: { projectId, createdAt: { gte: from } },
    select: { summary: true, reportType: true, createdAt: true, name: true, taskId: true },
    orderBy: { createdAt: "asc" },
  });
  const dayKeys: string[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(from);
    d.setDate(d.getDate() + i);
    dayKeys.push(toDateKey(d));
  }
  interface Acc {
    total: number;
    passed: number;
    failed: number;
    fakeError: number;
  }
  const trend = new Map<string, Acc>(
    dayKeys.map((k) => [k, { total: 0, passed: 0, failed: 0, fakeError: 0 }]),
  );
  const byType = new Map<string, Acc>();
  const failedList: Array<{
    taskId: string;
    name: string;
    reportType: string;
    failed: number;
    durationMs: number | null;
  }> = [];
  for (const r of rows) {
    const s = parseSummary(r.summary) ?? {};
    const key = toDateKey(r.createdAt);
    const day = trend.get(key); // 窗口外（时区边界防御）直接跳过
    let t = byType.get(r.reportType);
    if (!t) {
      t = { total: 0, passed: 0, failed: 0, fakeError: 0 };
      byType.set(r.reportType, t);
    }
    for (const acc of day ? [day, t] : [t]) {
      acc.total += s.total ?? 0;
      acc.passed += s.passed ?? 0;
      acc.failed += s.failed ?? 0;
      acc.fakeError += s.fakeError ?? 0;
    }
    failedList.push({
      taskId: r.taskId,
      name: r.name,
      reportType: r.reportType,
      failed: s.failed ?? 0,
      durationMs: s.durationMs ?? null,
    });
  }
  const rate = (a: Acc) => (a.total > 0 ? a.passed / a.total : null);
  return {
    range: { from: dayKeys[0]!, to: dayKeys[dayKeys.length - 1]!, days },
    trend: dayKeys.map((k) => ({ date: k, ...trend.get(k)!, passRate: rate(trend.get(k)!) })),
    byType: [...byType.entries()].map(([reportType, acc]) => ({
      reportType,
      total: acc.total,
      passed: acc.passed,
      failed: acc.failed,
      passRate: rate(acc),
    })),
    topFailed: failedList
      .sort((a, b) => b.failed - a.failed || (b.durationMs ?? 0) - (a.durationMs ?? 0))
      .slice(0, 5)
      .filter((f) => f.failed > 0),
  };
}

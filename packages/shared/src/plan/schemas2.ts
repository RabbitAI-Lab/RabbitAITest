/** S4 计划域契约：测试点（PLAN-002）/ 计划分组（PLAN-004）/ 报告导出（PLAN-005）/ 执行入参（PLAN-003）。 */
import { z } from "zod";

// ── 测试点（PLAN-002）──

/** 点执行配置四项（undefined=不覆盖，沿继承链回退；PLAN-003 消费） */
export const pointConfigSchema = z.object({
  envId: z.string().uuid().nullable().optional(),
  poolId: z.string().uuid().nullable().optional(),
  serial: z.boolean().optional(),
  stopOnFail: z.boolean().optional(),
});
export type PointConfig = z.infer<typeof pointConfigSchema>;

export const pointUpsertSchema = z.object({
  name: z.string().min(1).max(256),
  parentId: z.string().uuid().nullable().optional(),
  order: z.number().int().min(0).optional(),
  inheritConfig: z.boolean().optional(),
  config: pointConfigSchema.optional(),
});
export type PointUpsert = z.infer<typeof pointUpsertSchema>;

export const pointsReorderSchema = z.object({
  orderedIds: z.array(z.string().uuid()).min(1).max(500),
});

/** 配置继承链（PLAN-002 §2）：inheritConfig=true → 沿 parent 链取最近显式配置；链尾回退计划默认。
 * 环防御：祖先链去重 + 深度上限 20。 */
export function resolvePointChain(
  points: { id: string; parentId: string | null; inheritConfig: boolean; config: PointConfig | null }[],
  planDefault: PointConfig,
): Map<string, PointConfig> {
  const byId = new Map(points.map((p) => [p.id, p]));
  const resolved = new Map<string, PointConfig>();
  const resolveOne = (pointId: string): PointConfig => {
    const cached = resolved.get(pointId);
    if (cached) return cached;
    const p = byId.get(pointId);
    if (!p) return planDefault;
    let result: PointConfig;
    if (!p.inheritConfig && p.config && Object.keys(p.config).length > 0) {
      result = p.config;
    } else if (p.parentId && p.parentId !== pointId) {
      // 环防御：已访问集合 + 深度上限
      const seen = new Set<string>([pointId]);
      let cur = p;
      let depth = 0;
      let found: PointConfig | null = null;
      while (cur.parentId && depth < 20) {
        const parent = byId.get(cur.parentId);
        if (!parent || seen.has(parent.id)) break;
        seen.add(parent.id);
        if (!parent.inheritConfig && parent.config && Object.keys(parent.config).length > 0) {
          found = parent.config;
          break;
        }
        cur = parent;
        depth += 1;
      }
      result = found ?? planDefault;
    } else {
      result = planDefault;
    }
    resolved.set(pointId, result);
    return result;
  };
  for (const p of points) resolveOne(p.id);
  return resolved;
}

// ── 计划关联扩展（PLAN-002：挂点 + 场景关联）──

export const planCasesAddV2Schema = z
  .object({
    caseIds: z.array(z.string().uuid()).max(500).default([]),
    apiCaseIds: z.array(z.string().uuid()).max(200).default([]),
    /** S4：场景关联（refType=scenario，经 scenario 域校验） */
    scenarioIds: z.array(z.string().uuid()).max(200).default([]),
    pointId: z.string().uuid().nullable().optional(),
    execUserId: z.string().uuid().optional(),
  })
  .refine((b) => b.caseIds.length + b.apiCaseIds.length + b.scenarioIds.length > 0, {
    message: "caseIds / apiCaseIds / scenarioIds 至少其一非空",
  });

export const planCaseMoveSchema = z.object({
  refIds: z.array(z.string().uuid()).min(1).max(200),
  /** null=未分组 */
  pointId: z.string().uuid().nullable(),
});

// ── 计划执行（PLAN-003）──

export const planExecuteSchema = z.object({
  /** 限定测试点范围（缺省=全计划） */
  pointId: z.string().uuid().optional(),
  mode: z.enum(["serial", "parallel"]).optional(),
  stopOnFail: z.boolean().optional(),
  envId: z.string().uuid().nullable().optional(),
  poolId: z.string().uuid().nullable().optional(),
});

/** 计划默认执行配置（存 settings.execConfig；PLAN-001 占位激活） */
export const planExecConfigSchema = pointConfigSchema;
export type PlanExecConfig = PointConfig;

// ── 计划分组（PLAN-004）──

export const planGroupUpsertSchema = z.object({
  name: z.string().min(1).max(256),
  description: z.string().max(2000).optional(),
});

export const planMoveGroupSchema = z.object({
  /** null=移出分组 */
  groupId: z.string().uuid().nullable(),
});

export const plansBatchArchiveSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(100),
  archived: z.boolean(),
});

/** 组聚合（PLAN-004 §2）：progress=Σ已执行/Σrefs；passRate=planPassRate 口径；阈值 AND 判定。 */
export function planGroupAggregate(
  members: {
    id: string;
    name: string;
    refs: { status: string }[];
    threshold: number;
  }[],
): {
  memberCount: number;
  totalRefs: number;
  executed: number;
  passRate: number | null;
  thresholdMetCount: number;
} {
  let totalRefs = 0;
  let executed = 0;
  let pass = 0;
  let fail = 0;
  let blocked = 0;
  let thresholdMetCount = 0;
  for (const m of members) {
    totalRefs += m.refs.length;
    for (const r of m.refs) {
      if (r.status === "PASS") pass += 1;
      else if (r.status === "FAIL") fail += 1;
      else if (r.status === "BLOCKED") blocked += 1;
      if (r.status !== "NOT_RUN" && r.status !== "SKIPPED") executed += 1;
    }
    const denom = m.refs.filter((r) => ["PASS", "FAIL", "BLOCKED"].includes(r.status)).length;
    const mPass = m.refs.filter((r) => r.status === "PASS").length;
    if (denom > 0 && mPass / denom >= m.threshold / 100) thresholdMetCount += 1;
  }
  const denom = pass + fail + blocked;
  return {
    memberCount: members.length,
    totalRefs,
    executed,
    passRate: denom === 0 ? null : Math.round((pass / denom) * 100),
    thresholdMetCount,
  };
}

// ── 计划报告（PLAN-005）──

export const planReportCsvQuerySchema = z.object({
  format: z.literal("csv").default("csv"),
});

/** 一键总结草稿（PLAN-005 §2：模板统计，不覆盖已保存总结——前端确认后才提交）。 */
export function buildPlanSummaryDraft(input: {
  planName: string;
  total: number;
  executed: number;
  passRate: number | null;
  threshold: number;
  fail: number;
  blocked: number;
  fakeError: number;
  weakestPoint: string | null;
  lastRunAt: string | null;
}): string {
  const met = input.passRate === null ? null : input.passRate >= input.threshold;
  const rate = input.passRate === null ? "暂无（未产生已执行口径）" : `${input.passRate}%`;
  const lines = [
    `「${input.planName}」执行总结：`,
    `共 ${input.total} 条用例，已执行 ${input.executed}，通过率 ${rate}（阈值 ${input.threshold}% ${met === null ? "无数据" : met ? "达标" : "未达标"}）。`,
    `失败 ${input.fail} 条、阻塞 ${input.blocked} 条、误报 ${input.fakeError} 条。`,
  ];
  if (input.weakestPoint) lines.push(`最薄弱测试点：${input.weakestPoint}，建议优先回归。`);
  if (input.lastRunAt) lines.push(`最近执行：${input.lastRunAt}。`);
  return lines.join("");
}

/** CSV 单元格转义（逗号/引号/换行 → 引号包裹+内部引号翻倍；Excel 兼容）。 */
export function csvEscape(cell: string | number | null | undefined): string {
  const s = cell === null || cell === undefined ? "" : String(cell);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** 计划报告 CSV（UTF-8 BOM 由路由层附加）。 */
export function buildPlanReportCsv(
  rows: {
    point: string;
    refType: string;
    name: string;
    executor: string;
    status: string;
    actualResult: string;
    lastRunAt: string;
    reportUrl: string;
  }[],
): string {
  const header = ["测试点", "用例类型", "名称", "执行人", "状态", "实际结果", "最近执行", "执行报告"];
  const body = rows.map((r) =>
    [r.point, r.refType, r.name, r.executor, r.status, r.actualResult, r.lastRunAt, r.reportUrl]
      .map(csvEscape)
      .join(","),
  );
  return [header.join(","), ...body].join("\r\n");
}

// ── 工作台（DASH-002）──

export const dashFollowedQuerySchema = z.object({
  /** 七维度：case | plan | review | api_case | scenario | bug（缺省=全部） */
  kind: z.enum(["case", "plan", "review", "api_case", "scenario", "bug"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const dashCreatedQuerySchema = z.object({
  kind: z
    .enum(["case", "review", "plan", "bug", "api_case", "scenario"])
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

// ── 脑图批量保存（CASE-007）──

export const mindmapNodeName = z.string().min(1).max(256);

export const mindmapSaveSchema = z.object({
  modules: z
    .object({
      /** created：tmpId 由前端生成（非 uuid），服务端建实体后回传 idMap */
      created: z.array(z.object({ tmpId: z.string().min(1).max(64), name: mindmapNodeName, parentId: z.string().uuid().nullable() })).max(200).default([]),
      renamed: z.array(z.object({ id: z.string().uuid(), name: mindmapNodeName })).max(200).default([]),
      deleted: z.array(z.string().uuid()).max(200).default([]),
    })
    .default({ created: [], renamed: [], deleted: [] }),
  cases: z
    .object({
      created: z
        .array(
          z.object({
            tmpId: z.string().min(1).max(64),
            name: mindmapNodeName,
            /** 已存模块 uuid 或本轮新建模块的 tmpId（服务端经 idMap 解析） */
            moduleId: z.string().min(1).max(64).nullable(),
            level: z.enum(["P0", "P1", "P2", "P3"]).default("P1"),
            precondition: z.string().max(2000).default(""),
            steps: z.array(z.object({ desc: z.string().max(2000), expect: z.string().max(2000) })).max(100).default([]),
          }),
        )
        .max(200)
        .default([]),
      updated: z
        .array(
          z.object({
            id: z.string().uuid(),
            version: z.number().int().min(1),
            name: mindmapNodeName,
            level: z.enum(["P0", "P1", "P2", "P3"]).optional(),
            precondition: z.string().max(2000).optional(),
            steps: z.array(z.object({ desc: z.string().max(2000), expect: z.string().max(2000) })).max(100).optional(),
            moduleId: z.string().uuid().nullable().optional(),
          }),
        )
        .max(200)
        .default([]),
      deleted: z.array(z.string().uuid()).max(200).default([]),
    })
    .default({ created: [], updated: [], deleted: [] }),
});
export type MindmapSave = z.infer<typeof mindmapSaveSchema>;

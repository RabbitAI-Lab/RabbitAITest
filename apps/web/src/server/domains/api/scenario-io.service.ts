/** API-009 场景导入导出：Rabbit JSON（ref/flatten 两模式）往返 + jmx 子集映射 + MeterSphere JSON 基础字段。 */
import { DomainError, ErrCode } from "@rabbit/shared";
import { randomUUID } from "node:crypto";
import type { z } from "zod";
import { scenarioExportSchema } from "@rabbit/shared";
import { parseJmx } from "@rabbit/shared/execution";
import { nextNum, prisma } from "@rabbit/db";
import type { ScenarioStepNode } from "@rabbit/shared/execution";

type ExportInput = z.infer<typeof scenarioExportSchema>;

const EXPORT_FORMAT_VERSION = 1;
const IMPORT_MAX_BYTES = 2 * 1024 * 1024;

interface ExportedStep {
  uid: string;
  stepType: string;
  name: string;
  enabled: boolean;
  config: Record<string, unknown>;
  children: ExportedStep[];
}

interface ExportedScenario {
  name: string;
  level: string;
  status: string;
  tags: string[];
  modulePath: string;
  config: Record<string, unknown>;
  steps: ExportedStep[];
}

// ── 导出 ──

export async function exportScenarios(projectId: string, input: ExportInput) {
  const scenarios = await prisma.scenario.findMany({
    where: { id: { in: input.ids }, projectId, deletedAt: null },
    include: {
      steps: { orderBy: { order: "asc" } },
      module: { select: { name: true, parentId: true } },
    },
  });
  if (scenarios.length === 0)
    throw new DomainError(ErrCode.SCENARIO_NOT_FOUND, "场景不存在或已删除");

  const moduleNames = await prisma.moduleNode.findMany({
    where: { projectId, scene: "scenario" },
    select: { id: true, name: true, parentId: true },
  });
  const modulePath = (id: string): string => {
    const parts: string[] = [];
    let cur = moduleNames.find((m) => m.id === id);
    let guard = 0;
    while (cur && guard++ < 10) {
      parts.unshift(cur.name);
      cur = cur.parentId ? moduleNames.find((m) => m.id === cur!.parentId) : undefined;
    }
    return parts.join("/") || "未规划场景";
  };

  const out: ExportedScenario[] = [];
  for (const s of scenarios) {
    const tree = buildTree(s.steps);
    const steps = input.mode === "ref" ? tree : await flattenSteps(projectId, tree, 0);
    out.push({
      name: s.name,
      level: s.level,
      status: s.status,
      tags: (s.tags as string[]) ?? [],
      modulePath: modulePath(s.moduleId),
      config: (s.config ?? {}) as Record<string, unknown>,
      steps,
    });
  }
  return {
    format: "rabbit-scenario",
    formatVersion: EXPORT_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    mode: input.mode,
    scenarios: out,
  };
}

function buildTree(
  rows: {
    id: string;
    parentId: string | null;
    stepType: string;
    refId: string | null;
    name: string;
    enabled: boolean;
    config: unknown;
    order: number;
  }[],
): ScenarioStepNode[] {
  const byParent = new Map<string | null, typeof rows>();
  for (const r of rows) {
    if (!byParent.has(r.parentId)) byParent.set(r.parentId, []);
    byParent.get(r.parentId)!.push(r);
  }
  const build = (parent: string | null): ScenarioStepNode[] =>
    (byParent.get(parent) ?? []).map((r) => ({
      uid: r.id,
      stepType: r.stepType as ScenarioStepNode["stepType"],
      name: r.name,
      enabled: r.enabled,
      config: (r.config as Record<string, unknown>) ?? {},
      children: build(r.id),
    }));
  return build(null);
}

/** flatten：引用步骤递归展开为 custom 快照（含子场景深度≤5）。 */
async function flattenSteps(
  projectId: string,
  steps: ScenarioStepNode[],
  depth: number,
): Promise<ExportedStep[]> {
  if (depth > 5) throw new DomainError(ErrCode.SCENARIO_CIRCULAR_REF, "引用链深度超限（≤5）");
  const out: ExportedStep[] = [];
  for (const n of steps) {
    if (n.stepType === "ref_scenario") {
      const refId = (n.config as { refId?: string }).refId;
      if (refId) {
        const sub = await prisma.scenario.findFirst({
          where: { id: refId, projectId },
          include: { steps: { orderBy: { order: "asc" } } },
        });
        if (sub) {
          out.push({
            ...n,
            children: await flattenSteps(projectId, buildTree(sub.steps), depth + 1),
          });
          continue;
        }
      }
      out.push({ ...n, children: [] });
      continue;
    }
    out.push({
      ...n,
      children: n.children.length ? await flattenSteps(projectId, n.children, depth) : [],
    });
  }
  return out;
}

// ── 导入（预览 + 落库） ──

export interface ImportPreview {
  format: "rabbit-scenario" | "jmx" | "metersphere";
  scenarioCount: number;
  stepCount: number;
  warnings: string[];
  firstSteps: { name: string; stepType: string }[];
}

function detectFormat(
  parsed: unknown,
  filename: string,
): "rabbit-scenario" | "jmx" | "metersphere" {
  if (filename.endsWith(".jmx")) return "jmx";
  const obj = parsed as Record<string, unknown>;
  if (obj?.format === "rabbit-scenario") return "rabbit-scenario";
  if (Array.isArray(obj?.scenarios) || obj?.format === "metersphere") return "metersphere";
  if (obj?.elements || obj?.data) return "metersphere"; // MS v3 导出包特征（宽容探测）
  throw new DomainError(ErrCode.IMPORT_FORMAT_UNKNOWN, "无法识别的导入格式");
}

export function previewImport(filename: string, content: string): ImportPreview {
  if (content.length > IMPORT_MAX_BYTES)
    throw new DomainError(ErrCode.IMPORT_FILE_TOO_LARGE, "导入文件超上限（2MB）");
  if (filename.endsWith(".jmx")) {
    const r = parseJmx(content);
    return {
      format: "jmx",
      scenarioCount: 1,
      stepCount: countSteps(r.steps),
      warnings: r.warnings,
      firstSteps: flattenPreview(r.steps),
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new DomainError(ErrCode.IMPORT_FORMAT_UNKNOWN, "JSON 解析失败");
  }
  const format = detectFormat(parsed, filename);
  const scenarios = (
    format === "rabbit-scenario"
      ? ((parsed as { scenarios?: unknown[] }).scenarios ?? [])
      : msToRabbit(parsed).scenarios
  ) as ExportedScenario[];
  return {
    format,
    scenarioCount: scenarios.length,
    stepCount: scenarios.reduce((s, sc) => s + countSteps(sc.steps), 0),
    warnings: [],
    firstSteps: scenarios[0] ? flattenPreview(scenarios[0].steps) : [],
  };
}

/** MeterSphere v3 导出 JSON → Rabbit 结构（基础字段映射，API-009 §1.4 简化口径）。 */
function msToRabbit(parsed: unknown): { scenarios: ExportedScenario[] } {
  const obj = (parsed ?? {}) as { scenarios?: unknown[]; elements?: unknown[]; data?: unknown[] };
  const rawList = (obj.scenarios ?? obj.elements ?? obj.data ?? []) as Record<string, unknown>[];
  return {
    scenarios: rawList.map((raw) => {
      const steps = Array.isArray(raw.steps) ? (raw.steps as Record<string, unknown>[]) : [];
      return {
        name: String(raw.name ?? "MeterSphere 导入场景"),
        level: "P2",
        status: "UNDERWAY",
        tags: [],
        modulePath: "未规划场景",
        config: {
          params: {
            constants: [],
            lists: [],
            csv: { source: "inline", delimiter: ",", hasHeader: true },
          },
          prePost: { pre: [], post: [] },
          asserts: [],
          settings: { cookieMode: "off", thinkTimeMs: 0, onFailure: "abort" },
        },
        steps: steps.map((st) => msStep(st)),
      };
    }),
  };
}

function msStep(st: Record<string, unknown>): ExportedStep {
  const stepType = String(st.stepType ?? st.type ?? "custom");
  const mapped: ExportedStep = {
    uid: String(st.id ?? st.uuid ?? `ms-${Math.random().toString(36).slice(2, 8)}`),
    stepType: stepType === "CUSTOM" || stepType === "custom" ? "custom" : stepType.toLowerCase(),
    name: String(st.name ?? st.stepName ?? "步骤"),
    enabled: st.enable !== false,
    config: (st.config as Record<string, unknown>) ?? {},
    children: Array.isArray(st.children)
      ? (st.children as Record<string, unknown>[]).map(msStep)
      : [],
  };
  // MS 字段兼容映射：request → bundle
  if (mapped.stepType === "custom" && st.request && !mapped.config.bundle) {
    const req = st.request as Record<string, unknown>;
    mapped.config = {
      ...mapped.config,
      bundle: {
        request: {
          method: String(req.method ?? "GET").toUpperCase(),
          url: String(req.url ?? req.path ?? "/"),
          headers: [],
          query: [],
          body: req.body
            ? {
                kind: "raw_json",
                content: typeof req.body === "string" ? req.body : JSON.stringify(req.body),
              }
            : { kind: "none" },
          auth: { kind: "none" },
        },
        asserts: [{ kind: "status_code", path: "", op: "eq", expected: "200" }],
        pre: [],
        post: [],
        extracts: [],
      },
    };
  }
  return mapped;
}

function countSteps(steps: { children: unknown[] }[]): number {
  return steps.reduce(
    (s, st) => s + 1 + countSteps((st.children ?? []) as { children: unknown[] }[]),
    0,
  );
}

function flattenPreview(
  steps: { name: string; stepType: string; children: unknown[] }[],
): { name: string; stepType: string }[] {
  const out: { name: string; stepType: string }[] = [];
  const walk = (nodes: { name: string; stepType: string; children: unknown[] }[]) => {
    for (const n of nodes) {
      out.push({ name: n.name, stepType: n.stepType });
      if (out.length > 12) return;
      walk((n.children ?? []) as { name: string; stepType: string; children: unknown[] }[]);
    }
  };
  walk(steps);
  return out.slice(0, 12);
}

export async function importScenarios(
  projectId: string,
  userId: string,
  filename: string,
  content: string,
  moduleId?: string,
) {
  const preview = previewImport(filename, content);
  let scenarios: ExportedScenario[];
  if (preview.format === "jmx") {
    const r = parseJmx(content);
    scenarios = [
      {
        name: r.scenarioName,
        level: "P2",
        status: "UNDERWAY",
        tags: ["jmx-import"],
        modulePath: "未规划场景",
        config: {
          params: {
            constants: [],
            lists: [],
            ...(r.csv && r.csv.columns.length > 0
              ? {
                  csv: {
                    source: "inline",
                    inlineText: toCsvText(r.csv.columns, r.csv.rows),
                    delimiter: ",",
                    hasHeader: true,
                  },
                }
              : {}),
          },
          prePost: { pre: [], post: [] },
          asserts: [],
          settings: { cookieMode: "off", thinkTimeMs: 0, onFailure: "abort" },
        },
        steps: r.steps as unknown as ExportedStep[],
      },
    ];
  } else {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    scenarios =
      preview.format === "rabbit-scenario"
        ? ((parsed.scenarios ?? []) as ExportedScenario[])
        : msToRabbit(parsed).scenarios;
  }
  if (scenarios.length === 0)
    throw new DomainError(ErrCode.IMPORT_FORMAT_UNKNOWN, "导入内容不含场景");

  // 目标模块（默认=未规划场景，懒创建）
  let targetModule = moduleId;
  if (!targetModule) {
    const m = await prisma.moduleNode.findFirst({
      where: { projectId, scene: "scenario", isDefault: true },
      select: { id: true },
    });
    targetModule = m?.id;
    if (!targetModule) {
      const created = await prisma.moduleNode.create({
        data: { projectId, scene: "scenario", name: "未规划场景", isDefault: true },
      });
      targetModule = created.id;
    }
  }

  const created: { id: string; num: number; name: string }[] = [];
  const warnings: string[] = [...preview.warnings];
  for (const sc of scenarios) {
    const num = await nextNum(prisma, "scenarios", projectId);
    const row = await prisma.scenario.create({
      data: {
        projectId,
        moduleId: targetModule,
        num,
        name: sc.name.slice(0, 512),
        level: ["P0", "P1", "P2", "P3"].includes(sc.level) ? sc.level : "P2",
        status: ["PREPARE", "UNDERWAY", "COMPLETED"].includes(sc.status) ? sc.status : "UNDERWAY",
        tags: (sc.tags ?? []).slice(0, 10),
        config: sc.config as never,
        createdBy: userId,
      },
      select: { id: true, num: true, name: true },
    });
    await insertSteps(projectId, row.id, sc.steps as unknown as ScenarioStepNode[], warnings);
    created.push(row);
  }
  return { count: created.length, list: created, warnings };
}

function toCsvText(columns: string[], rows: string[][]): string {
  return [columns.join(","), ...rows.map((r) => r.join(","))].join("\n");
}

async function insertSteps(
  projectId: string,
  scenarioId: string,
  steps: ScenarioStepNode[],
  warnings: string[],
): Promise<void> {
  const rows: {
    id: string;
    scenarioId: string;
    parentId: string | null;
    stepType: string;
    refId: string | null;
    name: string;
    config: unknown;
    enabled: boolean;
    order: number;
  }[] = [];
  // 主键一律新生成：导入文件里的 uid 是导出侧标识，直接沿用会与既有行全局主键冲突（P2002）；
  // 树形关联经 parentId=父新 id 重建，文件 uid 不参与落库。
  const walk = (nodes: ScenarioStepNode[], parentId: string | null) => {
    nodes.forEach((n, i) => {
      const id = randomUUID();
      rows.push({
        id,
        scenarioId,
        parentId,
        stepType: n.stepType,
        refId: (n.config as { refId?: string }).refId ?? null,
        name: n.name.slice(0, 256),
        config: n.config,
        enabled: n.enabled,
        order: i,
      });
      walk(n.children, id);
    });
  };
  walk(steps, null);
  // ref 模式引用键导入：refKey（method+path+name）重挂（命中多条取最新，未命中降级 custom）
  for (const r of rows) {
    if (r.stepType.startsWith("ref_")) {
      const cfg = r.config as {
        refKey?: { method?: string; path?: string; name?: string };
        bundle?: unknown;
      };
      if (!cfg?.refKey) continue;
      const api = await prisma.apiDefinition.findFirst({
        where: { projectId, method: cfg.refKey.method, path: cfg.refKey.path, deletedAt: null },
        orderBy: { updatedAt: "desc" },
        select: { id: true, request: true },
      });
      const c = await prisma.apiCase.findFirst({
        where: {
          projectId,
          api: { method: cfg.refKey.method, path: cfg.refKey.path },
          deletedAt: null,
        },
        orderBy: { updatedAt: "desc" },
        select: { id: true, request: true },
      });
      if (c) {
        r.refId = c.id;
        r.config = { ...cfg, bundle: c.request };
      } else if (api) {
        r.refId = api.id;
        r.stepType = "ref_api";
        r.config = { ...cfg, bundle: api.request };
      } else {
        warnings.push(`引用未命中已降级：${cfg.refKey.method} ${cfg.refKey.path}（携带导出快照）`);
        r.stepType = "custom";
      }
    }
  }
  if (rows.length > 0) await prisma.scenarioStep.createMany({ data: rows as never });
}

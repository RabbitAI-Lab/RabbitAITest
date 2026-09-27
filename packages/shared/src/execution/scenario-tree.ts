import { z } from "zod";

/**
 * 场景报告树聚合（RPT-003）：ExecStepResult 帧 → stepPath 树 + 迭代分组。
 * 纯函数（shared 单测主力）；服务端 scenarioTree 聚合与前端树渲染共用本类型。
 */

export const treeStepStatusSchema = z.enum(["SUCCESS", "FAILED", "SKIPPED"]);
export type TreeStepStatus = z.infer<typeof treeStepStatusSchema>;

export const treeNodeSchema: z.ZodType<TreeNode, z.ZodTypeDef, unknown> = z.lazy(() =>
  z.object({
    stepPath: z.string(),
    name: z.string(),
    /** 请求/循环/条件/仅一次/脚本/等待（step-skip reason=condition 的条件节点保留原类型） */
    kind: z.enum(["request", "loop", "condition", "once", "script", "wait"]),
    status: treeStepStatusSchema,
    /** 请求节点：durationMs/statusCode/断言失败数（钻取入口用） */
    durationMs: z.number().int().optional(),
    statusCode: z.number().int().optional(),
    failedAsserts: z.number().int().optional(),
    /** 迭代分组（loop 子级）：iteration → children */
    iterations: z.array(z.object({ iteration: z.number().int(), children: z.array(treeNodeSchema) })).optional(),
    skipReason: z.enum(["disabled", "condition", "once", "abort"]).optional(),
    children: z.array(treeNodeSchema).default([]),
  }),
);
export interface TreeNode {
  stepPath: string;
  name: string;
  kind: "request" | "loop" | "condition" | "once" | "script" | "wait";
  status: "SUCCESS" | "FAILED" | "SKIPPED";
  durationMs?: number;
  statusCode?: number;
  failedAsserts?: number;
  iterations?: { iteration: number; children: TreeNode[] }[];
  skipReason?: "disabled" | "condition" | "once" | "abort";
  children: TreeNode[];
}

export interface ScenarioTreeView {
  itemId: string;
  name: string;
  status: string;
  /** 顶层节点（树根数组） */
  tree: TreeNode[];
  /** 变量终值（vars-final log 帧 payload；无则为 null） */
  varsFinal: Record<string, string> | null;
  stats: { total: number; success: number; failed: number; skipped: number; durationMs: number };
}

/** 帧输入（ExecStepResult.frame 或 SSE 帧；只取聚合所需字段，多余忽略）。 */
export interface TreeFrameInput {
  type: string;
  stepPath?: string;
  stepName?: string;
  iteration?: number;
  name?: string;
  status?: number | string;
  durationMs?: number;
  level?: string;
  kind?: string;
  reason?: string;
  message?: string;
  op?: "script" | "wait";
  asserts?: { passed: boolean }[];
}

/**
 * 帧 → 树。stepPath 为数字点路径（"0"、"0.2"、"0.2.1"）；迭代帧（iteration≥1）
 * 归入父 loop 节点的 iterations 分组；同 path 多次出现（循环）聚合为迭代组。
 */
export function buildScenarioTree(itemId: string, name: string, status: string, frames: TreeFrameInput[]): ScenarioTreeView {
  const root: TreeNode[] = [];
  const nodeIndex = new Map<string, TreeNode>();
  /** 帧直接命中的 path（用于剥离 engine 根前缀产生的「无帧包装层」，如 "0"） */
  const directPaths = new Set<string>();
  let varsFinal: Record<string, string> | null = null;
  let stats = { total: 0, success: 0, failed: 0, skipped: 0, durationMs: 0 };

  const ensureNode = (path: string, fallbackName: string): TreeNode => {
    const existing = nodeIndex.get(path);
    if (existing) return existing;
    const segments = path.split(".");
    const parentPath = segments.slice(0, -1).join(".");
    const node: TreeNode = { stepPath: path, name: fallbackName, kind: "request", status: "SUCCESS", children: [] };
    nodeIndex.set(path, node);
    if (!parentPath) {
      root.push(node);
    } else {
      const parent = ensureNode(parentPath, `步骤 ${segments[segments.length - 2]}`);
      // 父为循环容器：迭代帧进 iterations 分组，非迭代帧进 children
      parent.children.push(node);
    }
    return node;
  };

  for (const frame of frames) {
    if (frame.type === "log" && frame.kind === "vars-final") {
      try {
        varsFinal = JSON.parse(frame.message ?? "{}") as Record<string, string>;
      } catch {
        varsFinal = null;
      }
      continue;
    }
    // v4：控制器命名帧（loop/condition/once 节点名——S3 遗留「报告树 fallback 名」修复；早于子帧到达即建名）
    if (frame.type === "log" && frame.kind === "node-name" && frame.stepPath) {
      const node = ensureNode(frame.stepPath, frame.message || `步骤 ${frame.stepPath}`);
      if (node.name.startsWith("步骤 ")) node.name = frame.message || node.name;
      continue;
    }
    if (!frame.stepPath) continue;
    directPaths.add(frame.stepPath);
    if (frame.type === "step-skip") {
      const node = ensureNode(frame.stepPath, frame.stepName || frame.name || "步骤");
      node.status = "SKIPPED";
      node.skipReason =
        frame.reason === "disabled" || frame.reason === "condition" || frame.reason === "once" || frame.reason === "abort"
          ? frame.reason
          : undefined;
      node.kind = frame.reason === "once" ? "once" : frame.reason === "condition" ? "condition" : "request";
      stats.skipped++;
      continue;
    }
    if (frame.type === "step-op") {
      const node = ensureNode(frame.stepPath, frame.stepName || `步骤 ${frame.stepPath}`);
      node.kind = frame.op === "wait" ? "wait" : "script";
      node.status = frame.status === "FAILED" ? "FAILED" : "SUCCESS";
      node.durationMs = frame.durationMs;
      if (node.status === "FAILED") {
        stats.failed++;
        stats.total++;
      } else {
        stats.success++;
        stats.total++;
      }
      continue;
    }
    if (frame.type === "step-result") {
      const node = ensureNode(frame.stepPath, frame.stepName || `步骤 ${frame.stepPath}`);
      const httpStatus = typeof frame.status === "number" ? frame.status : 0;
      const ok = httpStatus >= 200 && httpStatus < 400 && !(frame.asserts ?? []).some((a) => !a.passed);
      node.status = ok ? "SUCCESS" : "FAILED";
      node.statusCode = httpStatus;
      node.durationMs = frame.durationMs;
      node.failedAsserts = (frame.asserts ?? []).filter((a) => !a.passed).length;
      stats.total++;
      if (ok) stats.success++;
      else stats.failed++;
      stats.durationMs += frame.durationMs ?? 0;
      // 迭代归属：iteration ≥1 时把该节点从父 children 挪到父 iterations 分组
      if (frame.iteration !== undefined && frame.iteration >= 1) {
        const segments = frame.stepPath.split(".");
        const parentPath = segments.slice(0, -1).join(".");
        const parent = parentPath ? nodeIndex.get(parentPath) : undefined;
        if (parent) {
          parent.kind = "loop";
          if (!parent.iterations) parent.iterations = [];
          let group = parent.iterations.find((g) => g.iteration === frame.iteration);
          if (!group) {
            group = { iteration: frame.iteration, children: [] };
            parent.iterations.push(group);
          }
          const idx = parent.children.indexOf(node);
          if (idx >= 0) parent.children.splice(idx, 1);
          if (!group.children.includes(node)) group.children.push(node);
          parent.iterations.sort((a, b) => a.iteration - b.iteration);
        }
      }
    }
  }
  let tree = root;
  // 剥离 engine 根前缀（walkNodes 传 "0"）产生的纯包装层：根层单节点、无帧直接命中、
  // 且从未被帧数据充实（无状态码/耗时/迭代分组——纯父容器）→ 提升其 children。
  // 注：同 path 多次出现的「迭代组聚合」形态（iterations 挂包装层）不算纯包装，保留。
  const isPureWrapper = (n: TreeNode) =>
    !directPaths.has(n.stepPath) && n.kind === "request" && n.statusCode === undefined && n.durationMs === undefined && !n.iterations;
  while (tree.length === 1 && isPureWrapper(tree[0]!)) {
    tree = tree[0]!.children;
  }
  return { itemId, name, status, tree, varsFinal, stats };
}

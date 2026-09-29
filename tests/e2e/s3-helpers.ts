import type { APIRequestContext, Page } from "@playwright/test";
import { ok } from "./s2-helpers";

/** S3 场景域 e2e 造数（API-006~010；步骤树/参数/误报/定时/报告树）。 */

export interface StepNodeLike {
  uid: string;
  stepType:
    | "ref_api"
    | "ref_case"
    | "ref_scenario"
    | "custom"
    | "loop"
    | "condition"
    | "once"
    | "script"
    | "wait";
  name: string;
  enabled: boolean;
  config: Record<string, unknown>;
  children: StepNodeLike[];
}

let uidSeq = 0;
export const stepUid = () => `e2e-step-${Date.now() % 1e7}-${uidSeq++}`;

/** custom 请求步骤（GET url + 可选断言）。 */
export function customStep(
  name: string,
  url: string,
  asserts: { kind: string; path: string; op: string; expected: string }[] = [],
): StepNodeLike {
  return {
    uid: stepUid(),
    stepType: "custom",
    name,
    enabled: true,
    config: {
      bundle: {
        request: {
          method: "GET",
          url,
          headers: [],
          query: [],
          body: { kind: "none" },
          auth: { kind: "none" },
        },
        asserts,
        pre: [],
        post: [],
        extracts: [],
      },
    },
    children: [],
  };
}

export function loopForeachStep(name: string, listName: string, child: StepNodeLike): StepNodeLike {
  return {
    uid: stepUid(),
    stepType: "loop",
    name,
    enabled: true,
    config: { mode: "foreach", var: "item", source: listName, iterations: [] },
    children: [child],
  };
}

export function scriptStep(name: string, script: string): StepNodeLike {
  return {
    uid: stepUid(),
    stepType: "script",
    name,
    enabled: true,
    config: { script },
    children: [],
  };
}

export function waitStep(name: string, ms = 5): StepNodeLike {
  return { uid: stepUid(), stepType: "wait", name, enabled: true, config: { ms }, children: [] };
}

export function conditionStep(
  name: string,
  expression: string,
  children: StepNodeLike[],
): StepNodeLike {
  return {
    uid: stepUid(),
    stepType: "condition",
    name,
    enabled: true,
    config: { expression },
    children,
  };
}

export interface ScenarioConfigLike {
  params?: {
    constants?: { name: string; value: string; description?: string }[];
    lists?: { name: string; values: string[] }[];
    csv?: {
      source: "inline" | "file";
      inlineText?: string;
      delimiter?: "," | ";" | "\t";
      hasHeader?: boolean;
      fileId?: string;
    };
  };
  prePost?: { pre: unknown[]; post: unknown[] };
  asserts?: unknown[];
  settings?: {
    cookieMode?: "off" | "keep";
    thinkTimeMs?: number;
    onFailure?: "continue" | "abort";
  };
}

export async function defaultScenarioModuleId(
  request: APIRequestContext,
  projectId: string,
): Promise<string> {
  const res = await request.get(`/api/v1/projects/${projectId}/modules?scene=scenario`);
  const data = await ok<{ items: { id: string }[] }>(res);
  return data.items[0]!.id;
}

export async function createScenario(
  request: APIRequestContext,
  projectId: string,
  body: { name: string; moduleId?: string; level?: string; config?: ScenarioConfigLike },
): Promise<{ id: string; num: number }> {
  const moduleId = body.moduleId ?? (await defaultScenarioModuleId(request, projectId));
  const res = await request.post(`/api/v1/projects/${projectId}/scenarios`, {
    data: {
      name: body.name,
      moduleId,
      ...(body.level ? { level: body.level } : {}),
      ...(body.config ? { config: body.config } : {}),
    },
  });
  return ok<{ id: string; num: number }>(res, 201);
}

export async function saveSteps(
  request: APIRequestContext,
  projectId: string,
  id: string,
  steps: StepNodeLike[],
): Promise<number> {
  const detail = await request.get(`/api/v1/projects/${projectId}/scenarios/${id}`);
  const d = await ok<{ version: number }>(detail);
  const res = await request.put(`/api/v1/projects/${projectId}/scenarios/${id}/steps`, {
    data: { version: d.version, steps },
  });
  const data = await ok<{ version: number }>(res);
  return data.version;
}

export async function executeScenario(
  request: APIRequestContext,
  projectId: string,
  id: string,
  body: { envId?: string } = {},
): Promise<string> {
  const res = await request.post(`/api/v1/projects/${projectId}/scenarios/${id}/execute`, {
    data: body,
  });
  const data = await ok<{ taskId: string }>(res, 201);
  return data.taskId;
}

export interface ScenarioTreeResult {
  itemId: string;
  tree: { name: string; kind: string; status: string; iterations?: { iteration: number }[] }[];
  varsFinal: Record<string, string> | null;
  stats: { total: number; success: number; failed: number };
}

export async function scenarioTree(
  request: APIRequestContext,
  projectId: string,
  taskId: string,
): Promise<ScenarioTreeResult> {
  const rep = await request.get(`/api/v1/projects/${projectId}/reports/${taskId}`);
  const detail = await ok<{ items: { itemId: string }[] }>(rep);
  const itemId = detail.items[0]!.itemId;
  const res = await request.get(
    `/api/v1/projects/${projectId}/reports/${taskId}/items/${itemId}/scenario-tree`,
  );
  return ok<ScenarioTreeResult>(res);
}

/** antd 树/下拉外的通用点击重试（antd 重渲染重建浮层的 CI 慢机问题，S1 教训）。 */
export async function clickRetry(
  page: Page,
  locator: { click(options?: { timeout?: number }): Promise<unknown> },
  times = 3,
): Promise<void> {
  let lastErr: unknown = null;
  for (let i = 0; i < times; i++) {
    try {
      await locator.click({ timeout: 4000 });
      return;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("clickRetry failed");
}

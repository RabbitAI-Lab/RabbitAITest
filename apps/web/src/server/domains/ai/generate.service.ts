/** AI-002/003 生成：prompt 组装 → ChatClient → JSON 容错解析 → 草稿弱校验 → AiGenRecord 留痕（不落库用例）。 */
import { DomainError, ErrCode } from "@rabbit/shared";
import type { z } from "zod";
import {
  AI_GEN_BATCH_MAX_APIS,
  AI_GEN_MAX_CASES,
  AI_SPEC_SUMMARY_MAX_BYTES,
  API_CASE_GEN_SYSTEM_PROMPT,
  BUILTIN_API_GEN_TEMPLATE,
  BUILTIN_CASE_GEN_TEMPLATE,
  CASE_GEN_SYSTEM_PROMPT,
  aiApiCaseDraftSchema,
  aiCaseDraftSchema,
  extractJsonArray,
  renderTemplate,
  type AiGenerateCasesInput,
} from "@rabbit/shared";
import { prisma } from "@rabbit/db";
import { callChat } from "./chat-client";
import { resolveRuntimeForUser } from "./model.service";
import { resolveTemplate } from "./prompt.service";
import { parseOpenApi3 } from "../api/import.service";

async function recordGen(projectId: string, userId: string, modelId: string, scene: string, generated: number, prompt: string) {
  await prisma.aiGenRecord.create({
    data: {
      projectId,
      userId,
      modelId,
      scene,
      generatedCount: generated,
      importedCount: 0,
      promptSnapshot: { system: prompt.slice(0, 4000), user: "", at: new Date().toISOString() },
    },
  });
}

/** AI-002 功能用例生成 */
export async function generateCases(projectId: string, userId: string, input: AiGenerateCasesInput) {
  const runtime = await resolveRuntimeForUser(userId, input.modelId);
  const tpl = await resolveTemplate(projectId, "case_gen", input.templateId);
  const template = tpl?.template ?? BUILTIN_CASE_GEN_TEMPLATE;
  const designMethod = input.designMethod ?? tpl?.designMethod ?? "";
  const moduleName = await moduleNameOf(projectId, input.moduleId);
  const userPrompt = renderTemplate(template, {
    requirement: input.requirement,
    module: moduleName,
    design_method: designMethod,
  });
  const text = await callChat(
    runtime,
    [
      { role: "system", content: CASE_GEN_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    { maxTokens: 4096 },
  );
  const arr = extractJsonArray(text);
  if (!arr) throw new DomainError(ErrCode.AI_RESPONSE_UNPARSEABLE, "AI 生成结果无法解析为 JSON 数组");
  const drafts: z.infer<typeof aiCaseDraftSchema>[] = [];
  const skipped: { index: number; reason: string }[] = [];
  arr.slice(0, AI_GEN_MAX_CASES).forEach((item, index) => {
    const parsed = aiCaseDraftSchema.safeParse(item);
    if (parsed.success) drafts.push(parsed.data);
    else skipped.push({ index, reason: parsed.error.issues[0]?.message ?? "结构不符" });
  });
  await recordGen(projectId, userId, runtime.id, "case_gen", drafts.length, `${CASE_GEN_SYSTEM_PROMPT}\n---\n${userPrompt}`);
  return { drafts, skipped };
}

/** AI-003 单条接口用例生成（按 ApiDefinition 摘要） */
export async function generateApiCase(
  projectId: string,
  userId: string,
  input: { apiId: string; templateId?: string; modelId?: string; designMethod?: string },
) {
  const api = await prisma.apiDefinition.findFirst({ where: { id: input.apiId, projectId, deletedAt: null } });
  if (!api) throw new DomainError(ErrCode.API_NOT_FOUND, "接口定义不存在或已删除");
  const runtime = await resolveRuntimeForUser(userId, input.modelId);
  const tpl = await resolveTemplate(projectId, "api_gen", input.templateId);
  const template = tpl?.template ?? BUILTIN_API_GEN_TEMPLATE;
  const designMethod = input.designMethod ?? tpl?.designMethod ?? "";
  const spec = renderTemplate(template, { api_spec: apiSpecSummary(api), design_method: designMethod });
  const text = await callChat(
    runtime,
    [
      { role: "system", content: API_CASE_GEN_SYSTEM_PROMPT },
      { role: "user", content: spec },
    ],
    { maxTokens: 2048 },
  );
  const arr = extractJsonArray(text);
  if (!arr || arr.length === 0) throw new DomainError(ErrCode.AI_RESPONSE_UNPARSEABLE, "AI 生成结果无法解析为 JSON 数组");
  const drafts: z.infer<typeof aiApiCaseDraftSchema>[] = [];
  const skipped: { index: number; reason: string }[] = [];
  arr.slice(0, 1).forEach((item, index) => {
    const parsed = aiApiCaseDraftSchema.safeParse(item);
    if (parsed.success) {
      const d = parsed.data;
      if (!d.assertions.some((a) => a.source === "status")) {
        d.assertions.unshift({ source: "status", expression: "", operator: "eq", expected: "200" });
      }
      drafts.push(d);
    } else skipped.push({ index, reason: parsed.error.issues[0]?.message ?? "结构不符" });
  });
  await recordGen(projectId, userId, runtime.id, "api_gen", drafts.length, `${API_CASE_GEN_SYSTEM_PROMPT}\n---\n${spec}`);
  return { drafts, skipped };
}

/** AI-003 批量：OpenAPI 文档 → 接口清单（≤20）→ p-limit 3 并发生成 */
export async function generateApiCaseBatch(
  projectId: string,
  userId: string,
  input: { openapiDoc: string; modelId?: string; designMethod?: string },
) {
  let parsed: ReturnType<typeof parseOpenApi3>;
  try {
    parsed = parseOpenApi3(input.openapiDoc);
  } catch {
    throw new DomainError(ErrCode.AI_OPENAPI_INVALID, "OpenAPI 文档解析失败（支持 3.x JSON）");
  }
  const apis = parsed.apis.filter((a) => a.method && a.path);
  if (apis.length === 0) throw new DomainError(ErrCode.AI_OPENAPI_INVALID, "OpenAPI 文档未解析出任何接口");
  if (apis.length > AI_GEN_BATCH_MAX_APIS) {
    throw new DomainError(ErrCode.AI_OPENAPI_INVALID, `单批接口数超上限 ${AI_GEN_BATCH_MAX_APIS}（当前 ${apis.length}，请分批）`);
  }
  const runtime = await resolveRuntimeForUser(userId, input.modelId);
  const tpl = await resolveTemplate(projectId, "api_gen");
  const template = tpl?.template ?? BUILTIN_API_GEN_TEMPLATE;
  const designMethod = input.designMethod ?? tpl?.designMethod ?? "";

  const drafts: { apiIndex: number; method: string; path: string; draft: z.infer<typeof aiApiCaseDraftSchema> }[] = [];
  const skipped: { index: number; reason: string }[] = [];
  // 顺序逐条（并发对供应商限速更稳；每批≤20 规模可控——登记节流简化）
  for (let i = 0; i < apis.length; i++) {
    const a = apis[i]!;
    const spec = renderTemplate(template, {
      api_spec: truncateBytes(`${a.method} ${a.path}${a.name ? `（${a.name}）` : ""}\n${JSON.stringify(a.request ?? {})}`, AI_SPEC_SUMMARY_MAX_BYTES),
      design_method: designMethod,
    });
    try {
      const text = await callChat(
        runtime,
        [
          { role: "system", content: API_CASE_GEN_SYSTEM_PROMPT },
          { role: "user", content: spec },
        ],
        { maxTokens: 1024 },
      );
      const arr = extractJsonArray(text);
      const first = arr?.[0];
      const parsed = first ? aiApiCaseDraftSchema.safeParse(first) : null;
      if (parsed?.success) {
        const d = parsed.data;
        if (!d.assertions.some((x) => x.source === "status")) {
          d.assertions.unshift({ source: "status", expression: "", operator: "eq", expected: "200" });
        }
        drafts.push({ apiIndex: i, method: a.method, path: a.path, draft: d });
      } else {
        skipped.push({ index: i, reason: "生成结果解析失败" });
      }
    } catch (err) {
      skipped.push({ index: i, reason: err instanceof DomainError ? err.message : "调用失败" });
    }
  }
  await recordGen(projectId, userId, runtime.id, "api_gen_batch", drafts.length, `${API_CASE_GEN_SYSTEM_PROMPT}\n---\nbatch:${apis.length} apis`);
  return { apis: apis.map((a, i) => ({ index: i, method: a.method, path: a.path, name: a.name ?? "" })), drafts, skipped };
}

function truncateBytes(s: string, max: number): string {
  return Buffer.byteLength(s, "utf8") > max ? `${s.slice(0, Math.floor(max / 2))}…（截断）` : s;
}

function apiSpecSummary(api: { method: string; path: string; name: string; request: unknown }): string {
  return truncateBytes(`${api.method} ${api.path}（${api.name}）\n${JSON.stringify(api.request ?? {})}`, AI_SPEC_SUMMARY_MAX_BYTES);
}

async function moduleNameOf(projectId: string, moduleId?: string): Promise<string> {
  if (!moduleId) return "未分组";
  const node = await prisma.moduleNode.findFirst({ where: { id: moduleId, projectId, scene: "case" } });
  return node?.name ?? "未分组";
}

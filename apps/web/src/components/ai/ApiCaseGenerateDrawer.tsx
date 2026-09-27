"use client";

import { Button, Checkbox, Drawer, Empty, Input, Select, Skeleton, Tabs, Tag, message } from "antd";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  aiGenerateApiCase,
  aiGenerateApiCaseBatch,
  listAiPrompts,
  listEnabledAiModels,
  type AiApiCaseDraft,
} from "@rabbit/api-client";
import { aiDraftToAsserts } from "@rabbit/shared";

const METHOD_COLOR: Record<string, string> = { GET: "blue", POST: "green", PUT: "orange", DELETE: "red", PATCH: "purple" };

/** 草稿 → 接口用例创建 body 的 request 包（断言映射 aiDraftToAsserts；spec 由目标定义补齐） */
function draftToBundle(draft: AiApiCaseDraft, base: { method: string; url: string }) {
  return {
    spec: {
      method: base.method,
      url: base.url,
      headers: draft.request.headers ?? [],
      query: draft.request.query ?? [],
      body: draft.request.bodyJson ? { kind: "raw_json" as const, content: draft.request.bodyJson } : { kind: "raw_json" as const, content: "" },
      auth: { kind: "none" as const },
      timeoutMs: 60000,
      followRedirects: false,
      skipPre: false,
      skipPost: false,
    },
    asserts: aiDraftToAsserts(draft.assertions),
    pre: [],
    post: [],
    extracts: [],
  };
}

/** AI-003 接口用例 AI 生成：单条（按选中定义）/ 批量（OpenAPI 文档 ≤20）。 */
export function ApiCaseGenerateDrawer({
  open,
  onClose,
  projectId,
  target,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  /** 单条模式目标：选中的接口定义（apis 页行操作传入） */
  target: { id: string; method: string; path: string; name: string } | null;
  /** 导入回调：（bundle, name）→ 调用方决定落库目标定义 */
  onImported: (items: { name: string; request: ReturnType<typeof draftToBundle> }[]) => Promise<number>;
}) {
  const [tab, setTab] = useState<"single" | "batch">("single");
  const [templateId, setTemplateId] = useState<string | undefined>(undefined);
  const [modelId, setModelId] = useState<string | undefined>(undefined);
  const [generating, setGenerating] = useState(false);
  const [draft, setDraft] = useState<AiApiCaseDraft | null>(null);
  const [openapiDoc, setOpenapiDoc] = useState("");
  const [batch, setBatch] = useState<{
    apis: { index: number; method: string; path: string; name: string }[];
    drafts: { apiIndex: number; method: string; path: string; draft: AiApiCaseDraft }[];
    skipped: { index: number; reason: string }[];
  } | null>(null);
  const [batchChecked, setBatchChecked] = useState<Record<number, boolean>>({});
  const [importing, setImporting] = useState(false);

  const prompts = useQuery({ queryKey: ["ai-prompts", projectId], queryFn: () => listAiPrompts(projectId), enabled: open });
  const models = useQuery({ queryKey: ["ai-model-picker"], queryFn: listEnabledAiModels, enabled: open });
  const apiPrompts = (prompts.data?.list ?? []).filter((p) => p.scene === "api_gen" && p.enabled);
  const defaultPrompt = apiPrompts.find((p) => p.isDefault);

  const generateSingle = async () => {
    if (!target) return;
    setGenerating(true);
    setDraft(null);
    try {
      const r = await aiGenerateApiCase(projectId, { apiId: target.id, templateId, modelId });
      setDraft(r.drafts[0] ?? null);
      if (r.skipped.length > 0) message.warning(`剔除 ${r.skipped.length} 条不合格草稿`);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "生成失败");
    } finally {
      setGenerating(false);
    }
  };

  const parseAndGenerateBatch = async () => {
    if (!openapiDoc.trim()) return;
    setGenerating(true);
    setBatch(null);
    try {
      const r = await aiGenerateApiCaseBatch(projectId, { openapiDoc, modelId });
      setBatch(r);
      setBatchChecked(Object.fromEntries(r.drafts.map((d, i) => [i, true])));
    } catch (e) {
      message.error(e instanceof Error ? e.message : "批量生成失败");
    } finally {
      setGenerating(false);
    }
  };

  const importSingle = async () => {
    if (!draft || !target) return;
    setImporting(true);
    const ok = await onImported([{ name: draft.name, request: draftToBundle(draft, { method: target.method, url: target.path }) }]);
    setImporting(false);
    if (ok > 0) {
      message.success("已导入 1 条接口用例");
      onClose();
    }
  };

  const importBatch = async () => {
    if (!batch) return;
    const picked = batch.drafts.filter((_, i) => batchChecked[i]);
    if (picked.length === 0) return;
    setImporting(true);
    const ok = await onImported(picked.map((p) => ({ name: p.draft.name, request: draftToBundle(p.draft, { method: p.method, url: p.path }) })));
    setImporting(false);
    if (ok > 0) {
      message.success(`成功导入 ${ok} 条`);
      onClose();
    }
  };

  return (
    <Drawer title="✦ AI 生成接口用例" open={open} onClose={onClose} width={720} data-testid="ai-apicase-drawer">
      <Tabs
        activeKey={tab}
        onChange={(k) => setTab(k as "single" | "batch")}
        items={[
          {
            key: "single",
            label: "单条（按接口定义）",
            children: (
              <div className="space-y-3">
                {target ? (
                  <div className="flex items-center gap-2 text-[13px]">
                    <Tag color={METHOD_COLOR[target.method] ?? "default"} className="font-mono">{target.method}</Tag>
                    <span className="font-mono text-xs">{target.path}</span>
                    <span className="text-slate-400 text-xs">{target.name}</span>
                  </div>
                ) : (
                  <Empty description="请先在接口定义列表选中一条定义（行操作 → AI 生成）" />
                )}
                <div className="flex gap-2">
                  <div className="flex-1">
                    <p className="text-xs text-slate-500 mb-1">提示词模板</p>
                    <Select
                      className="w-full"
                      value={templateId ?? defaultPrompt?.id ?? ""}
                      onChange={setTemplateId}
                      options={[{ value: "", label: "内置默认" }, ...apiPrompts.map((p) => ({ value: p.id, label: `${p.isDefault ? "★ " : ""}${p.name}` }))]}
                      data-testid="ai-apicase-template"
                    />
                  </div>
                  <div className="flex-1">
                    <p className="text-xs text-slate-500 mb-1">模型</p>
                    <Select
                      className="w-full"
                      value={modelId}
                      onChange={setModelId}
                      placeholder="默认模型"
                      allowClear
                      options={(models.data?.list ?? []).map((m) => ({ value: m.id, label: `${m.isDefault ? "★ " : ""}${m.model}` }))}
                      data-testid="ai-apicase-model"
                    />
                  </div>
                </div>
                <Button type="primary" loading={generating} onClick={generateSingle} disabled={!target} data-testid="ai-apicase-generate">
                  生成草稿
                </Button>
                {generating && <Skeleton active paragraph={{ rows: 3 }} />}
                {draft && (
                  <div className="border rounded-lg p-3 space-y-2" data-testid="ai-apicase-draft">
                    <p className="font-medium text-[13px]">{draft.name}</p>
                    {draft.request.bodyJson && (
                      <p className="font-mono text-xs text-slate-500 break-all">body: {draft.request.bodyJson}</p>
                    )}
                    <table className="w-full text-xs">
                      <thead className="text-slate-500 text-left">
                        <tr>
                          <th className="py-1">断言</th>
                          <th>算子</th>
                          <th>期望</th>
                        </tr>
                      </thead>
                      <tbody className="text-slate-600">
                        {draft.assertions.map((a, i) => (
                          <tr key={i}>
                            <td className="py-0.5">{a.source === "status" ? "status" : `${a.source} ${a.expression}`}</td>
                            <td className="font-mono">{a.operator}</td>
                            <td className="font-mono">{a.expected || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <Button type="primary" loading={importing} onClick={importSingle} data-testid="ai-apicase-import">
                      导入该用例
                    </Button>
                  </div>
                )}
              </div>
            ),
          },
          {
            key: "batch",
            label: "批量（OpenAPI）",
            children: (
              <div className="space-y-3">
                <p className="text-xs text-slate-400">粘贴 OpenAPI 3.x JSON；单批 ≤20 接口；仅生成用例草稿，导入绑定目标接口定义（不自动新建定义）</p>
                <Input.TextArea
                  rows={8}
                  value={openapiDoc}
                  onChange={(e) => setOpenapiDoc(e.target.value)}
                  placeholder='{"openapi":"3.0.0","paths":{...}}'
                  className="font-mono text-xs"
                  data-testid="ai-apicase-openapi"
                />
                <Button type="primary" loading={generating} onClick={parseAndGenerateBatch} disabled={!openapiDoc.trim()} data-testid="ai-apicase-batch-generate">
                  解析并批量生成
                </Button>
                {batch && (
                  <div className="space-y-2" data-testid="ai-apicase-batch-result">
                    <p className="text-xs text-slate-500">接口 {batch.apis.length} 个 · 草稿 {batch.drafts.length} 条{batch.skipped.length ? ` · 失败 ${batch.skipped.length}` : ""}</p>
                    {batch.drafts.map((d, i) => (
                      <label key={i} className="block border rounded-lg p-2.5 space-y-1 cursor-pointer" data-testid={`ai-apicase-batch-draft-${i}`}>
                        <div className="flex items-center gap-2">
                          <Checkbox checked={!!batchChecked[i]} onChange={(e) => setBatchChecked((p) => ({ ...p, [i]: e.target.checked }))} />
                          <Tag color={METHOD_COLOR[d.method] ?? "default"} className="font-mono">{d.method}</Tag>
                          <span className="font-mono text-xs">{d.path}</span>
                          <span className="text-xs text-slate-500 truncate">{d.draft.name}</span>
                          <span className="ml-auto text-[10px] text-slate-400">{d.draft.assertions.length} 断言</span>
                        </div>
                      </label>
                    ))}
                    <Button type="primary" loading={importing} onClick={importBatch} data-testid="ai-apicase-batch-import">
                      导入所选 ({batch.drafts.filter((_, i) => batchChecked[i]).length})
                    </Button>
                  </div>
                )}
              </div>
            ),
          },
        ]}
      />
    </Drawer>
  );
}

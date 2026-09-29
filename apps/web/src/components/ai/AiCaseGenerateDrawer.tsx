"use client";

import {
  Button,
  Checkbox,
  Drawer,
  Empty,
  Input,
  Select,
  Skeleton,
  TreeSelect,
  message,
} from "antd";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  aiGenerateCases,
  caseApiV2,
  listAiPrompts,
  listEnabledAiModels,
  moduleApi,
  type AiCaseDraft,
} from "@rabbit/api-client";
import { toTreeSelectData } from "@/components/CaseForm";

const LEVEL_MAP: Record<AiCaseDraft["level"], string> = {
  critical: "P0",
  high: "P1",
  medium: "P2",
  low: "P3",
};
// 静态类映射（Tailwind JIT 不编译动态拼接——S1 勘误 1 同款坑）
const LEVEL_CLS: Record<AiCaseDraft["level"], string> = {
  critical: "bg-red-50 text-red-500",
  high: "bg-orange-50 text-orange-500",
  medium: "bg-yellow-50 text-yellow-600",
  low: "bg-slate-100 text-slate-500",
};

/** AI-002 功能用例 AI 生成：需求输入+模块+模板 → 草稿勾选 → 导入（走 CASE-001 创建端点）。 */
export function AiCaseGenerateDrawer({
  open,
  onClose,
  projectId,
  defaultModuleId,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  defaultModuleId?: string | null;
  onImported?: () => void;
}) {
  const [requirement, setRequirement] = useState("");
  const [moduleId, setModuleId] = useState<string | undefined>(defaultModuleId ?? undefined);
  const [templateId, setTemplateId] = useState<string | undefined>(undefined);
  const [modelId, setModelId] = useState<string | undefined>(undefined);
  const [generating, setGenerating] = useState(false);
  const [drafts, setDrafts] = useState<AiCaseDraft[]>([]);
  const [skipped, setSkipped] = useState<{ index: number; reason: string }[]>([]);
  const [checked, setChecked] = useState<Record<number, boolean>>({});
  const [importing, setImporting] = useState(false);

  const modules = useQuery({
    queryKey: ["modules", projectId, "case"],
    queryFn: () => moduleApi.list(projectId, "case"),
    enabled: open,
  });
  const prompts = useQuery({
    queryKey: ["ai-prompts", projectId],
    queryFn: () => listAiPrompts(projectId),
    enabled: open,
  });
  const models = useQuery({
    queryKey: ["ai-model-picker"],
    queryFn: listEnabledAiModels,
    enabled: open,
  });

  const casePrompts = (prompts.data?.list ?? []).filter((p) => p.scene === "case_gen" && p.enabled);
  const defaultPrompt = casePrompts.find((p) => p.isDefault);

  const generate = async () => {
    if (!requirement.trim()) return;
    setGenerating(true);
    setDrafts([]);
    setSkipped([]);
    try {
      const r = await aiGenerateCases(projectId, { requirement, moduleId, templateId, modelId });
      setDrafts(r.drafts);
      setSkipped(r.skipped);
      setChecked(Object.fromEntries(r.drafts.map((_, i) => [i, true])));
    } catch (e) {
      message.error(e instanceof Error ? e.message : "生成失败");
    } finally {
      setGenerating(false);
    }
  };

  const importSelected = async () => {
    const picked = drafts.filter((_, i) => checked[i]);
    if (picked.length === 0) return;
    setImporting(true);
    let ok = 0;
    const fails: string[] = [];
    for (const d of picked) {
      try {
        await caseApiV2.create(projectId, {
          ...(moduleId ? { moduleId } : {}),
          name: d.name,
          precondition: d.prerequisite ?? "",
          steps: d.steps.map((s) => ({ desc: s.desc, expect: s.expect ?? "" })),
          level: LEVEL_MAP[d.level],
          tags: d.tags,
        });
        ok++;
      } catch (e) {
        fails.push(`${d.name}：${e instanceof Error ? e.message : "失败"}`);
      }
    }
    setImporting(false);
    if (ok > 0)
      message.success(`成功导入 ${ok} 条${fails.length ? `，失败 ${fails.length} 条` : ""}`);
    if (fails.length > 0) message.error(fails.slice(0, 3).join("；"));
    if (ok > 0) {
      onImported?.();
      onClose();
    }
  };

  return (
    <Drawer
      title="✦ AI 生成用例"
      open={open}
      onClose={onClose}
      width={640}
      data-testid="ai-case-generate-drawer"
    >
      <div className="space-y-3">
        <div>
          <p className="text-xs text-slate-500 mb-1">
            需求描述 <span className="text-slate-300">{requirement.length}/8000</span>
          </p>
          <Input.TextArea
            rows={4}
            value={requirement}
            onChange={(e) => setRequirement(e.target.value)}
            maxLength={8000}
            placeholder="粘贴需求/用户故事，AI 将生成测试用例草稿"
            data-testid="ai-case-requirement"
          />
        </div>
        <div className="flex gap-2">
          <div className="flex-1">
            <p className="text-xs text-slate-500 mb-1">目标模块</p>
            <TreeSelect
              className="w-full"
              value={moduleId}
              onChange={setModuleId}
              allowClear
              treeDefaultExpandAll
              treeData={[
                { title: "未分组", value: "", children: [] },
                ...toTreeSelectData(modules.data?.items ?? []),
              ]}
              data-testid="ai-case-module"
            />
          </div>
          <div className="flex-1">
            <p className="text-xs text-slate-500 mb-1">提示词模板</p>
            <Select
              className="w-full"
              value={templateId ?? defaultPrompt?.id ?? ""}
              onChange={setTemplateId}
              options={[
                { value: "", label: "内置默认" },
                ...casePrompts.map((p) => ({
                  value: p.id,
                  label: `${p.isDefault ? "★ " : ""}${p.name}`,
                })),
              ]}
              data-testid="ai-case-template"
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
              options={(models.data?.list ?? []).map((m) => ({
                value: m.id,
                label: `${m.isDefault ? "★ " : ""}${m.model}`,
              }))}
              data-testid="ai-case-model"
            />
          </div>
        </div>
        <Button
          type="primary"
          loading={generating}
          onClick={generate}
          disabled={!requirement.trim()}
          data-testid="ai-case-generate"
        >
          生成草稿
        </Button>

        {generating && <Skeleton active paragraph={{ rows: 4 }} />}
        {!generating && skipped.length > 0 && (
          <p className="text-xs text-amber-500">
            已剔除 {skipped.length} 条不合格草稿（
            {skipped
              .map((s) => s.reason)
              .slice(0, 2)
              .join("；")}
            ）
          </p>
        )}
        {!generating && drafts.length === 0 && skipped.length === 0 && (
          <Empty
            description={
              models.data?.total === 0
                ? "尚未配置 AI 模型——请联系管理员在 系统管理 → 模型设置 配置"
                : "生成后在此勾选导入"
            }
          />
        )}
        <div className="space-y-2" data-testid="ai-case-drafts">
          {drafts.map((d, i) => (
            <label
              key={i}
              className="block border rounded-lg p-3 space-y-1.5 cursor-pointer hover:border-[#574BFF]/40"
              data-testid={`ai-case-draft-${i}`}
            >
              <div className="flex items-center gap-2">
                <Checkbox
                  checked={!!checked[i]}
                  onChange={(e) => setChecked((prev) => ({ ...prev, [i]: e.target.checked }))}
                />
                <span className="font-medium text-[13px]">{d.name}</span>
                <span className={`text-[10px] border rounded px-1 ml-auto ${LEVEL_CLS[d.level]}`}>
                  {LEVEL_MAP[d.level]}
                </span>
              </div>
              {d.prerequisite && <p className="text-xs text-slate-400">前置：{d.prerequisite}</p>}
              <p className="text-xs text-slate-400">
                步骤 {d.steps.length} 条{d.tags.length ? ` · 标签：${d.tags.join(",")}` : ""}
              </p>
              <details className="text-xs text-slate-500">
                <summary className="cursor-pointer">查看步骤</summary>
                <ol className="list-decimal pl-4 pt-1 space-y-0.5">
                  {d.steps.map((s, j) => (
                    <li key={j}>
                      {s.desc}
                      {s.expect ? <span className="text-slate-300"> → {s.expect}</span> : null}
                    </li>
                  ))}
                </ol>
              </details>
            </label>
          ))}
        </div>
        {drafts.length > 0 && (
          <div className="flex items-center gap-2">
            <Button
              type="primary"
              loading={importing}
              onClick={importSelected}
              data-testid="ai-case-import"
            >
              导入所选 ({drafts.filter((_, i) => checked[i]).length})
            </Button>
            <span className="text-xs text-slate-400">
              导入走用例创建接口，模块/模板/权限真实校验
            </span>
          </div>
        )}
      </div>
    </Drawer>
  );
}

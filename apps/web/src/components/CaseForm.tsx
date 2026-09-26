"use client";

import { App, Button, Input, Radio, Select, Space, TreeSelect } from "antd";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ApiError,
  caseApiV2,
  fieldDefApi,
  memberApi,
  moduleApi,
  templateApi,
  type ModuleNodeDto,
} from "@rabbit/api-client";
import type { CaseLevel, CaseStep, FieldDefInput, TemplateFieldBinding } from "@rabbit/shared";
import { useProjectStore } from "@/stores/project";
import { useProjectInfo } from "@/hooks/usePermissions";
import { DynamicFieldForm, type DynFieldDef } from "@/components/DynamicField";

/** CASE-001/002/003：用例表单（新建/编辑），v2 端点 + 模块 + 动态自定义字段。 */

export function flattenModules(nodes: ModuleNodeDto[]): ModuleNodeDto[] {
  return nodes.flatMap((n) => [n, ...flattenModules(n.children)]);
}

export function toTreeSelectData(
  nodes: ModuleNodeDto[],
): { value: string; title: string; children?: ReturnType<typeof toTreeSelectData> }[] {
  return nodes.map((n) => ({
    value: n.id,
    title: n.name,
    children: n.children.length ? toTreeSelectData(n.children) : undefined,
  }));
}

interface Props {
  caseId?: string;
  /** 外层提交 testid（如新建页 btn-submit-case；span 包裹主保存按钮，点击等效） */
  submitTestId?: string;
  /** 详情页内嵌编辑态：隐藏页头/返回链接，保存与取消走回调 */
  embedded?: boolean;
  onSaved?: () => void;
  onCancel?: () => void;
  /** 初始模块（缺省取模块树默认模块） */
  defaultModuleId?: string;
}

interface FormState {
  name: string;
  precondition: string;
  steps: CaseStep[];
  level: CaseLevel;
  tags: string[];
  moduleId?: string;
}

export function CaseForm({
  caseId,
  submitTestId,
  embedded,
  onSaved,
  onCancel,
  defaultModuleId,
}: Props) {
  const router = useRouter();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const { currentProjectId } = useProjectStore();
  const project = useProjectInfo();
  const orgId = project?.org.id ?? null;
  const [form, setForm] = useState<FormState>({
    name: "",
    precondition: "",
    steps: [],
    level: "P2",
    tags: [],
  });
  const [fields, setFields] = useState<Record<string, unknown>>({});
  const [templateId, setTemplateId] = useState<string | undefined>(undefined);
  const [version, setVersion] = useState(1);
  const [num, setNum] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(!caseId);

  // 模块树（TreeSelect 数据源 + 默认模块兜底）
  const modulesQ = useQuery({
    queryKey: ["modules", currentProjectId, "case"],
    queryFn: () => moduleApi.list(currentProjectId!, "case"),
    enabled: Boolean(currentProjectId),
  });
  const flatModules = flattenModules(modulesQ.data?.items ?? []);
  const defaultModule = flatModules.find((m) => m.isDefault);

  // 动态字段：org 级字段定义 + 生效模板绑定（缺省默认模板）
  const defsQ = useQuery({
    queryKey: ["field-defs", orgId, "case"],
    queryFn: () => fieldDefApi.list(orgId!, "case"),
    enabled: Boolean(orgId),
  });
  const templatesQ = useQuery({
    queryKey: ["templates", orgId, currentProjectId, "case"],
    queryFn: () => templateApi.list(orgId!, currentProjectId!, "case"),
    enabled: Boolean(orgId && currentProjectId),
  });
  const membersQ = useQuery({
    queryKey: ["members", currentProjectId],
    queryFn: () => memberApi.projectMembers(currentProjectId!),
    enabled: Boolean(currentProjectId),
    staleTime: 60_000,
  });

  const defs: DynFieldDef[] = (defsQ.data ?? [])
    .filter((d) => d.enabled)
    .map((d) => ({ ...d, options: d.options as FieldDefInput["options"] }) as DynFieldDef);
  const bindings: TemplateFieldBinding[] | undefined = (() => {
    const list = templatesQ.data ?? [];
    const tpl =
      (templateId ? list.find((t) => t.id === templateId) : null) ?? list.find((t) => t.isDefault);
    return tpl?.fields?.map((b) => ({ ...b, visibleInList: b.visibleInList ?? false }));
  })();

  useEffect(() => {
    if (!caseId || !currentProjectId) return;
    void caseApiV2
      .detail(currentProjectId, caseId)
      .then((d) => {
        setForm({
          name: d.name,
          precondition: d.precondition,
          steps: d.steps,
          level: d.level as CaseLevel,
          tags: d.tags,
          moduleId: d.moduleId,
        });
        setFields(d.fields ?? {});
        setTemplateId(d.templateId ?? undefined);
        setVersion(d.version);
        setNum(d.num);
        setLoaded(true);
      })
      .catch((e) => message.error(e instanceof ApiError ? e.message : "加载失败"));
  }, [caseId, currentProjectId, message]);

  // 新建：未显式选模块时落到默认模块（或透传的初始模块）
  useEffect(() => {
    if (caseId || !currentProjectId) return;
    if (form.moduleId) return;
    const initial = defaultModuleId ?? defaultModule?.id;
    if (initial) setForm((f) => ({ ...f, moduleId: initial }));
  }, [caseId, currentProjectId, defaultModuleId, defaultModule?.id, form.moduleId]);

  function setStep(i: number, patch: Partial<CaseStep>) {
    setForm((f) => ({
      ...f,
      steps: f.steps.map((s, idx) => (idx === i ? { ...s, ...patch } : s)),
    }));
  }

  async function save(continu = false) {
    if (!currentProjectId) return;
    if (!form.name.trim()) {
      message.error("名称不能为空");
      return;
    }
    setSaving(true);
    const payload = {
      name: form.name.trim(),
      precondition: form.precondition,
      steps: form.steps,
      level: form.level,
      tags: form.tags,
      moduleId: form.moduleId,
      ...(templateId ? { templateId } : {}),
      fields,
    };
    try {
      if (caseId) {
        const updated = await caseApiV2.update(currentProjectId, caseId, { ...payload, version });
        setVersion(updated.version);
        setNum(updated.num);
        message.success("已保存");
        void qc.invalidateQueries({ queryKey: ["case"] });
        void qc.invalidateQueries({ queryKey: ["modules", currentProjectId, "case"] });
        onSaved?.();
      } else {
        const created = await caseApiV2.create(currentProjectId, payload);
        message.success(`已创建 C-${String(created.num).padStart(4, "0")}`);
        void qc.invalidateQueries({ queryKey: ["case"] });
        void qc.invalidateQueries({ queryKey: ["modules", currentProjectId, "case"] });
        if (!continu) {
          router.push("/cases");
          return;
        }
        setForm({
          name: "",
          precondition: "",
          steps: [],
          level: "P2",
          tags: [],
          moduleId: defaultModule?.id,
        });
        setFields({});
      }
    } catch (e) {
      if (e instanceof ApiError && e.code === 20409) {
        message.warning("内容已被他人修改，请刷新后重试");
      } else {
        // 422 等后端校验消息直接透出
        message.error(e instanceof ApiError ? e.message : "保存失败");
      }
    } finally {
      setSaving(false);
    }
  }

  if (!loaded) return null;

  const saveButton = (
    <Button type="primary" loading={saving} data-testid="btn-save-case" onClick={() => save(false)}>
      保存
    </Button>
  );

  return (
    <div className={embedded ? "" : "max-w-3xl"}>
      {!embedded && (
        <div className="rabbit-page-header">
          <div className="flex-1 min-w-0">
            <a
              className="text-[13px] text-[#87888D] hover:text-[#574BFF] no-underline"
              href="/cases"
            >
              ‹ 返回用例列表
            </a>
            <h1 className="mt-1">
              {caseId ? `编辑用例${num ? ` C-${String(num).padStart(4, "0")}` : ""}` : "新建用例"}
              <span className="ml-2 text-xs font-normal text-[#A8ABB0]">v{version}</span>
            </h1>
          </div>
        </div>
      )}
      <div className={`${embedded ? "" : "rabbit-card p-6"} space-y-5`} data-testid="case-form">
        <div className="grid grid-cols-[88px_1fr] items-center gap-3">
          <label className="text-sm text-gray-600">
            名称 <span className="text-red-500">*</span>
          </label>
          <Input
            value={form.name}
            maxLength={512}
            placeholder="用例名称"
            data-testid="case-name"
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
        </div>
        <div className="grid grid-cols-[88px_1fr] items-center gap-3">
          <label className="text-sm text-gray-600">所属模块</label>
          <TreeSelect
            className="w-full"
            value={form.moduleId}
            treeData={toTreeSelectData(modulesQ.data?.items ?? [])}
            treeDefaultExpandAll
            placeholder="选择模块（默认模块）"
            onChange={(v) => setForm((f) => ({ ...f, moduleId: v }))}
            data-testid="case-module"
          />
        </div>
        <div className="grid grid-cols-[80px_1fr] gap-3">
          <label className="text-sm text-gray-600">前置条件</label>
          <Input.TextArea
            rows={2}
            value={form.precondition}
            maxLength={4000}
            placeholder="前置条件（支持受限 Markdown）"
            data-testid="case-precondition"
            onChange={(e) => setForm((f) => ({ ...f, precondition: e.target.value }))}
          />
        </div>
        <div className="grid grid-cols-[80px_1fr] gap-3">
          <label className="text-sm text-gray-600">步骤</label>
          <div className="space-y-2" data-testid="case-steps">
            {form.steps.map((s, i) => (
              <div key={i} className="flex gap-2">
                <span className="w-6 h-6 rounded bg-gray-100 grid place-items-center text-xs shrink-0">
                  {i + 1}
                </span>
                <Input
                  placeholder="步骤描述（支持 Markdown）"
                  maxLength={2000}
                  value={s.desc}
                  data-testid={`step-desc-${i + 1}`}
                  onChange={(e) => setStep(i, { desc: e.target.value })}
                />
                <Input
                  placeholder="预期结果（支持 Markdown）"
                  maxLength={2000}
                  value={s.expect}
                  data-testid={`step-expect-${i + 1}`}
                  onChange={(e) => setStep(i, { expect: e.target.value })}
                />
                <Button
                  type="text"
                  className="text-gray-400"
                  aria-label={`remove-step-${i + 1}`}
                  onClick={() =>
                    setForm((f) => ({ ...f, steps: f.steps.filter((_, idx) => idx !== i) }))
                  }
                >
                  ✕
                </Button>
              </div>
            ))}
            <Button
              type="link"
              className="px-0"
              data-testid="btn-add-step"
              onClick={() =>
                setForm((f) => ({ ...f, steps: [...f.steps, { desc: "", expect: "" }] }))
              }
            >
              ＋ 添加步骤
            </Button>
          </div>
        </div>
        <div className="grid grid-cols-[88px_1fr] items-center gap-3">
          <label className="text-sm text-gray-600">等级</label>
          <Radio.Group
            value={form.level}
            data-testid="case-level"
            onChange={(e) => setForm((f) => ({ ...f, level: e.target.value }))}
            options={["P0", "P1", "P2", "P3"].map((l) => ({
              value: l,
              label: <span className={l === "P0" ? "text-red-500 font-medium" : ""}>{l}</span>,
            }))}
          />
        </div>
        <div className="grid grid-cols-[88px_1fr] items-center gap-3">
          <label className="text-sm text-gray-600">标签</label>
          <Select
            mode="tags"
            className="w-full"
            value={form.tags}
            placeholder="输入回车添加"
            data-testid="case-tags"
            onChange={(tags) => setForm((f) => ({ ...f, tags }))}
          />
        </div>
        {defs.length > 0 && (
          <div className="border-t border-[#F0F1F3] pt-4">
            <p className="text-sm text-gray-600 mb-3">自定义字段</p>
            <DynamicFieldForm
              defs={defs}
              bindings={bindings}
              value={fields}
              onChange={setFields}
              members={(membersQ.data?.items ?? []).map((m) => ({ id: m.id, name: m.name }))}
            />
          </div>
        )}
        <Space>
          {submitTestId ? <span data-testid={submitTestId}>{saveButton}</span> : saveButton}
          {!caseId && (
            <Button onClick={() => save(true)} data-testid="btn-save-continue">
              保存并继续
            </Button>
          )}
          <Button onClick={() => (embedded ? onCancel?.() : router.push("/cases"))}>取消</Button>
        </Space>
      </div>
    </div>
  );
}

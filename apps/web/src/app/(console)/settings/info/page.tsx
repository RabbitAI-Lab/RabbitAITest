"use client";

import { Button, Empty, Input, Spin, Switch, Tag } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { projectInfoApi } from "@rabbit/api-client";
import { PageHeader } from "@/components/PageHeader";
import { useApp } from "@/hooks/useApp";
import { useProjectStore } from "@/stores/project";

const MODULE_OPTIONS: {
  key: "case" | "plan" | "bug" | "api" | "load" | "uit";
  label: string;
  desc: string;
  defaultOn?: boolean; // S-future LOAD-001/UIT-001：load/uit 缺省即关（与 case/api/plan/bug 缺省开相反）
  enterprise?: boolean; // 企业版方向占位标记
}[] = [
  { key: "case", label: "测试用例", desc: "用例库、评审与回收站" },
  { key: "plan", label: "测试计划", desc: "计划编排与执行" },
  { key: "bug", label: "缺陷管理", desc: "缺陷提交与流转" },
  { key: "api", label: "接口测试", desc: "接口调试与定义" },
  {
    key: "load",
    label: "性能测试",
    desc: "开启后左导航出现「性能测试」占位入口（企业版方向，无执行能力）",
    defaultOn: false,
    enterprise: true,
  },
  {
    key: "uit",
    label: "UI 测试",
    desc: "开启后左导航出现「UI 测试」占位入口（企业版方向，无执行能力）",
    defaultOn: false,
    enterprise: true,
  },
];

const fmt = (v: string) => v.replace("T", " ").slice(0, 10);

/** PROJ-001：项目 › 设置 › 基本信息（名称/描述 + 模块开关 + 项目状态）。 */
export default function SettingsInfoPage() {
  const qc = useQueryClient();
  const { message } = useApp();
  const { currentProjectId } = useProjectStore();

  const {
    data: info,
    isLoading,
    isError,
    error,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ["project-info", currentProjectId],
    queryFn: () => projectInfoApi.get(currentProjectId!),
    enabled: Boolean(currentProjectId),
  });

  const [form, setForm] = useState({ name: "", description: "" });
  const [modules, setModules] = useState<Record<string, boolean>>({
    case: true,
    plan: true,
    bug: true,
    api: true,
  });

  useEffect(() => {
    if (!info) return;
    setForm({ name: info.name, description: info.description ?? "" });
    setModules({ case: true, plan: true, bug: true, api: true, ...info.modules });
  }, [info]);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["project-info"] });
    void qc.invalidateQueries({ queryKey: ["projects"] });
  };

  const save = useMutation({
    mutationFn: () =>
      projectInfoApi.update(currentProjectId!, {
        name: form.name.trim(),
        description: form.description.trim() || null,
        modules,
      }),
    onSuccess: () => {
      invalidate();
      message.success("基本信息已保存");
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "保存失败"),
  });

  const reopen = useMutation({
    mutationFn: () => projectInfoApi.reopen(currentProjectId!),
    onSuccess: () => {
      invalidate();
      message.success("项目已重新开启");
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "操作失败"),
  });

  if (!currentProjectId) {
    return (
      <div>
        <PageHeader title="基本信息" sub="项目设置" />
        <Empty className="py-24" description="请先选择项目" />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="基本信息"
        sub={
          info
            ? `编号 #${info.num} · 所属组织：${info.org.name} · 创建于 ${fmt(info.createdAt)}`
            : "项目设置"
        }
        extra={
          info && (
            <div className="flex items-center gap-2">
              {info.status === "ENDED" ? (
                <Tag>已结束（只读）</Tag>
              ) : (
                <Tag color="success">启用</Tag>
              )}
              {info.status === "ENDED" && (
                <Button
                  type="primary"
                  loading={reopen.isPending}
                  onClick={() => reopen.mutate()}
                  data-testid="btn-reopen-project"
                >
                  开启项目
                </Button>
              )}
            </div>
          )
        }
      />

      <div className="rabbit-card p-5 space-y-5 max-w-3xl" data-testid="project-info-form">
        {isError ? (
          /* 查询失败（服务重启/网络闪断/无权）不能落回 Spin——2026-09-30 报障：无限转圈无提示 */
          <div
            className="py-12 flex flex-col items-center gap-3"
            data-testid="project-info-error"
          >
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={error instanceof Error ? error.message : "基本信息加载失败"}
            />
            <Button
              type="primary"
              loading={isFetching}
              onClick={() => void refetch()}
              data-testid="btn-retry-info"
            >
              重试
            </Button>
          </div>
        ) : isLoading || !info ? (
          <div className="flex justify-center py-12">
            <Spin />
          </div>
        ) : (
          <>
            <div>
              <label className="block text-[13px] text-[#3D4350] mb-1">
                项目名称 <span className="text-[#FF4D4F]">*</span>
              </label>
              <Input
                className="w-96 max-w-full"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                maxLength={128}
                data-testid="input-project-name"
              />
            </div>
            <div>
              <label className="block text-[13px] text-[#3D4350] mb-1">项目描述</label>
              <Input.TextArea
                className="w-96 max-w-full"
                rows={3}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                maxLength={512}
                data-testid="input-project-desc"
              />
            </div>

            <div className="border-t border-[#F0F1F3] pt-4">
              <p className="text-[13px] font-medium mb-1">模块开关</p>
              <p className="text-xs text-[#A8ABB0] mb-3">
                关闭后左导航菜单隐藏、直访将重定向到工作台；数据全部保留，可随时重新开启。
              </p>
              <div className="space-y-3">
                {MODULE_OPTIONS.map((m) => {
                  const on =
                    m.defaultOn === false ? modules[m.key] === true : modules[m.key] !== false;
                  return (
                    <div key={m.key} className="flex items-center gap-3">
                      <Switch
                        checked={on}
                        onChange={(v) => setModules({ ...modules, [m.key]: v })}
                        data-testid={`module-switch-${m.key}`}
                      />
                      <span className="text-[13px] w-20">{m.label}</span>
                      {m.enterprise && (
                        <span className="border border-amber-400 text-amber-600 rounded px-1.5 py-0.5 text-[11px]">
                          企业版方向
                        </span>
                      )}
                      {m.enterprise ? (
                        <span className="text-xs text-[#A8ABB0]">{m.desc}</span>
                      ) : on ? (
                        <span className="text-xs text-[#A8ABB0]">{m.desc}</span>
                      ) : (
                        <span className="text-xs text-[#FF4D4F]">
                          已关闭：菜单隐藏，数据保留，可随时开启
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <Button
              type="primary"
              loading={save.isPending}
              disabled={!form.name.trim()}
              onClick={() => save.mutate()}
              data-testid="btn-save-info"
            >
              保存
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

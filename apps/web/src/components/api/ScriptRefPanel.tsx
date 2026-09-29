"use client";

import { Input, Select } from "antd";
import { useQuery } from "@tanstack/react-query";
import { publicScriptApi } from "@rabbit/api-client";
import { useProjectStore } from "@/stores/project";

export interface ScriptRefValue {
  scriptId: string;
  params: Record<string, string>;
}

/** PROJ-005：scriptRef 引用面板（仅已发布脚本；参数预填默认值，可覆盖）。三处处理器编辑器共用。 */
export function ScriptRefPanel({
  value,
  onChange,
  testid,
}: {
  value: ScriptRefValue | undefined;
  onChange: (v: ScriptRefValue | undefined) => void;
  testid?: string;
}) {
  const { currentProjectId: projectId } = useProjectStore();
  const scripts = useQuery({
    queryKey: ["public-scripts", projectId],
    queryFn: () => publicScriptApi.list(projectId!),
    enabled: Boolean(projectId),
  });
  const enabledScripts = (scripts.data?.items ?? []).filter((s) => s.status === "ENABLED");
  const selected = enabledScripts.find((s) => s.id === value?.scriptId);

  return (
    <div className="space-y-1.5" data-testid={testid}>
      <div className="flex items-center gap-2">
        <Select
          className="w-64"
          size="small"
          placeholder={enabledScripts.length === 0 ? "无已发布脚本" : "选择脚本（仅已发布）"}
          value={value?.scriptId}
          options={enabledScripts.map((s) => ({ value: s.id, label: s.name }))}
          onChange={(scriptId) => {
            const def = enabledScripts.find((s) => s.id === scriptId);
            const params: Record<string, string> = {};
            for (const p of def?.params ?? []) params[p.name] = p.defaultValue;
            onChange({ scriptId, params });
          }}
          data-testid={`${testid ?? "script-ref"}-select`}
        />
        {selected && <span className="text-[10px] text-green-600">● 已发布</span>}
      </div>
      {selected && selected.params.length > 0 && (
        <div className="space-y-1">
          {selected.params.map((p) => (
            <div key={p.name} className="flex gap-2 items-center">
              <span className="w-24 font-mono text-xs text-[#646A73]">{p.name}</span>
              <Input
                className="flex-1 font-mono text-xs"
                size="small"
                value={value?.params?.[p.name] ?? p.defaultValue}
                onChange={(e) =>
                  onChange({
                    scriptId: selected.id,
                    params: { ...(value?.params ?? {}), [p.name]: e.target.value },
                  })
                }
              />
              {value?.params?.[p.name] && value.params[p.name] !== p.defaultValue && (
                <span className="text-[10px] text-[#574BFF]">已覆盖</span>
              )}
            </div>
          ))}
        </div>
      )}
      <p className="text-[11px] text-[#A8ABB0]">
        执行构建期展开：内容内联 + 参数注入（显式值 &gt; 默认值）；引擎无感知
      </p>
    </div>
  );
}

/** script 处理器模式切换（内联 ⇄ 引用公共脚本）。 */
export function ScriptModeToggle({
  refMode,
  onChange,
  testid,
}: {
  refMode: boolean;
  onChange: (refMode: boolean) => void;
  testid?: string;
}) {
  return (
    <div className="flex border rounded overflow-hidden text-xs" data-testid={testid}>
      <button
        type="button"
        className={`px-3 py-1 ${!refMode ? "bg-[#574BFF] text-white" : "bg-white"}`}
        onClick={() => onChange(false)}
      >
        内联脚本
      </button>
      <button
        type="button"
        className={`px-3 py-1 ${refMode ? "bg-[#574BFF] text-white" : "bg-white"}`}
        onClick={() => onChange(true)}
      >
        引用公共脚本
      </button>
    </div>
  );
}

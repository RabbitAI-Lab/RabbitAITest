"use client";

import { App, Button, Input, Modal, Select } from "antd";
import { Save, Zap } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiApi, debugSubmitApi, execApi, moduleApi, ApiError } from "@rabbit/api-client";
import type { AssertSpec, AssertKind, HttpMethod, Kv } from "@rabbit/shared";
import { MethodTag, StatusDot } from "@rabbit/ui";
import RequestEditor, { emptyBundle, type RequestBundle } from "@/components/api/RequestEditor";
import EnvSelect from "@/components/api/EnvSelect";
import { usePermissions } from "@/hooks/usePermissions";
import { useProjectStore } from "@/stores/project";

/**
 * API-001/API-004：接口调试（S0 布局换芯）。
 * 顶部一行 method+URL+环境+执行（既有 testid 锚点：debug-method/debug-url/btn-execute），
 * 下方统一 RequestEditor（七区）+ 断言快捷面板（debug-asserts，API-001 e2e 口径不回归）。
 */

const METHODS: HttpMethod[] = [
  "GET",
  "POST",
  "PUT",
  "DELETE",
  "PATCH",
  "OPTIONS",
  "HEAD",
  "CONNECT",
];

const ASSERT_KINDS: { value: AssertKind; label: string }[] = [
  { value: "status_code", label: "状态码" },
  { value: "response_header", label: "响应头" },
  { value: "body_jsonpath", label: "响应体 JSONPath" },
  { value: "body_regex", label: "响应体正则" },
  { value: "response_time", label: "响应时间(ms)" },
  { value: "variable", label: "变量" },
];
const ASSERT_OPS = [
  { value: "eq", label: "等于" },
  { value: "contains", label: "包含" },
  { value: "lt", label: "小于" },
  { value: "le", label: "≤" },
  { value: "gt", label: "大于" },
  { value: "ge", label: "≥" },
  { value: "regex", label: "正则匹配" },
];
/** 断言目标列无义的类型（禁用目标输入） */
const NO_PATH_KINDS: AssertKind[] = ["status_code", "response_time"];

/** 提交前清洗：空 key/禁用行剔除、空期望断言剔除（与服务端 zod 口径对齐） */
function cleanBundle(b: RequestBundle): RequestBundle {
  const kv = (rows: Kv[]) => rows.filter((r) => r.enabled && r.key.trim());
  const body =
    b.spec.body.kind === "form_data" || b.spec.body.kind === "form_urlencoded"
      ? { ...b.spec.body, rows: b.spec.body.rows.filter((r) => r.enabled && r.key.trim()) }
      : b.spec.body;
  return {
    ...b,
    spec: { ...b.spec, headers: kv(b.spec.headers), query: kv(b.spec.query), body },
    asserts: b.asserts.filter((a) => a.expected !== "" || a.kind === "status_code"),
  };
}

export default function DebugPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const { can } = usePermissions();
  const { currentProjectId } = useProjectStore();
  const canSaveApi = can("PROJECT_API:CREATE");

  const [bundle, setBundle] = useState<RequestBundle>(() => {
    const b = emptyBundle("GET", "https://httpbin.org/get");
    // 默认一条状态码断言（API-001 e2e：input[placeholder="200"]）
    b.asserts = [{ kind: "status_code", path: "", op: "eq", expected: "200" }];
    return b;
  });
  const [envId, setEnvId] = useState<string | undefined>(undefined);
  const [executing, setExecuting] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saveModuleId, setSaveModuleId] = useState<string>();

  const { data: history, refetch } = useQuery({
    queryKey: ["debug-history", currentProjectId],
    queryFn: () => execApi.debugHistory(currentProjectId!),
    enabled: Boolean(currentProjectId),
  });
  const apiModulesQ = useQuery({
    queryKey: ["modules", currentProjectId, "api"],
    queryFn: () => moduleApi.list(currentProjectId!, "api"),
    enabled: Boolean(currentProjectId) && saveOpen,
  });
  const flatApiModules = (() => {
    const flatten = (
      nodes: { id: string; name: string; children: unknown[] }[],
      depth = 0,
    ): { value: string; label: string }[] =>
      nodes.flatMap((n) => [
        { value: n.id, label: `${"— ".repeat(depth)}${n.name}` },
        ...flatten(n.children as { id: string; name: string; children: unknown[] }[], depth + 1),
      ]);
    return flatten((apiModulesQ.data?.items ?? []) as { id: string; name: string; children: unknown[] }[]);
  })();

  const setSpecUrl = (url: string) => setBundle((b) => ({ ...b, spec: { ...b.spec, url } }));
  const setSpecMethod = (method: HttpMethod) => setBundle((b) => ({ ...b, spec: { ...b.spec, method } }));
  const patchAssert = (i: number, a: Partial<AssertSpec>) =>
    setBundle((b) => ({ ...b, asserts: b.asserts.map((x, idx) => (idx === i ? { ...x, ...a } : x)) }));

  const url = bundle.spec.url.trim();
  // ${var} 开头的 URL 由环境变量渲染（API-004：占位符也算「待渲染相对/绝对」路径，交执行侧判定）
  const isAbs = /^https?:\/\//i.test(url) || url.startsWith("\${");
  const isRel = url.startsWith("/") || url.startsWith("\${");

  async function execute() {
    if (!currentProjectId) return;
    if (!isAbs && !isRel) {
      message.error("URL 必须以 http/https 开头；或以 / 开头的相对路径（需选择环境）");
      return;
    }
    if (isRel && !envId) {
      message.error("相对路径需选择环境（或使用绝对 URL）");
      return;
    }
    setExecuting(true);
    try {
      const cleaned = cleanBundle(bundle);
      const { taskId } = await debugSubmitApi.submit(currentProjectId, {
        type: "api_debug",
        request: cleaned.spec,
        asserts: cleaned.asserts,
        pre: cleaned.pre,
        post: cleaned.post,
        extracts: cleaned.extracts,
        envId,
      });
      void refetch();
      router.push(`/reports/${taskId}`);
    } catch (e) {
      message.error(e instanceof ApiError ? e.message : "提交失败");
    } finally {
      setExecuting(false);
    }
  }

  const saveAsApi = useMutation({
    mutationFn: () => {
      const cleaned = cleanBundle(bundle);
      return apiApi.create(currentProjectId!, {
        moduleId: saveModuleId!,
        name: saveName.trim(),
        request: {
          spec: cleaned.spec,
          asserts: cleaned.asserts,
          pre: cleaned.pre,
          post: cleaned.post,
          extracts: cleaned.extracts,
        },
      });
    },
    onSuccess: (r) => {
      setSaveOpen(false);
      void qc.invalidateQueries({ queryKey: ["apis", currentProjectId] });
      message.success(`已保存为接口「${r.name}」，可在 接口定义 中查看`);
    },
    onError: (e) => message.error(e instanceof ApiError ? e.message : "保存失败"),
  });

  const openSaveModal = () => {
    const seg = bundle.spec.url.split("?")[0]?.split("/").filter(Boolean).pop();
    setSaveName(seg || bundle.spec.url || "未命名接口");
    setSaveModuleId(undefined);
    setSaveOpen(true);
  };

  return (
    <div className="flex gap-4 items-start">
      <div className="w-72 shrink-0 rabbit-card" data-testid="debug-history">
        <p className="rabbit-card-title flex items-center justify-between">
          调试历史 <span className="text-[11px] font-normal text-[#A8ABB0]">最近 20 条</span>
        </p>
        <div className="p-2 space-y-1">
          {(history?.items ?? []).map((h) => (
            <a
              key={h.id}
              href={`/reports/${h.id}`}
              className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-gray-50"
            >
              <MethodTag method={h.method} />
              <span className="truncate flex-1 text-gray-600">
                {h.url.replace(/^https?:\/\//, "")}
              </span>
              <StatusDot outcome={h.status as "SUCCESS" | "FAILED" | "RUNNING" | "PENDING"} />
            </a>
          ))}
          {(history?.items ?? []).length === 0 && (
            <p className="text-xs text-[#A8ABB0] p-2">暂无记录 · 执行后点击回看报告</p>
          )}
        </div>
      </div>

      <div className="flex-1 space-y-4 min-w-0">
        {/* 顶部一行：method + URL + 环境 + 执行 + 保存为接口 */}
        <div className="rabbit-card p-4">
          <div className="flex gap-2 items-center flex-wrap">
            <Select
              className="w-28"
              value={bundle.spec.method}
              onChange={setSpecMethod}
              options={METHODS.map((m) => ({ value: m, label: m }))}
              data-testid="debug-method"
            />
            <Input
              className="flex-1 min-w-[280px] font-mono"
              value={bundle.spec.url}
              onChange={(e) => setSpecUrl(e.target.value)}
              onPressEnter={execute}
              data-testid="debug-url"
              placeholder="https://… 或 ${base}/pets/1（相对路径需选环境）"
              status={!isAbs && !isRel && url !== "" ? "error" : undefined}
            />
            <EnvSelect value={envId} onChange={setEnvId} className="w-40" />
            <Button type="primary" loading={executing} onClick={execute} data-testid="btn-execute">
              执 行
            </Button>
            {canSaveApi && (
              <Button icon={<Save size={14} />} onClick={openSaveModal} data-testid="btn-save-as-api">
                保存为接口
              </Button>
            )}
          </div>
          <p className="text-xs text-[#A8ABB0] mt-2">
            {"`${var}` 作用域链：临时 > 任务参数 > 环境变量；相对路径按环境域名拼接（路径条件 > 模块 > 默认）"}
          </p>        </div>

        {/* 统一请求编辑器（七区）；其内部 method/URL 行与本页顶行同源，CSS 隐藏避免重复展示 */}
        <div className="rabbit-card p-3" data-testid="debug-editor">
          <div className="[&>div>div:first-child]:hidden">
            <RequestEditor bundle={bundle} onChange={setBundle} />
          </div>
        </div>

        {/* 断言快捷面板（API-001 既有 testid 口径：debug-asserts / btn-add-assert / 行为 div 直挂） */}
        <div className="rabbit-card p-4">
          <p className="rabbit-card-title flex items-center justify-between">
            断言
            <span className="text-[11px] font-normal text-[#A8ABB0]">
              类型 6 种 × 操作符 7 种 · 失败语义：断言不过 = ASSERT_FAILED
            </span>
          </p>
          <div className="space-y-2 pt-2" data-testid="debug-asserts">
            {bundle.asserts.map((a, i) => (
              <div key={i} className="flex gap-2">
                <Select
                  className="w-36"
                  value={a.kind}
                  options={ASSERT_KINDS}
                  onChange={(kind) => patchAssert(i, { kind, path: NO_PATH_KINDS.includes(kind) ? "" : a.path })}
                />
                <Input
                  className="w-44 font-mono"
                  placeholder="$.url"
                  disabled={NO_PATH_KINDS.includes(a.kind)}
                  value={a.path}
                  onChange={(e) => patchAssert(i, { path: e.target.value })}
                />
                <Select
                  className="w-24"
                  value={a.op}
                  options={ASSERT_OPS}
                  onChange={(op) => patchAssert(i, { op })}
                />
                <Input
                  className="flex-1 font-mono"
                  placeholder={a.kind === "status_code" ? "200" : "期望值"}
                  value={a.expected}
                  onChange={(e) => patchAssert(i, { expected: e.target.value })}
                />
                <Button
                  type="text"
                  className="text-gray-400"
                  aria-label={`remove-assert-${i + 1}`}
                  onClick={() =>
                    setBundle((b) => ({ ...b, asserts: b.asserts.filter((_, idx) => idx !== i) }))
                  }
                >
                  ✕
                </Button>
              </div>
            ))}
            <Button
              type="link"
              className="px-0"
              data-testid="btn-add-assert"
              onClick={() =>
                setBundle((b) => ({
                  ...b,
                  asserts: [...b.asserts, { kind: "status_code", path: "", op: "eq", expected: "200" }],
                }))
              }
            >
              ＋ 添加断言
            </Button>
          </div>
        </div>

        <div className="rabbit-card p-3.5 text-[13px] text-[#87888D] flex items-center gap-1.5 flex-wrap">
          <Zap size={14} className="text-[#574BFF]" />
          执行后跳转「执行报告」页实时查看（SSE）· 示例：
          <Button
            type="link"
            className="px-1 h-auto"
            onClick={() =>
              setBundle((b) => ({
                ...b,
                spec: { ...b.spec, method: "GET" as HttpMethod, url: "https://httpbin.org/get" },
              }))
            }
          >
            GET https://httpbin.org/get
          </Button>
        </div>
      </div>

      {/* 保存为接口 */}
      <Modal
        title="保存为接口"
        open={saveOpen}
        onCancel={() => setSaveOpen(false)}
        okText="保 存"
        confirmLoading={saveAsApi.isPending}
        okButtonProps={{ disabled: !saveName.trim() || !saveModuleId }}
        onOk={() => saveAsApi.mutate()}
      >
        <div className="space-y-3 pt-1">
          <div>
            <label className="block text-[13px] text-[#3D4350] mb-1">
              所属模块 <span className="text-[#FF4D4F]">*</span>
            </label>
            <Select
              className="w-full"
              placeholder="选择模块（接口定义树）"
              showSearch
              optionFilterProp="label"
              virtual={false}
              loading={apiModulesQ.isLoading}
              value={saveModuleId}
              onChange={setSaveModuleId}
              options={flatApiModules}
              data-testid="select-save-api-module"
            />
          </div>
          <div>
            <label className="block text-[13px] text-[#3D4350] mb-1">
              接口名称 <span className="text-[#FF4D4F]">*</span>
            </label>
            <Input
              value={saveName}
              maxLength={512}
              onChange={(e) => setSaveName(e.target.value)}
              data-testid="input-save-api-name"
            />
          </div>
          <p className="text-xs text-[#A8ABB0]">
            将当前调试载荷（请求 + 断言 + 前后置 + 提取）保存为接口定义；URL 为绝对地址时按原样保存。
          </p>
        </div>
      </Modal>
    </div>
  );
}

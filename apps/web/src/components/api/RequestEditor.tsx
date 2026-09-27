"use client";

import { Button, Checkbox, Input, InputNumber, Radio, Select, Switch, Tabs } from "antd";
import { ArrowDown, ArrowUp, X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { fileApi } from "@rabbit/api-client";
import type {
  AssertSpec,
  AssertKind,
  BodyKind,
  Extractor,
  FormRow,
  HttpMethod,
  Kv,
  Processor,
  RequestSpec,
} from "@rabbit/shared";
import { useProjectStore } from "@/stores/project";

/**
 * API-004 统一请求编辑器（七区）：定义 API 页签 / 用例编辑抽屉 / 调试页三处复用。
 * 契约冻结：Props 与 emptyBundle 签名不得变更（其他页面依赖）。
 */

export interface RequestBundle {
  spec: RequestSpec;
  asserts: AssertSpec[];
  pre: Processor[];
  post: Processor[];
  extracts: Extractor[];
}

export function emptyBundle(method = "GET", url = ""): RequestBundle {
  return {
    spec: {
      method: method as HttpMethod,
      url,
      headers: [],
      query: [],
      body: { kind: "none" },
      auth: { kind: "none" },
      timeoutMs: 60000,
      followRedirects: false,
      skipPre: false,
      skipPost: false,
    },
    asserts: [],
    pre: [],
    post: [],
    extracts: [],
  };
}

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
const BODY_KINDS: { value: BodyKind; label: string }[] = [
  { value: "none", label: "none" },
  { value: "form_data", label: "form-data" },
  { value: "form_urlencoded", label: "x-www-form-urlencoded" },
  { value: "raw_json", label: "json" },
  { value: "raw_xml", label: "xml" },
  { value: "raw_text", label: "raw 文本" },
  { value: "binary", label: "binary" },
];
const ASSERT_KINDS: { value: AssertKind; label: string }[] = [
  { value: "status_code", label: "状态码" },
  { value: "response_header", label: "响应头" },
  { value: "body_jsonpath", label: "响应体 JSONPath" },
  { value: "body_regex", label: "响应体正则" },
  { value: "response_time", label: "响应时间" },
  { value: "variable", label: "变量" },
];
const ASSERT_OPS = ["eq", "contains", "lt", "le", "gt", "ge", "regex"].map((o) => ({
  value: o,
  label: o,
}));
/** path 列按断言类型切换占位：JSONPath 表达式 / 头名 / 变量名；null = 该类型无目标列 */
const ASSERT_PATH_HINT: Partial<Record<AssertKind, string | null>> = {
  status_code: null,
  response_header: "头名（如 Content-Type）",
  body_jsonpath: "JSONPath 表达式（如 $.data.kind）",
  body_regex: null,
  response_time: null,
  variable: "变量名",
};
const SCRIPT_SNIPPETS = [
  { value: 'log("...")', label: "打印日志 log(...)" },
  { value: 'setVar("k", now()+"")', label: "生成时间戳 setVar(k, now())" },
  { value: 'setVar("k", randomInt(1,100)+"")', label: "生成随机数 setVar(k, randomInt)" },
  { value: 'envGet("base")', label: "读取环境变量 envGet(base)" },
];

/** KV 行编辑（Query/Headers）：key + value + enabled 勾选 + ✕ */
function KvRows({
  rows,
  onChange,
  rowTestId,
}: {
  rows: Kv[];
  onChange: (rows: Kv[]) => void;
  rowTestId: string;
}) {
  const patch = (i: number, part: Partial<Kv>) =>
    onChange(rows.map((r, idx) => (idx === i ? { ...r, ...part } : r)));
  return (
    <div className="space-y-1.5" data-testid={`${rowTestId}s`}>
      {rows.map((r, i) => (
        <div key={i} className="flex gap-2 items-center" data-testid={rowTestId}>
          <Checkbox
            checked={r.enabled}
            onChange={(e) => patch(i, { enabled: e.target.checked })}
            aria-label={`enabled-${i + 1}`}
          />
          <Input
            className="w-36"
            placeholder="key"
            disabled={!r.enabled}
            value={r.key}
            onChange={(e) => patch(i, { key: e.target.value })}
          />
          <Input
            className="flex-1 font-mono text-xs"
            placeholder="value（支持 ${var}）"
            disabled={!r.enabled}
            value={r.value}
            onChange={(e) => patch(i, { value: e.target.value })}
          />
          <Button
            type="text"
            size="small"
            className="!text-[#A8ABB0]"
            aria-label={`remove-${rowTestId}-${i + 1}`}
            onClick={() => onChange(rows.filter((_, idx) => idx !== i))}
          >
            <X size={13} />
          </Button>
        </div>
      ))}
      <Button
        type="link"
        size="small"
        className="!px-0"
        onClick={() => onChange([...rows, { key: "", value: "", enabled: true }])}
      >
        ＋ 添加
      </Button>
    </div>
  );
}

/** 有序处理器列表（前置/后置同构）：脚本 / SQL（Sprint 3 前禁用态）/ 等待 */
function ProcessorList({
  list,
  onChange,
  compact,
}: {
  list: Processor[];
  onChange: (list: Processor[]) => void;
  compact?: boolean;
}) {
  const patch = (i: number, p: Processor) =>
    onChange(list.map((x, idx) => (idx === i ? p : x)));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    const next = [...list];
    const a = next[i]!;
    next[i] = next[j]!;
    next[j] = a;
    onChange(next);
  };
  const kindLabel: Record<Processor["kind"], string> = {
    script: "脚本",
    sql: "SQL",
    wait: "等待",
  };

  return (
    <div className="space-y-2">
      {list.length === 0 && (
        <div className="border border-dashed border-[#E5E6EB] rounded-md py-5 text-center text-xs text-[#A8ABB0]">
          暂无处理器，「＋ 添加处理器」从 脚本 / SQL / 等待 开始
        </div>
      )}
      {list.map((p, i) => (
        <div key={i} className="border border-[#E5E6EB] rounded-md" data-testid={`processor-row-${i + 1}`}>
          <div className="flex items-center gap-2 px-2.5 py-1.5 bg-[#F7F8FA] border-b border-[#F0F1F3] rounded-t-md text-[13px]">
            <span className="text-xs text-[#A8ABB0]">{i + 1}</span>
            <Select
              className="w-24"
              size="small"
              value={p.kind}
              onChange={(kind) =>
                patch(i, kind === "script" ? { kind: "script", script: "" } : { kind: "wait", ms: 500 })
              }
              options={[
                { value: "script", label: "脚本" },
                { value: "sql", label: "SQL", disabled: true },
                { value: "wait", label: "等待" },
              ]}
            />
            <span className="text-xs text-[#A8ABB0]">
              {p.kind === "script" ? "quickjs · 同步执行 ≤5s · 无 IO" : kindLabel[p.kind]}
            </span>
            <span className="ml-auto flex items-center gap-1 text-[#A8ABB0]">
              <Button
                type="text"
                size="small"
                className="!px-1 !text-[#A8ABB0]"
                aria-label={`processor-up-${i + 1}`}
                disabled={i === 0}
                onClick={() => move(i, -1)}
              >
                <ArrowUp size={13} />
              </Button>
              <Button
                type="text"
                size="small"
                className="!px-1 !text-[#A8ABB0]"
                aria-label={`processor-down-${i + 1}`}
                disabled={i === list.length - 1}
                onClick={() => move(i, 1)}
              >
                <ArrowDown size={13} />
              </Button>
              <Button
                type="text"
                size="small"
                className="!px-1 !text-[#A8ABB0]"
                aria-label={`processor-remove-${i + 1}`}
                onClick={() => onChange(list.filter((_, idx) => idx !== i))}
              >
                <X size={13} />
              </Button>
            </span>
          </div>
          <div className="p-2.5 space-y-1.5">
            {p.kind === "script" && (
              <>
                <Input.TextArea
                  rows={compact ? 3 : 4}
                  className="font-mono text-xs leading-5"
                  placeholder={'// 脚本（quickjs：log / setVar / getVar / envGet / randomInt / now）'}
                  value={p.script}
                  onChange={(e) => patch(i, { kind: "script", script: e.target.value })}
                />
                <div className="flex justify-end">
                  <Select
                    className="w-56"
                    size="small"
                    value={undefined}
                    placeholder="片段 ▾"
                    options={SCRIPT_SNIPPETS}
                    onChange={(tpl) =>
                      patch(i, {
                        kind: "script",
                        script: p.script ? `${p.script}\n${tpl ?? ""}` : (tpl ?? ""),
                      })
                    }
                  />
                </div>
              </>
            )}
            {p.kind === "sql" && (
              <div className="space-y-1.5" title="SQL 处理器随 Sprint 3 开放">
                <p className="text-xs text-[#FA8C16]">SQL 处理器随 Sprint 3 开放（API-004 勘误 1）</p>
                <Input.TextArea
                  rows={2}
                  className="font-mono text-xs"
                  disabled
                  value={p.sql}
                  placeholder="SELECT ..."
                />
              </div>
            )}
            {p.kind === "wait" && (
              <div className="flex items-center gap-2 text-[13px]">
                <span className="text-[#646A73]">等待</span>
                <InputNumber
                  className="w-24"
                  min={1}
                  max={30000}
                  value={p.ms}
                  onChange={(v) => patch(i, { kind: "wait", ms: v ?? 1 })}
                />
                <span className="text-[#646A73]">ms</span>
              </div>
            )}
          </div>
        </div>
      ))}
      <Button
        type="link"
        size="small"
        className="!px-0"
        onClick={() => onChange([...list, { kind: "script", script: "" }])}
      >
        ＋ 添加处理器
      </Button>
    </div>
  );
}

export default function RequestEditor({
  bundle,
  onChange,
  compact,
}: {
  bundle: RequestBundle;
  onChange: (b: RequestBundle) => void;
  compact?: boolean;
}) {
  const { currentProjectId } = useProjectStore();
  const [activeTab, setActiveTab] = useState("params");
  const { spec } = bundle;
  const setSpec = (patch: Partial<RequestSpec>) =>
    onChange({ ...bundle, spec: { ...spec, ...patch } });
  const setAsserts = (asserts: AssertSpec[]) => onChange({ ...bundle, asserts });
  const setPre = (pre: Processor[]) => onChange({ ...bundle, pre });
  const setPost = (post: Processor[]) => onChange({ ...bundle, post });
  const setExtracts = (extracts: Extractor[]) => onChange({ ...bundle, extracts });

  // 文件列表（form_data file 行 / binary 选择；仅请求体页签激活时懒加载）
  const filesQ = useQuery({
    queryKey: ["files", currentProjectId, "editor"],
    queryFn: () => fileApi.list(currentProjectId!, { pageSize: 100 }),
    enabled: Boolean(currentProjectId) && activeTab === "body",
    staleTime: 60_000,
  });
  const fileOptions = (filesQ.data?.items ?? []).map((f) => ({
    value: f.id,
    label: `${f.name}（${f.sizeText}）`,
  }));

  // ── 请求体切换（保留同类内容）──
  function switchBodyKind(kind: BodyKind) {
    const prev = spec.body;
    let body: RequestSpec["body"];
    if (kind === "none") body = { kind: "none" };
    else if (kind === "form_data" || kind === "form_urlencoded")
      body = {
        kind,
        rows:
          prev.kind === "form_data" || prev.kind === "form_urlencoded"
            ? prev.rows
            : [],
      };
    else if (kind === "binary") body = { kind: "binary", fileId: prev.kind === "binary" ? prev.fileId : "" };
    else
      body = {
        kind,
        content:
          prev.kind === "raw_json" || prev.kind === "raw_xml" || prev.kind === "raw_text"
            ? prev.content
            : "",
      };
    setSpec({ body });
  }
  function switchAuth(kind: "none" | "basic" | "digest") {
    if (kind === "none") return setSpec({ auth: { kind: "none" } });
    const prev = spec.auth.kind === "basic" || spec.auth.kind === "digest" ? spec.auth : null;
    setSpec({ auth: { kind, username: prev?.username ?? "", password: prev?.password ?? "" } });
  }
  const patchFormRow = (i: number, part: Partial<FormRow>) =>
    setSpec({
      body:
        spec.body.kind === "form_data" || spec.body.kind === "form_urlencoded"
          ? {
              ...spec.body,
              rows: spec.body.rows.map((r, idx) =>
                idx === i ? { ...r, ...part, enabled: r.enabled } : r,
              ),
            }
          : spec.body,
    });

  const auth = spec.auth;
  const body = spec.body;

  const tabItems = [
    {
      key: "params",
      label: (
        <span data-testid="req-tab-params">参数</span>
      ),
      forceRender: true,
      children: (
        <div className="space-y-3" data-testid="req-panel-params">
          <div>
            <p className="text-[#646A73] font-medium mb-1.5 text-[13px]">Query 参数</p>
            <KvRows
              rows={spec.query}
              onChange={(rows) => setSpec({ query: rows })}
              rowTestId="req-query-row"
            />
          </div>
          <div>
            <p className="text-[#646A73] font-medium mb-1.5 text-[13px]">Headers</p>
            <KvRows
              rows={spec.headers}
              onChange={(rows) => setSpec({ headers: rows })}
              rowTestId="req-headers-row"
            />
          </div>
          <p className="text-xs text-[#A8ABB0]">行首勾选 = 启用/禁用该行（禁用行执行时跳过，编辑暂存不丢失）</p>
        </div>
      ),
    },
    {
      key: "auth",
      label: (
        <span data-testid="req-tab-auth">认证</span>
      ),
      forceRender: true,
      children: (
        <div className="space-y-2.5" data-testid="req-panel-auth">
          <Radio.Group
            value={auth.kind}
            onChange={(e) => switchAuth(e.target.value as "none" | "basic" | "digest")}
            options={[
              { value: "none", label: "NoAuth" },
              { value: "basic", label: "Basic" },
              { value: "digest", label: "Digest" },
            ]}
          />
          {auth.kind === "none" ? (
            <p className="text-xs text-[#A8ABB0]">未选择认证方式，请求将直接发送（NoAuth）</p>
          ) : (
            <div className="border border-[#F0F1F3] rounded-md p-2.5 bg-[#F7F8FA]/60 space-y-2">
              <div className="flex gap-2 items-center flex-wrap">
                <span className="w-14 text-right text-[#646A73] text-[13px]">用户名</span>
                <Input
                  className="flex-1 min-w-[140px]"
                  value={auth.username}
                  onChange={(e) => setSpec({ auth: { ...auth, username: e.target.value } })}
                />
                <span className="w-10 text-right text-[#646A73] text-[13px]">密码</span>
                <Input.Password
                  className="flex-1 min-w-[140px] font-mono"
                  value={auth.password}
                  onChange={(e) => setSpec({ auth: { ...auth, password: e.target.value } })}
                />
              </div>
              {auth.kind === "digest" && (
                <p className="text-xs text-[#A8ABB0]">
                  Digest：401 + WWW-Authenticate: Digest 挑战自动重试一次；仍 401 → 原响应进入断言
                </p>
              )}
            </div>
          )}
        </div>
      ),
    },
    {
      key: "body",
      label: (
        <span data-testid="req-tab-body">请求体</span>
      ),
      forceRender: true,
      children: (
        <div className="space-y-2.5" data-testid="req-panel-body">
          <Radio.Group
            value={body.kind}
            onChange={(e) => switchBodyKind(e.target.value as BodyKind)}
            options={BODY_KINDS}
          />
          {body.kind === "none" && (
            <p className="text-xs text-[#A8ABB0]">该请求没有请求体（none）</p>
          )}
          {(body.kind === "form_data" || body.kind === "form_urlencoded") && (
            <div className="space-y-1.5">
              {body.rows.map((r, i) => (
                <div key={i} className="flex gap-2 items-center" data-testid="req-form-row">
                  <Checkbox
                    checked={r.enabled}
                    onChange={(e) => patchFormRow(i, { enabled: e.target.checked })}
                    aria-label={`form-enabled-${i + 1}`}
                  />
                  <Input
                    className="w-36"
                    placeholder="key"
                    value={r.key}
                    onChange={(e) => patchFormRow(i, { key: e.target.value })}
                  />
                  {body.kind === "form_data" && (
                    <Select
                      className="w-20"
                      value={r.type}
                      size="small"
                      options={[
                        { value: "text", label: "text" },
                        { value: "file", label: "file" },
                      ]}
                      onChange={(type) => patchFormRow(i, { type })}
                    />
                  )}
                  {body.kind === "form_data" && r.type === "file" ? (
                    <Select
                      className="flex-1"
                      size="small"
                      showSearch
                      optionFilterProp="label"
                      virtual={false}
                      loading={filesQ.isLoading}
                      placeholder="选择文件（文件管理）"
                      value={r.fileId || undefined}
                      options={fileOptions}
                      onChange={(fileId) => patchFormRow(i, { fileId })}
                      allowClear
                    />
                  ) : (
                    <Input
                      className="flex-1 font-mono text-xs"
                      placeholder="value（支持 ${var}）"
                      value={r.value}
                      onChange={(e) => patchFormRow(i, { value: e.target.value })}
                    />
                  )}
                  <Button
                    type="text"
                    size="small"
                    className="!text-[#A8ABB0]"
                    aria-label={`remove-form-row-${i + 1}`}
                    onClick={() =>
                      setSpec({
                        body: { ...body, rows: body.rows.filter((_, idx) => idx !== i) },
                      })
                    }
                  >
                    <X size={13} />
                  </Button>
                </div>
              ))}
              <Button
                type="link"
                size="small"
                className="!px-0"
                onClick={() =>
                  setSpec({
                    body: {
                      ...body,
                      rows: [
                        ...body.rows,
                        { key: "", value: "", type: "text", enabled: true },
                      ],
                    },
                  })
                }
              >
                ＋ 添加
              </Button>
              <p className="text-xs text-[#A8ABB0]">
                文件经文件管理（PROJ-004）引用，执行时由引擎拉取字节流组装 multipart
              </p>
            </div>
          )}
          {(body.kind === "raw_json" || body.kind === "raw_xml" || body.kind === "raw_text") && (
            <Input.TextArea
              rows={compact ? 5 : 7}
              className="font-mono text-xs leading-5"
              placeholder={
                body.kind === "raw_json"
                  ? '{"key": "value"}'
                  : body.kind === "raw_xml"
                    ? "<root>…</root>"
                    : "raw text"
              }
              value={body.content}
              onChange={(e) => setSpec({ body: { ...body, content: e.target.value } })}
            />
          )}
          {body.kind === "binary" && (
            <div className="border border-dashed border-[#E5E6EB] rounded-md p-4 flex flex-col items-center gap-1.5 text-[#87888D]">
              <Select
                className="w-72"
                showSearch
                optionFilterProp="label"
                virtual={false}
                loading={filesQ.isLoading}
                placeholder="选择文件（整体作为请求体发送，application/octet-stream）"
                value={body.fileId || undefined}
                options={fileOptions}
                onChange={(fileId) => setSpec({ body: { kind: "binary", fileId: fileId ?? "" } })}
                allowClear
              />
              <span className="text-xs text-[#A8ABB0]">文件来自文件管理（PROJ-004），点击下拉选择替换</span>
            </div>
          )}
        </div>
      ),
    },
    {
      key: "pre",
      label: (
        <span data-testid="req-tab-pre">前置</span>
      ),
      forceRender: true,
      children: (
        <div data-testid="req-panel-pre">
          <ProcessorList list={bundle.pre} onChange={setPre} compact={compact} />
        </div>
      ),
    },
    {
      key: "post",
      label: (
        <span data-testid="req-tab-post">后置</span>
      ),
      forceRender: true,
      children: (
        <div className="space-y-3" data-testid="req-panel-post">
          <ProcessorList list={bundle.post} onChange={setPost} compact={compact} />
          <div>
            <p className="text-[#646A73] font-medium mb-1.5 text-[13px]">提取器</p>
            {bundle.extracts.length === 0 && (
              <div className="border border-dashed border-[#E5E6EB] rounded-md py-4 text-center text-xs text-[#A8ABB0] mb-2">
                暂无提取器，「＋ 添加提取」创建第一条
              </div>
            )}
            <div className="space-y-1.5">
              {bundle.extracts.map((ex, i) => (
                <div key={i} className="flex gap-2 items-center flex-wrap" data-testid="extract-row">
                  <Select
                    className="w-24"
                    size="small"
                    value={ex.source}
                    options={[
                      { value: "body", label: "body" },
                      { value: "headers", label: "headers" },
                    ]}
                    onChange={(source) => patchExtract(i, { source })}
                  />
                  <Select
                    className="w-24"
                    size="small"
                    value={ex.kind}
                    options={[
                      { value: "jsonpath", label: "JSONPath" },
                      { value: "regex", label: "正则" },
                    ]}
                    onChange={(kind) => patchExtract(i, { kind })}
                  />
                  <Input
                    className="flex-1 min-w-[140px] font-mono text-xs"
                    placeholder="表达式（如 $.data.token）"
                    value={ex.expression}
                    onChange={(e) => patchExtract(i, { expression: e.target.value })}
                  />
                  <span className="flex items-center gap-1">
                    <Select
                      className="w-20"
                      size="small"
                      value={ex.match}
                      options={[
                        { value: "first", label: "首个" },
                        { value: "random", label: "随机" },
                        { value: "n", label: "第 N 个" },
                      ]}
                      onChange={(match) =>
                        patchExtract(i, { match, ...(match === "n" ? { index: 1 } : {}) })
                      }
                    />
                    {ex.match === "n" && (
                      <InputNumber
                        className="w-14"
                        size="small"
                        min={1}
                        max={100}
                        value={ex.index ?? 1}
                        onChange={(v) => patchExtract(i, { index: v ?? 1 })}
                      />
                    )}
                  </span>
                  <Input
                    className="w-28 font-mono text-xs"
                    placeholder="变量名"
                    value={ex.variable}
                    onChange={(e) => patchExtract(i, { variable: e.target.value })}
                  />
                  <Select
                    className="w-20"
                    size="small"
                    value={ex.scope}
                    options={[
                      { value: "temp", label: "临时" },
                      { value: "env", label: "环境" },
                    ]}
                    onChange={(scope) => patchExtract(i, { scope })}
                  />
                  <Button
                    type="text"
                    size="small"
                    className="!text-[#A8ABB0]"
                    aria-label={`remove-extract-${i + 1}`}
                    onClick={() => setExtracts(bundle.extracts.filter((_, idx) => idx !== i))}
                  >
                    <X size={13} />
                  </Button>
                </div>
              ))}
              <Button
                type="link"
                size="small"
                className="!px-0"
                onClick={() =>
                  setExtracts([
                    ...bundle.extracts,
                    {
                      source: "body",
                      kind: "jsonpath",
                      expression: "",
                      match: "first",
                      variable: "",
                      scope: "temp",
                    },
                  ])
                }
              >
                ＋ 添加提取
              </Button>
            </div>
            <p className="text-xs text-[#A8ABB0] mt-1">
              作用域=临时 → 任务内后续步骤可见；=环境 → 执行回调写回 Environment（报告留痕）
            </p>
          </div>
        </div>
      ),
    },
    {
      key: "asserts",
      label: (
        <span data-testid="req-tab-asserts">断言</span>
      ),
      forceRender: true,
      children: (
        <div className="space-y-2" data-testid="req-panel-asserts">
          <p className="text-xs text-[#A8ABB0]">
            类型 6 种 × 操作符 7 种（eq / contains / lt / le / gt / ge / regex）；失败语义：断言不过=ASSERT_FAILED
          </p>
          {bundle.asserts.length === 0 && (
            <div className="border border-dashed border-[#E5E6EB] rounded-md py-4 text-center text-xs text-[#A8ABB0]">
              暂无断言，「＋ 添加断言」创建第一条
            </div>
          )}
          <div className="space-y-1.5">
            {bundle.asserts.map((a, i) => {
              const hint = ASSERT_PATH_HINT[a.kind];
              return (
                <div key={i} className="flex gap-2 items-center flex-wrap" data-testid="assert-row">
                  <Select
                    className="w-36"
                    size="small"
                    value={a.kind}
                    options={ASSERT_KINDS}
                    onChange={(kind) =>
                      patchAssert(i, {
                        kind,
                        path: hint === null ? "" : a.path,
                      })
                    }
                  />
                  <Input
                    className="w-40 font-mono text-xs"
                    disabled={hint === null}
                    placeholder={hint ?? "—"}
                    value={a.path}
                    onChange={(e) => patchAssert(i, { path: e.target.value })}
                  />
                  <Select
                    className="w-24"
                    size="small"
                    value={a.op}
                    options={ASSERT_OPS}
                    onChange={(op) => patchAssert(i, { op })}
                  />
                  <Input
                    className="flex-1 min-w-[120px] font-mono text-xs"
                    placeholder={
                      a.kind === "status_code"
                        ? "200"
                        : a.kind === "response_time"
                          ? "期望值（ms）"
                          : a.kind === "body_regex"
                            ? "正则表达式"
                            : "期望值"
                    }
                    value={a.expected}
                    onChange={(e) => patchAssert(i, { expected: e.target.value })}
                  />
                  <Button
                    type="text"
                    size="small"
                    className="!text-[#A8ABB0]"
                    aria-label={`remove-assert-${i + 1}`}
                    onClick={() => setAsserts(bundle.asserts.filter((_, idx) => idx !== i))}
                  >
                    <X size={13} />
                  </Button>
                </div>
              );
            })}
            <Button
              type="link"
              size="small"
              className="!px-0"
              onClick={() =>
                setAsserts([
                  ...bundle.asserts,
                  { kind: "status_code", path: "", op: "eq", expected: "200" },
                ])
              }
            >
              ＋ 添加断言
            </Button>
          </div>
        </div>
      ),
    },
    {
      key: "settings",
      label: (
        <span data-testid="req-tab-settings">设置</span>
      ),
      forceRender: true,
      children: (
        <div className="divide-y divide-[#F0F1F3] text-[13px]" data-testid="req-panel-settings">
          <div className="flex items-center gap-3 pb-3">
            <span className="w-32 text-[#646A73]">超时 timeoutMs</span>
            <InputNumber
              className="w-28"
              min={1000}
              max={120000}
              step={1000}
              value={spec.timeoutMs}
              onChange={(v) => setSpec({ timeoutMs: v ?? 60000 })}
            />
            <span className="text-[#646A73]">ms</span>
            <span className="text-xs text-[#A8ABB0]">1000–120000 · 连接/响应共享单值</span>
          </div>
          <div className="flex items-center gap-3 py-3">
            <span className="w-32 text-[#646A73]">跟随重定向</span>
            <Switch
              size="small"
              checked={spec.followRedirects}
              onChange={(followRedirects) => setSpec({ followRedirects })}
            />
            <span className="text-xs text-[#A8ABB0]">开启 · 最多 5 次 · 307/308 保持方法</span>
          </div>
          <div className="flex items-center gap-3 py-3">
            <span className="w-32 text-[#646A73]">跳过前置处理器</span>
            <Switch size="small" checked={spec.skipPre} onChange={(skipPre) => setSpec({ skipPre })} />
            <span className="text-xs text-[#A8ABB0]">环境全局开关之外的单请求覆写</span>
          </div>
          <div className="flex items-center gap-3 pt-3">
            <span className="w-32 text-[#646A73]">跳过后置处理器</span>
            <Switch
              size="small"
              checked={spec.skipPost}
              onChange={(skipPost) => setSpec({ skipPost })}
            />
          </div>
        </div>
      ),
    },
  ];

  function patchExtract(i: number, part: Partial<Extractor>) {
    setExtracts(bundle.extracts.map((x, idx) => (idx === i ? { ...x, ...part } : x)));
  }
  function patchAssert(i: number, part: Partial<AssertSpec>) {
    setAsserts(bundle.asserts.map((x, idx) => (idx === i ? { ...x, ...part } : x)));
  }

  return (
    <div className={compact ? "space-y-1.5" : "space-y-2"}>
      <div className="flex gap-2 items-center">
        <Select
          className="w-24"
          value={spec.method}
          onChange={(method) => setSpec({ method })}
          options={METHODS.map((m) => ({ value: m, label: m }))}
          data-testid="req-method"
        />
        <Input
          className="flex-1 font-mono text-[13px]"
          placeholder="${base}/pets/${petId} 或 https://…（支持 ${var}）"
          value={spec.url}
          onChange={(e) => setSpec({ url: e.target.value })}
          data-testid="req-url"
        />
      </div>
      <Tabs
        size="small"
        activeKey={activeTab}
        onChange={setActiveTab}
        items={tabItems}
      />
    </div>
  );
}

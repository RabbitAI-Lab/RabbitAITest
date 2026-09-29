"use client";

import {
  Button,
  Checkbox,
  Empty,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Switch,
  Table,
  Tabs,
  Tag,
} from "antd";
import { ArrowLeft, Import, Plus } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { envApi, moduleApi, ApiError, type EnvironmentRow } from "@rabbit/api-client";
import type { AssertSpec, AssertKind, Extractor, Processor } from "@rabbit/shared";
import { DRIVER_META, DRIVERS } from "@rabbit/shared";
import { PageHeader } from "@/components/PageHeader";
import { ScriptRefPanel } from "@/components/api/ScriptRefPanel";
import { useApp } from "@/hooks/useApp";
import { usePermissions } from "@/hooks/usePermissions";
import { useProjectStore } from "@/stores/project";

/** PROJ-003：项目 › 设置 › 环境管理（列表 + 五区编辑：变量/域名/HOST/数据源/全局前后置与断言）。 */

const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/** PLUG-004：五家驱动的表单元数据（label/URL 占位随 driver 切换） */
const DRIVER_OPTIONS = DRIVERS.map((d) => ({ value: d, label: DRIVER_META[d].label }));
const driverPlaceholder = (driver: string) =>
  DRIVER_META[driver as (typeof DRIVERS)[number]]?.urlPlaceholder ??
  DRIVER_META.postgresql.urlPlaceholder;

const emptyConfig = (): EnvironmentRow["config"] => ({
  vars: [],
  http: [],
  hosts: [],
  database: [],
  pre: [],
  post: [],
  asserts: [],
  extracts: [],
});

const fmtTime = (v: string | null) => (v ? v.replace("T", " ").slice(0, 16) : "—");

const ASSERT_KINDS: { value: AssertKind; label: string }[] = [
  { value: "status_code", label: "状态码" },
  { value: "response_header", label: "响应头" },
  { value: "body_jsonpath", label: "响应体 JSONPath" },
  { value: "body_regex", label: "响应体正则" },
  { value: "response_time", label: "响应时间(ms)" },
  { value: "variable", label: "变量" },
];
const ASSERT_OPS = ["eq", "contains", "lt", "le", "gt", "ge", "regex"] as const;
/** 目标列有义的类型（其余类型目标列禁用） */
const ASSERT_PATH_KINDS: AssertKind[] = [
  "body_jsonpath",
  "body_regex",
  "response_header",
  "variable",
];

const pathPlaceholder = (kind: AssertKind) =>
  kind === "body_jsonpath"
    ? "$.url"
    : kind === "body_regex"
      ? "\\d+"
      : kind === "response_header"
        ? "Header-Name"
        : "varName";

/** ── 处理器行（行式编辑：脚本/等待可选，SQL 禁用展示）── */
function ProcessorRows({
  title,
  list,
  onChange,
}: {
  title: string;
  list: Processor[];
  onChange: (next: Processor[]) => void;
}) {
  const patch = (i: number, p: Partial<Processor>) =>
    onChange(list.map((x, idx) => (idx === i ? ({ ...x, ...p } as Processor) : x)));
  return (
    <div className="space-y-2">
      <p className="text-[13px] text-[#646A73]">{title}</p>
      {list.map((p, i) => (
        <div key={i} className="flex gap-2 items-start border border-[#ECEEF1] rounded-md p-2">
          <Select
            className="w-28 shrink-0"
            value={p.kind}
            options={[
              { value: "script", label: "脚本" },
              { value: "wait", label: "等待" },
              { value: "sql", label: "SQL", disabled: true },
            ]}
            onChange={(kind) => {
              if (kind === "script") patch(i, { kind: "script", script: "" } as Processor);
              else if (kind === "wait") patch(i, { kind: "wait", ms: 500 } as Processor);
            }}
          />
          {p.kind === "script" &&
            ((p as { scriptRef?: unknown }).scriptRef ? (
              <div className="flex-1">
                <ScriptRefPanel
                  value={
                    (p as { scriptRef: { scriptId: string; params: Record<string, string> } })
                      .scriptRef
                  }
                  onChange={(v) =>
                    patch(
                      i,
                      (v ? { script: "", scriptRef: v } : { script: "" }) as unknown as Processor,
                    )
                  }
                />
                <button
                  type="button"
                  className="text-[11px] text-[#574BFF]"
                  onClick={() => patch(i, { script: "" } as Processor)}
                >
                  切换为内联脚本
                </button>
              </div>
            ) : (
              <div className="flex-1 flex gap-1">
                <Input.TextArea
                  className="flex-1 font-mono text-xs"
                  rows={3}
                  placeholder='// vars.set("k", "v") · log(...) · env.get(...)'
                  value={p.script}
                  onChange={(e) => patch(i, { script: e.target.value } as Processor)}
                />
                <button
                  type="button"
                  className="text-[11px] text-[#574BFF] shrink-0"
                  onClick={() =>
                    patch(i, {
                      script: "",
                      scriptRef: { scriptId: "", params: {} },
                    } as unknown as Processor)
                  }
                >
                  引用公共脚本
                </button>
              </div>
            ))}
          {p.kind === "wait" && (
            <span className="flex items-center gap-2 pt-1">
              <InputNumber
                min={1}
                max={30000}
                value={p.ms}
                onChange={(v) => patch(i, { ms: v ?? 500 } as Processor)}
              />
              <span className="text-[13px] text-[#646A73]">ms</span>
            </span>
          )}
          {p.kind === "sql" && (
            <span className="flex-1 text-xs text-[#A8ABB0] pt-1">
              SQL 处理器依赖数据源配置，编辑暂未开放（可经导入携带）
            </span>
          )}
          <Button
            type="text"
            className="text-gray-400"
            aria-label={`remove-${title}-${i + 1}`}
            onClick={() => onChange(list.filter((_, idx) => idx !== i))}
          >
            ✕
          </Button>
        </div>
      ))}
      <Button
        type="link"
        className="!px-0"
        onClick={() => onChange([...list, { kind: "script", script: "" } as Processor])}
      >
        ＋ 添加处理器
      </Button>
    </div>
  );
}

/** ── 断言行 ── */
function AssertRows({
  list,
  onChange,
}: {
  list: AssertSpec[];
  onChange: (next: AssertSpec[]) => void;
}) {
  const patch = (i: number, a: Partial<AssertSpec>) =>
    onChange(list.map((x, idx) => (idx === i ? { ...x, ...a } : x)));
  return (
    <div className="space-y-2">
      {list.map((a, i) => (
        <div key={i} className="flex gap-2" data-testid="env-assert-row">
          <Select
            className="w-36 shrink-0"
            value={a.kind}
            options={ASSERT_KINDS}
            onChange={(kind) => patch(i, { kind })}
          />
          <Input
            className="w-44 font-mono"
            placeholder={pathPlaceholder(a.kind)}
            disabled={!ASSERT_PATH_KINDS.includes(a.kind)}
            value={a.path}
            onChange={(e) => patch(i, { path: e.target.value })}
          />
          <Select
            className="w-24 shrink-0"
            value={a.op}
            options={ASSERT_OPS.map((o) => ({ value: o, label: o }))}
            onChange={(op) => patch(i, { op })}
          />
          <Input
            className="flex-1 font-mono"
            placeholder={a.kind === "status_code" ? "200" : "期望值"}
            value={a.expected}
            onChange={(e) => patch(i, { expected: e.target.value })}
          />
          <Button
            type="text"
            className="text-gray-400"
            aria-label={`remove-assert-${i + 1}`}
            onClick={() => onChange(list.filter((_, idx) => idx !== i))}
          >
            ✕
          </Button>
        </div>
      ))}
      <Button
        type="link"
        className="!px-0"
        onClick={() =>
          onChange([...list, { kind: "status_code", path: "", op: "eq", expected: "200" }])
        }
      >
        ＋ 添加断言
      </Button>
    </div>
  );
}

/** ── 提取行 ── */
function ExtractRows({
  list,
  onChange,
}: {
  list: Extractor[];
  onChange: (next: Extractor[]) => void;
}) {
  const patch = (i: number, x: Partial<Extractor>) =>
    onChange(list.map((e, idx) => (idx === i ? { ...e, ...x } : e)));
  return (
    <div className="space-y-2">
      {list.map((x, i) => (
        <div key={i} className="flex gap-2" data-testid="env-extract-row">
          <Select
            className="w-24 shrink-0"
            value={x.source}
            options={[
              { value: "body", label: "body" },
              { value: "headers", label: "headers" },
            ]}
            onChange={(source) => patch(i, { source })}
          />
          <Select
            className="w-24 shrink-0"
            value={x.kind}
            options={[
              { value: "jsonpath", label: "JSONPath" },
              { value: "regex", label: "正则" },
            ]}
            onChange={(kind) => patch(i, { kind })}
          />
          <Input
            className="w-44 font-mono"
            placeholder="$.data.token"
            value={x.expression}
            onChange={(e) => patch(i, { expression: e.target.value })}
          />
          <span className="flex items-center gap-1 shrink-0">
            <Select
              className="w-[88px]"
              value={x.match}
              options={[
                { value: "first", label: "首个" },
                { value: "random", label: "随机" },
                { value: "n", label: "第 N 个" },
              ]}
              onChange={(match) => patch(i, { match, index: match === "n" ? 1 : undefined })}
            />
            {x.match === "n" && (
              <InputNumber
                className="w-14"
                min={1}
                max={100}
                value={x.index ?? 1}
                onChange={(v) => patch(i, { index: v ?? 1 })}
              />
            )}
          </span>
          <Input
            className="w-32 font-mono"
            placeholder="变量名"
            value={x.variable}
            onChange={(e) => patch(i, { variable: e.target.value })}
          />
          <Select
            className="w-20 shrink-0"
            value={x.scope}
            options={[
              { value: "temp", label: "临时" },
              { value: "env", label: "环境" },
            ]}
            onChange={(scope) => patch(i, { scope })}
          />
          <Button
            type="text"
            className="text-gray-400"
            aria-label={`remove-extract-${i + 1}`}
            onClick={() => onChange(list.filter((_, idx) => idx !== i))}
          >
            ✕
          </Button>
        </div>
      ))}
      <Button
        type="link"
        className="!px-0"
        onClick={() =>
          onChange([
            ...list,
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
  );
}

function EnvironmentsView() {
  const qc = useQueryClient();
  const { message } = useApp();
  const { can } = usePermissions();
  const { currentProjectId: projectId } = useProjectStore();
  const canUpdate = can("PROJECT_ENV:UPDATE");
  const canCreate = can("PROJECT_ENV:CREATE");
  const canDelete = can("PROJECT_ENV:DELETE");

  const [editing, setEditing] = useState<EnvironmentRow | null>(null);
  const [name, setName] = useState("");
  const [config, setConfig] = useState<EnvironmentRow["config"]>(emptyConfig());
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importOverwrite, setImportOverwrite] = useState(false);
  /** 数据源连接测试结果：datasourceId → {ok, message} */
  const [dbTest, setDbTest] = useState<Record<string, { ok: boolean; message: string }>>({});

  const listQ = useQuery({
    queryKey: ["environments", projectId],
    queryFn: () => envApi.list(projectId!),
    enabled: Boolean(projectId) && !editing,
  });
  const apiModulesQ = useQuery({
    queryKey: ["modules", projectId, "api"],
    queryFn: () => moduleApi.list(projectId!, "api"),
    enabled: Boolean(projectId) && Boolean(editing),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["environments", projectId] });

  const openEdit = (row: EnvironmentRow) => {
    setEditing(row);
    setName(row.name);
    setConfig(structuredClone(row.config));
    setDbTest({});
  };
  useEffect(() => {
    // 列表变更（复制/导入）后重开编辑时同步草稿
    if (editing) return;
    setName("");
    setConfig(emptyConfig());
    setDbTest({});
  }, [editing]);

  const createEnv = useMutation({
    mutationFn: () =>
      envApi.create(projectId!, {
        name: `新环境 ${(listQ.data?.total ?? 0) + 1}`,
        config: emptyConfig(),
      }),
    onSuccess: (row) => {
      invalidate();
      openEdit(row);
      message.success("环境已创建，可继续编辑");
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "创建失败"),
  });
  const copyEnv = useMutation({
    mutationFn: (id: string) => envApi.copy(projectId!, id),
    onSuccess: () => {
      invalidate();
      message.success("已复制为副本（xxx_copy）");
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "复制失败"),
  });
  const removeEnv = useMutation({
    mutationFn: (id: string) => envApi.remove(projectId!, id),
    onSuccess: () => {
      invalidate();
      message.success("环境已删除");
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "删除失败"),
  });
  const exportEnv = async (row: EnvironmentRow) => {
    try {
      const { blob, filename } = await envApi.exportEnv(projectId!, row.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename.endsWith(".json") ? filename : `${filename}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "导出失败");
    }
  };
  const importEnvs = useMutation({
    mutationFn: () => {
      let payload: { name: string; config: EnvironmentRow["config"] }[];
      try {
        const parsed: unknown = JSON.parse(importText);
        if (!Array.isArray(parsed)) throw new Error("not array");
        payload = parsed as { name: string; config: EnvironmentRow["config"] }[];
      } catch {
        throw new ApiError(20422, "JSON 解析失败：需为 [{name, config}] 数组", 422);
      }
      return envApi.importEnvs(projectId!, { overwrite: importOverwrite, payload });
    },
    onSuccess: (r) => {
      invalidate();
      setImportOpen(false);
      setImportText("");
      message.success(`导入完成：导入 ${r.imported} · 覆盖 ${r.overwritten} · 跳过 ${r.skipped}`);
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "导入失败"),
  });
  const saveEnv = useMutation({
    mutationFn: () => envApi.update(projectId!, editing!.id, { name: name.trim(), config }),
    onSuccess: () => {
      invalidate();
      setEditing(null);
      message.success("环境已保存");
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "保存失败"),
  });
  const testDb = useMutation({
    mutationFn: (ds: { id: string; driver: string; url: string }) =>
      envApi.testDatasource(projectId!, ds.driver, ds.url),
    onSuccess: (r, ds) => {
      setDbTest((prev) => ({ ...prev, [ds.id]: { ok: r.ok, message: r.message } }));
    },
    onError: (e, ds) => {
      setDbTest((prev) => ({
        ...prev,
        [ds.id]: { ok: false, message: e instanceof Error ? e.message : "连接失败" },
      }));
    },
  });

  // ───────────────────────── 编辑视图 ─────────────────────────
  if (editing) {
    const moduleOptions = (() => {
      const flatten = (
        nodes: { id: string; name: string; children: unknown[] }[],
        depth = 0,
      ): { value: string; label: string }[] =>
        nodes.flatMap((n) => [
          { value: n.id, label: `${"— ".repeat(depth)}${n.name}` },
          ...flatten(n.children as { id: string; name: string; children: unknown[] }[], depth + 1),
        ]);
      return flatten(
        (apiModulesQ.data?.items ?? []) as { id: string; name: string; children: unknown[] }[],
      );
    })();

    const tabItems = [
      {
        key: "vars",
        label: <span data-testid="env-tab-vars">{`① 变量（${config.vars.length}）`}</span>,
        forceRender: true,
        children: (
          <div className="space-y-1.5" data-testid="env-vars-list">
            {config.vars.map((v, i) => (
              <div
                key={i}
                className={`flex gap-2 items-center ${v.enabled ? "" : "opacity-60"}`}
                data-testid="env-vars-row"
              >
                <Checkbox
                  title="启用：执行时参与 ${var} 渲染"
                  checked={v.enabled}
                  onChange={(e) =>
                    setConfig((c) => ({
                      ...c,
                      vars: c.vars.map((x, idx) =>
                        idx === i ? { ...x, enabled: e.target.checked } : x,
                      ),
                    }))
                  }
                />
                <Input
                  className="w-44"
                  placeholder="key"
                  value={v.key}
                  onChange={(e) =>
                    setConfig((c) => ({
                      ...c,
                      vars: c.vars.map((x, idx) => (idx === i ? { ...x, key: e.target.value } : x)),
                    }))
                  }
                />
                <Input
                  className="flex-1 font-mono text-xs"
                  placeholder="value"
                  value={v.value}
                  onChange={(e) =>
                    setConfig((c) => ({
                      ...c,
                      vars: c.vars.map((x, idx) =>
                        idx === i ? { ...x, value: e.target.value } : x,
                      ),
                    }))
                  }
                />
                <Button
                  type="text"
                  className="text-gray-400"
                  aria-label={`remove-var-${i + 1}`}
                  onClick={() =>
                    setConfig((c) => ({ ...c, vars: c.vars.filter((_, idx) => idx !== i) }))
                  }
                >
                  ✕
                </Button>
              </div>
            ))}
            <Button
              type="link"
              className="!px-0"
              data-testid="btn-add-var"
              onClick={() =>
                setConfig((c) => ({
                  ...c,
                  vars: [...c.vars, { key: "", value: "", enabled: true }],
                }))
              }
            >
              ＋ 添加
            </Button>
            <p className="text-xs text-[#A8ABB0] pt-1">
              {"`${var}` 渲染消费 · 作用域链：临时(API-004 提取) > 环境变量 > 项目全局参数"}
            </p>
          </div>
        ),
      },
      {
        key: "http",
        label: <span data-testid="env-tab-http">{`② 域名(HTTP)（${config.http.length}）`}</span>,
        forceRender: true,
        children: (
          <div className="space-y-2">
            {config.http.map((h, i) => {
              const patchHttp = (p: Partial<(typeof config.http)[number]>) =>
                setConfig((c) => ({
                  ...c,
                  http: c.http.map((x, idx) => (idx === i ? { ...x, ...p } : x)),
                }));
              return (
                <div
                  key={h.id ?? i}
                  className="border border-[#ECEEF1] rounded-md p-2.5 space-y-1.5"
                  data-testid="env-http-card"
                >
                  <div className="flex gap-2 items-center flex-wrap">
                    <Input
                      className="w-32"
                      placeholder="名称"
                      value={h.name}
                      onChange={(e) => patchHttp({ name: e.target.value })}
                    />
                    <Select
                      className="w-[88px]"
                      value={h.protocol}
                      options={[
                        { value: "http", label: "http" },
                        { value: "https", label: "https" },
                      ]}
                      onChange={(protocol) => patchHttp({ protocol })}
                    />
                    <Input
                      className="w-48 font-mono text-xs"
                      placeholder="hostname"
                      value={h.hostname}
                      onChange={(e) => patchHttp({ hostname: e.target.value })}
                    />
                    <InputNumber
                      className="w-[72px]"
                      min={1}
                      max={65535}
                      value={h.port}
                      onChange={(v) => patchHttp({ port: v ?? 80 })}
                    />
                    <Input
                      className="w-24 font-mono text-xs"
                      placeholder="/前缀"
                      value={h.pathPrefix}
                      onChange={(e) => patchHttp({ pathPrefix: e.target.value })}
                    />
                    <Button
                      type="text"
                      className="text-gray-400 ml-auto"
                      aria-label={`remove-http-${i + 1}`}
                      onClick={() =>
                        setConfig((c) => ({ ...c, http: c.http.filter((_, idx) => idx !== i) }))
                      }
                    >
                      ✕
                    </Button>
                  </div>
                  <div className="flex gap-2 items-center flex-wrap text-[13px]">
                    <span className="text-xs text-[#646A73]">条件</span>
                    <Select
                      className="w-40"
                      allowClear
                      placeholder="无（默认兜底）"
                      value={
                        h.conditions.moduleId
                          ? `mod:${h.conditions.moduleId}`
                          : h.conditions.pathPrefix
                            ? "path"
                            : undefined
                      }
                      options={[
                        ...moduleOptions.map((m) => ({
                          value: `mod:${m.value}`,
                          label: `模块：${m.label}`,
                        })),
                        { value: "path", label: "路径前缀" },
                      ]}
                      onChange={(v) => {
                        if (!v) return patchHttp({ conditions: {} });
                        if (v === "path")
                          return patchHttp({
                            conditions: { pathPrefix: h.conditions.pathPrefix ?? "/" },
                          });
                        patchHttp({ conditions: { moduleId: v.slice(4) } });
                      }}
                    />
                    {h.conditions.moduleId ? (
                      <span className="text-xs rounded bg-[#574BFF]/10 text-[#574BFF] px-1.5 py-0.5">
                        条件：模块{" "}
                        {moduleOptions.find((m) => m.value === h.conditions.moduleId)?.label ??
                          h.conditions.moduleId}
                      </span>
                    ) : h.conditions.pathPrefix !== undefined ? (
                      <Input
                        className="w-40 font-mono text-xs"
                        placeholder="/pets"
                        value={h.conditions.pathPrefix}
                        onChange={(e) => patchHttp({ conditions: { pathPrefix: e.target.value } })}
                      />
                    ) : (
                      <span className="text-xs rounded bg-[#F2F3F5] text-[#646A73] px-1.5 py-0.5">
                        无条件 · 默认兜底
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
            <Button
              type="link"
              className="!px-0"
              data-testid="btn-add-http"
              onClick={() =>
                setConfig((c) => ({
                  ...c,
                  http: [
                    ...c.http,
                    {
                      id: uid(),
                      name: "",
                      protocol: "http",
                      hostname: "",
                      port: 80,
                      pathPrefix: "",
                      conditions: {},
                    },
                  ],
                }))
              }
            >
              ＋ 添加域名
            </Button>
            <p className="text-xs text-[#A8ABB0]">
              相对路径匹配优先级：路径条件 &gt; 模块条件 &gt; 默认（无条件）
            </p>
          </div>
        ),
      },
      {
        key: "hosts",
        label: <span data-testid="env-tab-hosts">{`③ HOST（${config.hosts.length}）`}</span>,
        forceRender: true,
        children: (
          <div className="space-y-1.5">
            {config.hosts.map((m, i) => (
              <div key={i} className="flex gap-2 items-center" data-testid="env-hosts-row">
                <Input
                  className="w-56 font-mono text-xs"
                  placeholder="host"
                  value={m.host}
                  onChange={(e) =>
                    setConfig((c) => ({
                      ...c,
                      hosts: c.hosts.map((x, idx) =>
                        idx === i ? { ...x, host: e.target.value } : x,
                      ),
                    }))
                  }
                />
                <span className="text-[#A8ABB0]">→</span>
                <Input
                  className="w-56 font-mono text-xs"
                  placeholder="address"
                  value={m.address}
                  onChange={(e) =>
                    setConfig((c) => ({
                      ...c,
                      hosts: c.hosts.map((x, idx) =>
                        idx === i ? { ...x, address: e.target.value } : x,
                      ),
                    }))
                  }
                />
                <Button
                  type="text"
                  className="text-gray-400"
                  aria-label={`remove-host-${i + 1}`}
                  onClick={() =>
                    setConfig((c) => ({ ...c, hosts: c.hosts.filter((_, idx) => idx !== i) }))
                  }
                >
                  ✕
                </Button>
              </div>
            ))}
            <Button
              type="link"
              className="!px-0"
              data-testid="btn-add-host"
              onClick={() =>
                setConfig((c) => ({ ...c, hosts: [...c.hosts, { host: "", address: "" }] }))
              }
            >
              ＋ 添加
            </Button>
            <p className="text-xs text-[#A8ABB0]">host → address 映射，执行时连接地址重定向</p>
          </div>
        ),
      },
      {
        key: "db",
        label: <span data-testid="env-tab-db">{`④ 数据源（${config.database.length}）`}</span>,
        forceRender: true,
        children: (
          <div className="space-y-2">
            {config.database.map((d, i) => {
              const patchDb = (p: Partial<(typeof config.database)[number]>) =>
                setConfig((c) => ({
                  ...c,
                  database: c.database.map((x, idx) => (idx === i ? { ...x, ...p } : x)),
                }));
              const test = dbTest[d.id];
              return (
                <div
                  key={d.id ?? i}
                  className="border border-[#ECEEF1] rounded-md p-2.5"
                  data-testid="env-db-card"
                >
                  <div className="flex gap-2 items-center flex-wrap">
                    <Input
                      className="w-32"
                      placeholder="名称"
                      value={d.name}
                      onChange={(e) => patchDb({ name: e.target.value })}
                    />
                    <Select
                      className="w-32"
                      value={d.driver}
                      onChange={(v) => patchDb({ driver: v })}
                      options={DRIVER_OPTIONS}
                      data-testid={`db-driver-select-${i + 1}`}
                    />
                    <Input
                      className="flex-1 min-w-[260px] font-mono text-xs"
                      placeholder={driverPlaceholder(d.driver)}
                      value={d.url}
                      onChange={(e) => patchDb({ url: e.target.value })}
                    />
                    <Button
                      size="small"
                      loading={testDb.isPending}
                      onClick={() =>
                        d.url && testDb.mutate({ id: d.id, driver: d.driver, url: d.url })
                      }
                      data-testid={`btn-db-test-${i + 1}`}
                    >
                      连接测试
                    </Button>
                    <Button
                      type="text"
                      className="text-gray-400"
                      aria-label={`remove-db-${i + 1}`}
                      onClick={() =>
                        setConfig((c) => ({
                          ...c,
                          database: c.database.filter((_, idx) => idx !== i),
                        }))
                      }
                    >
                      ✕
                    </Button>
                  </div>
                  {test && (
                    <p
                      className={`text-xs mt-1.5 ${test.ok ? "text-[#52C41A]" : "text-[#FF4D4F]"}`}
                      data-testid={`db-test-result-${i + 1}`}
                    >
                      {test.ok ? "✓" : "✕"} {test.ok ? "连接成功" : "连接失败"} · {test.message}
                      （仅测试连通性，不落库）
                    </p>
                  )}
                </div>
              );
            })}
            <Button
              type="link"
              className="!px-0"
              data-testid="btn-add-db"
              onClick={() =>
                setConfig((c) => ({
                  ...c,
                  database: [...c.database, { id: uid(), name: "", driver: "postgresql", url: "" }],
                }))
              }
            >
              ＋ 添加数据源
            </Button>
            <p className="text-xs text-[#A8ABB0]">
              支持 PostgreSQL / MySQL / Oracle / SQL Server / 达梦 DM（PLUG-004 五家驱动；非 PG
              须先在系统设置-插件管理启用对应驱动插件）
            </p>
          </div>
        ),
      },
      {
        key: "prepost",
        label: <span data-testid="env-tab-prepost">⑤ 全局前后置与断言</span>,
        forceRender: true,
        children: (
          <div className="space-y-5">
            <ProcessorRows
              title={`前置处理器（${config.pre.length}，按序追加到该环境每次请求前）`}
              list={config.pre}
              onChange={(pre) => setConfig((c) => ({ ...c, pre }))}
            />
            <ProcessorRows
              title={`后置处理器（${config.post.length}，按序追加到该环境每次请求后）`}
              list={config.post}
              onChange={(post) => setConfig((c) => ({ ...c, post }))}
            />
            <div className="space-y-2">
              <p className="text-[13px] text-[#646A73]">全局断言（{config.asserts.length}）</p>
              <AssertRows
                list={config.asserts}
                onChange={(asserts) => setConfig((c) => ({ ...c, asserts }))}
              />
            </div>
            <div className="space-y-2">
              <p className="text-[13px] text-[#646A73]">
                全局提取（{config.extracts.length}，写回变量供后续请求消费）
              </p>
              <ExtractRows
                list={config.extracts}
                onChange={(extracts) => setConfig((c) => ({ ...c, extracts }))}
              />
            </div>
          </div>
        ),
      },
    ];

    return (
      <div>
        <div className="flex items-center gap-2 text-[13px] mb-3">
          <Button
            type="link"
            className="!px-0"
            icon={<ArrowLeft size={14} />}
            onClick={() => setEditing(null)}
          >
            返回列表
          </Button>
          <span className="text-[#A8ABB0]">/</span>
          <span className="text-[#646A73]">环境管理</span>
          <span className="text-[#A8ABB0]">/</span>
          <span className="font-medium">{editing.name}</span>
          <span className="ml-auto flex gap-2">
            <Button onClick={() => setEditing(null)}>取 消</Button>
            <Button
              type="primary"
              loading={saveEnv.isPending}
              disabled={!name.trim() || !canUpdate}
              onClick={() => saveEnv.mutate()}
              data-testid="btn-save-env"
            >
              保 存
            </Button>
          </span>
        </div>
        <div className="flex gap-4 items-start">
          <div className="w-72 shrink-0 rabbit-card p-4 space-y-3" data-testid="env-info">
            <p className="font-medium text-sm">环境信息</p>
            <div>
              <label className="block text-[13px] text-[#3D4350] mb-1">
                名称 <span className="text-[#FF4D4F]">*</span>
              </label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={128}
                data-testid="input-env-name"
              />
            </div>
            <p className="text-xs text-[#A8ABB0] leading-5">
              环境在任务下发时解析为快照注入执行命令（engine 不读环境定义）；调试 /
              用例执行处经环境选择器消费。
            </p>
          </div>
          <div className="flex-1 min-w-0 rabbit-card">
            <Tabs defaultActiveKey="vars" items={tabItems} data-testid="env-tabs" />
          </div>
        </div>
      </div>
    );
  }

  // ───────────────────────── 列表视图 ─────────────────────────
  const rows = listQ.data?.items ?? [];
  return (
    <div>
      <PageHeader
        title="环境管理"
        sub="项目 › 设置 › 环境管理 · 调试与执行时经环境选择器消费"
        extra={
          <>
            {canCreate && (
              <Button
                type="primary"
                icon={<Plus size={14} />}
                loading={createEnv.isPending}
                onClick={() => createEnv.mutate()}
                data-testid="btn-new-env"
              >
                新建环境
              </Button>
            )}
            {canCreate && (
              <Button
                icon={<Import size={14} />}
                onClick={() => setImportOpen(true)}
                data-testid="btn-import-env"
              >
                导入
              </Button>
            )}
          </>
        }
      />
      <div className="rabbit-card">
        <Table<EnvironmentRow>
          rowKey="id"
          loading={listQ.isLoading}
          dataSource={rows}
          data-testid="env-list-table"
          pagination={{ total: listQ.data?.total ?? 0, pageSize: 20, showSizeChanger: false }}
          locale={{
            emptyText: (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  <span className="text-[13px]">
                    暂无环境
                    <br />
                    <span className="text-xs text-[#A8ABB0]">
                      「新建环境」手工创建，或使用「导入」粘贴 JSON 批量导入
                    </span>
                  </span>
                }
              />
            ),
          }}
          columns={[
            {
              title: "环境名",
              dataIndex: "name",
              render: (v: string, row) => (
                <a className="text-[#574BFF]" onClick={() => openEdit(row)}>
                  {v}
                </a>
              ),
            },
            {
              title: "变量数",
              dataIndex: "config",
              width: 80,
              render: (c: EnvironmentRow["config"]) => c.vars.length,
            },
            {
              title: "域名数",
              dataIndex: "config",
              width: 80,
              render: (c: EnvironmentRow["config"]) => c.http.length,
            },
            {
              title: "更新时间",
              dataIndex: "updatedAt",
              width: 150,
              render: (v: string) => <span className="text-[#87888D]">{fmtTime(v)}</span>,
            },
            {
              title: "操作",
              key: "op",
              width: 230,
              render: (_, row) => (
                <span className="flex gap-1">
                  <Button type="link" size="small" className="!px-0" onClick={() => openEdit(row)}>
                    编辑
                  </Button>
                  {canCreate && (
                    <Button
                      type="link"
                      size="small"
                      className="!px-0"
                      onClick={() => copyEnv.mutate(row.id)}
                    >
                      复制
                    </Button>
                  )}
                  <Button
                    type="link"
                    size="small"
                    className="!px-0"
                    onClick={() => void exportEnv(row)}
                  >
                    导出
                  </Button>
                  {canDelete && (
                    <Popconfirm
                      title={`删除环境「${row.name}」？`}
                      description="软删除，历史任务报告中的快照不受影响"
                      onConfirm={() => removeEnv.mutate(row.id)}
                    >
                      <Button type="link" size="small" danger className="!px-0">
                        删除
                      </Button>
                    </Popconfirm>
                  )}
                </span>
              ),
            },
          ]}
        />
        <p className="px-3 py-2 border-t border-[#F0F1F3] text-xs text-[#A8ABB0]">
          复制副本命名「xxx_copy」 · 导出为 JSON 下载 · 删除为软删
        </p>
      </div>

      {/* 导入弹窗 */}
      <Modal
        title="导入环境"
        open={importOpen}
        onCancel={() => setImportOpen(false)}
        okText="开始导入"
        confirmLoading={importEnvs.isPending}
        onOk={() => importEnvs.mutate()}
        width={640}
      >
        <div className="space-y-3 pt-1">
          <div>
            <p className="text-[13px] text-[#646A73] mb-1">
              粘贴环境 JSON（数组，单次 ≤ 50 个环境）
            </p>
            <Input.TextArea
              rows={7}
              className="font-mono text-xs"
              placeholder={
                '[\n  { "name": "测试环境", "config": { "vars": [...], "http": [...], "hosts": [...] } }\n]'
              }
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              data-testid="import-env-textarea"
            />
          </div>
          <span className="flex items-start gap-2">
            <Switch
              checked={importOverwrite}
              onChange={setImportOverwrite}
              data-testid="import-env-overwrite"
            />
            <span className="text-[13px]">
              同名环境覆盖
              <span className="block text-xs text-[#A8ABB0]">
                开启：同名环境被覆盖且 version 重置为 1 ·
                关闭：同名跳过并计入校验报告；导入不产生「部分成功」（全合法才落库）
              </span>
            </span>
          </span>
        </div>
      </Modal>
    </div>
  );
}

// ── S5 PROJ-006：顶层三 Tab（环境 / 环境组 / 全局参数）──
import { EnvGroupsTab, GlobalParamsTab } from "./env-extras";
import { Tabs as AntTabsTop } from "antd";

export default function EnvironmentSettingsPage() {
  return (
    <div>
      <AntTabsTop
        defaultActiveKey="envs"
        items={[
          { key: "envs", label: "环境", children: <EnvironmentsView /> },
          { key: "groups", label: "环境组", children: <EnvGroupsTab /> },
          { key: "global-params", label: "全局参数", children: <GlobalParamsTab /> },
        ]}
        data-testid="env-top-tabs"
      />
    </div>
  );
}

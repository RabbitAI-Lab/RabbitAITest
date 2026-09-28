"use client";

import { Button, Empty, Input, Modal, Select, Switch, Table } from "antd";
import type { ColumnsType } from "antd/es/table";
import { Download, Plus, TerminalSquare, Upload as UploadIcon } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  ApiError,
  apiApi,
  apiCaseApi,
  moduleApi,
  type ApiRow,
  type ModuleNodeDto,
} from "@rabbit/api-client";
import { ApiCaseGenerateDrawer } from "@/components/ai/ApiCaseGenerateDrawer";
import type { HttpMethod } from "@rabbit/shared";
import { MethodTag } from "@rabbit/ui";
import { useProjectStore } from "@/stores/project";
import { usePermissions } from "@/hooks/usePermissions";
import { useApp } from "@/hooks/useApp";
import { PageHeader } from "@/components/PageHeader";
import { ModuleTreePanel } from "@/components/ModuleTreePanel";
import { emptyBundle } from "@/components/api/RequestEditor";

/** API-002 接口定义列表：模块树 + 定义列表 + 导入导出 + cURL 导入。 */

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
type ImportFormat = "openapi3" | "postman" | "rabbit";

function flattenModules(nodes: ModuleNodeDto[], depth = 0): (ModuleNodeDto & { depth: number })[] {
  return nodes.flatMap((n) => [{ ...n, depth }, ...flattenModules(n.children, depth + 1)]);
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

type ImportReport = {
  created: string[];
  overwritten: string[];
  skipped: string[];
  failed: { line: number; message: string }[];
};

export default function ApiListPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { message, modal } = useApp();
  const { can } = usePermissions();
  const { currentProjectId } = useProjectStore();
  const projectId = currentProjectId;

  const [moduleId, setModuleId] = useState<string | null>(null);
  const [method, setMethod] = useState<string>();
  const [status, setStatus] = useState<string>();
  const [keyword, setKeyword] = useState("");
  const [page, setPage] = useState(1);
  const [executingId, setExecutingId] = useState<string | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiTarget, setAiTarget] = useState<{
    id: string;
    method: string;
    path: string;
    name: string;
  } | null>(null);

  // 模块（新建/导入弹窗的目标模块下拉：树数据展平）
  const modulesQ = useQuery({
    queryKey: ["modules", projectId, "api"],
    queryFn: () => moduleApi.list(projectId!, "api"),
    enabled: Boolean(projectId),
  });
  const flatModules = flattenModules(modulesQ.data?.items ?? []);
  const defaultModuleId = flatModules.find((m) => m.isDefault)?.id ?? flatModules[0]?.id;

  const listQuery = {
    page,
    pageSize: 20,
    includeChildren: true,
    ...(moduleId ? { moduleId } : {}),
    ...(method ? { method } : {}),
    ...(status ? { status } : {}),
    ...(keyword ? { name: keyword } : {}),
  };
  const listQ = useQuery({
    queryKey: ["apis", "list", projectId, JSON.stringify(listQuery)],
    queryFn: () => apiApi.list(projectId!, listQuery),
    enabled: Boolean(projectId),
  });

  const invalidateApis = () => {
    void qc.invalidateQueries({ queryKey: ["apis"] });
    void qc.invalidateQueries({ queryKey: ["modules", projectId, "api"] });
  };

  const remove = useMutation({
    mutationFn: (id: string) => apiApi.remove(projectId!, id),
    onSuccess: () => {
      invalidateApis();
      message.success("接口已删除");
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "删除失败"),
  });

  /** 行内「执行」：以已保存的定义请求快捷发起调试，跳转执行报告 */
  async function execRow(r: ApiRow) {
    if (!projectId) return;
    setExecutingId(r.id);
    try {
      const { taskId } = await apiApi.debug(projectId, r.id, { request: r.request });
      router.push(`/reports/${taskId}`);
    } catch (e) {
      message.error(e instanceof ApiError ? e.message : "提交执行失败");
    } finally {
      setExecutingId(null);
    }
  }

  // ── 新建接口弹窗 ──
  const [newOpen, setNewOpen] = useState(false);
  const [newModule, setNewModule] = useState<string>();
  const [newName, setNewName] = useState("");
  const [newMethod, setNewMethod] = useState<HttpMethod>("GET");
  const [newPath, setNewPath] = useState("");
  const create = useMutation({
    mutationFn: () =>
      apiApi.create(projectId!, {
        moduleId: newModule ?? defaultModuleId!,
        name: newName.trim(),
        request: emptyBundle(newMethod, newPath.trim()),
      }),
    onSuccess: (r) => {
      setNewOpen(false);
      invalidateApis();
      message.success(`接口已创建（#${r.num}）`);
      router.push(`/apis/${r.id}`);
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "创建失败"),
  });

  // ── 导入弹窗 + 结果报告弹窗 ──
  const [importOpen, setImportOpen] = useState(false);
  const [importFormat, setImportFormat] = useState<ImportFormat>("openapi3");
  const [importUrl, setImportUrl] = useState("");
  const [importContent, setImportContent] = useState("");
  const [importOverwrite, setImportOverwrite] = useState(false);
  const [importModule, setImportModule] = useState<string>();
  const [importReport, setImportReport] = useState<ImportReport | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const doImport = useMutation({
    mutationFn: () =>
      apiApi.importApis(projectId!, {
        format: importFormat,
        source: {
          ...(importUrl.trim() ? { url: importUrl.trim() } : {}),
          ...(importContent.trim() ? { content: importContent } : {}),
        },
        overwrite: importOverwrite,
        moduleId: importModule ?? defaultModuleId!,
      }),
    onSuccess: (r) => {
      setImportOpen(false);
      setImportReport(r);
      setReportOpen(true);
      invalidateApis();
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "导入失败"),
  });

  // ── cURL 导入：粘贴 → 解析预览 → 保存为接口 ──
  const [curlOpen, setCurlOpen] = useState(false);
  const [curlText, setCurlText] = useState("");
  const [curlModule, setCurlModule] = useState<string>();
  const [curlName, setCurlName] = useState("");
  const parseCurl = useMutation({
    mutationFn: () => apiApi.parseCurl(projectId!, curlText),
    onSuccess: (r) => setCurlName(r.name || ""),
    onError: (e) => message.error(e instanceof Error ? e.message : "解析失败（请检查 cURL 命令）"),
  });
  const saveCurl = useMutation({
    mutationFn: () =>
      apiApi.create(projectId!, {
        moduleId: curlModule ?? defaultModuleId!,
        name: curlName.trim() || "cURL 导入接口",
        request: parseCurl.data!.request,
      }),
    onSuccess: (r) => {
      setCurlOpen(false);
      invalidateApis();
      message.success(`已保存为接口（#${r.num}）`);
      router.push(`/apis/${r.id}`);
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "保存失败"),
  });

  // ── 导出 ──
  const [exporting, setExporting] = useState(false);
  async function doExport() {
    if (!projectId) return;
    setExporting(true);
    try {
      const { blob, filename } = await apiApi.exportApis(projectId, {
        ...(moduleId ? { moduleId } : {}),
      });
      saveBlob(blob, filename);
      message.success("导出成功");
    } catch (e) {
      message.error(e instanceof Error ? e.message : "导出失败");
    } finally {
      setExporting(false);
    }
  }

  if (!projectId) return <Empty description="请先选择项目" />;

  const canCreate = can("PROJECT_API:CREATE");
  const canDelete = can("PROJECT_API:DELETE");
  const rows = listQ.data?.items ?? [];

  const moduleOptions = flatModules.map((m) => ({
    value: m.id,
    label: `${"　".repeat(m.depth)}${m.name}${m.isDefault ? "（默认）" : ""}`,
  }));

  const columns: ColumnsType<ApiRow> = [
    {
      title: "名称",
      dataIndex: "name",
      render: (name: string, r) => (
        <a className="text-[#1F2329] hover:text-[#574BFF] font-medium" href={`/apis/${r.id}`}>
          {name} <span className="text-[#A8ABB0] text-xs font-normal">#{r.num}</span>
        </a>
      ),
    },
    {
      title: "方法",
      dataIndex: "method",
      width: 92,
      render: (m: string) => <MethodTag method={m} />,
    },
    {
      title: "路径",
      dataIndex: "path",
      render: (p: string) => <span className="font-mono text-xs text-[#3D4350]">{p}</span>,
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 96,
      render: (s: "DEBUG" | "RELEASED") =>
        s === "DEBUG" ? (
          <span className="text-[13px] text-[#1677FF]">
            <span className="inline-block w-2 h-2 rounded-full bg-[#1677FF] mr-1.5 align-middle" />
            调试中
          </span>
        ) : (
          <span className="text-[13px] text-[#52C41A]">
            <span className="inline-block w-2 h-2 rounded-full bg-[#52C41A] mr-1.5 align-middle" />
            已发布
          </span>
        ),
    },
    {
      title: "用例",
      dataIndex: "caseCount",
      width: 68,
      render: (n: number | undefined) => <span className="text-[#87888D]">{n ?? 0}</span>,
    },
    {
      title: "更新时间",
      dataIndex: "updatedAt",
      width: 140,
      render: (s: string) => (
        <span className="text-[#87888D] text-xs">{s.replace("T", " ").slice(0, 16)}</span>
      ),
    },
    {
      title: "操作",
      key: "ops",
      width: 168,
      render: (_, r, i) => (
        <span className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <Button
            type="link"
            size="small"
            className="!px-0"
            onClick={() => router.push(`/apis/${r.id}`)}
            data-testid={`btn-edit-api-${i + 1}`}
          >
            编辑
          </Button>
          <span className="text-[#E5E6EB]">|</span>
          <Button
            type="link"
            size="small"
            className="!px-0"
            loading={executingId === r.id}
            onClick={() => void execRow(r)}
            data-testid={`btn-exec-api-${i + 1}`}
          >
            执行
          </Button>
          <span className="text-[#E5E6EB]">|</span>
          {can("PROJECT_AI:READ") && (
            <Button
              type="link"
              size="small"
              className="!px-0"
              onClick={() => {
                setAiTarget({ id: r.id, method: r.method, path: r.path, name: r.name });
                setAiOpen(true);
              }}
              data-testid={`btn-ai-gen-api-${i + 1}`}
            >
              AI 生成
            </Button>
          )}
          <span className="text-[#E5E6EB]">|</span>
          {canDelete && (
            <Button
              type="link"
              size="small"
              danger
              className="!px-0"
              data-testid={`btn-del-api-${i + 1}`}
              onClick={() =>
                modal.confirm({
                  title: `删除接口「${r.name}」？`,
                  content: "其下接口用例与 Mock 规则将一并删除，操作不可恢复。",
                  okText: "删除",
                  okButtonProps: { danger: true },
                  onOk: () => remove.mutateAsync(r.id),
                })
              }
            >
              删除
            </Button>
          )}
        </span>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="接口定义"
        sub="项目内全部 API 定义（测试管理 → 接口测试）"
        extra={
          canCreate && (
            <Button
              type="primary"
              icon={<Plus size={14} />}
              onClick={() => {
                setNewModule(moduleId ?? defaultModuleId);
                setNewName("");
                setNewMethod("GET");
                setNewPath("");
                setNewOpen(true);
              }}
              data-testid="btn-new-api"
            >
              新建接口
            </Button>
          )
        }
      />

      <div className="flex gap-4 items-stretch">
        <ModuleTreePanel
          projectId={projectId}
          scene="api"
          selectedId={moduleId}
          includeChildren
          onSelect={(id) => {
            setModuleId(id);
            setPage(1);
          }}
          canEdit={can("PROJECT_API:UPDATE")}
        />
        <div className="rabbit-card flex-1 min-w-0 flex flex-col">
          {/* 工具条 + 筛选 */}
          <div className="flex items-center gap-2 px-3 min-h-12 border-b border-[#F0F1F3] text-[13px] flex-wrap">
            {canCreate && (
              <Button
                size="small"
                icon={<UploadIcon size={13} />}
                onClick={() => {
                  setImportFormat("openapi3");
                  setImportUrl("");
                  setImportContent("");
                  setImportOverwrite(false);
                  setImportModule(moduleId ?? defaultModuleId);
                  setImportOpen(true);
                }}
                data-testid="btn-import-api"
              >
                导入
              </Button>
            )}
            <Button
              size="small"
              icon={<Download size={13} />}
              loading={exporting}
              onClick={() => void doExport()}
              data-testid="btn-export-api"
            >
              导出
            </Button>
            {canCreate && (
              <Button
                size="small"
                icon={<TerminalSquare size={13} />}
                onClick={() => {
                  setCurlText("");
                  setCurlModule(moduleId ?? defaultModuleId);
                  parseCurl.reset();
                  setCurlName("");
                  setCurlOpen(true);
                }}
                data-testid="btn-curl-import"
              >
                cURL 导入
              </Button>
            )}
            <span className="ml-auto flex items-center gap-2">
              <Select
                className="w-28"
                allowClear
                virtual={false}
                placeholder="全部方法"
                value={method}
                options={METHODS.map((m) => ({ value: m, label: m }))}
                onChange={(v) => {
                  setMethod(v);
                  setPage(1);
                }}
                data-testid="select-method"
              />
              <Select
                className="w-28"
                allowClear
                virtual={false}
                placeholder="全部状态"
                value={status}
                options={[
                  { value: "DEBUG", label: "调试中" },
                  { value: "RELEASED", label: "已发布" },
                ]}
                onChange={(v) => {
                  setStatus(v);
                  setPage(1);
                }}
                data-testid="select-status"
              />
              <Input.Search
                className="w-44"
                allowClear
                placeholder="搜索名称"
                data-testid="input-keyword"
                onSearch={(v) => {
                  setKeyword(v);
                  setPage(1);
                }}
              />
            </span>
          </div>

          {/* 列表 */}
          <div className="flex-1 min-w-0">
            <Table<ApiRow>
              rowKey="id"
              data-testid="api-list-table"
              loading={listQ.isLoading}
              dataSource={rows}
              onRow={(r, i) =>
                ({
                  onClick: () => router.push(`/apis/${r.id}`),
                  className: "cursor-pointer",
                  "data-testid": `api-row-${(i ?? 0) + 1}`,
                }) as React.HTMLAttributes<ApiRow>
              }
              pagination={{
                current: page,
                pageSize: 20,
                total: listQ.data?.total ?? 0,
                onChange: (p) => setPage(p),
                showTotal: (t) => `共 ${t} 条`,
              }}
              locale={{
                emptyText: (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={
                      <span>
                        暂无接口定义，「新建接口」手工创建
                        <br />
                        或使用「导入」批量导入 OpenAPI / Postman
                      </span>
                    }
                  />
                ),
              }}
              columns={columns}
            />
          </div>
        </div>
      </div>

      {/* 新建接口 */}
      <Modal
        title="新建接口"
        open={newOpen}
        onCancel={() => setNewOpen(false)}
        okText="创建并编辑"
        cancelText="取消"
        okButtonProps={{
          disabled: !newName.trim() || !newPath.trim() || !(newModule ?? defaultModuleId),
        }}
        confirmLoading={create.isPending}
        onOk={() => create.mutate()}
      >
        <div className="space-y-3">
          <div>
            <label className="block text-[13px] mb-1">所属模块</label>
            <Select
              className="w-full"
              virtual={false}
              value={newModule ?? defaultModuleId}
              options={moduleOptions}
              onChange={setNewModule}
              data-testid="select-new-module"
            />
          </div>
          <div>
            <label className="block text-[13px] mb-1">接口名称</label>
            <Input
              value={newName}
              maxLength={512}
              placeholder="如：查询宠物"
              onChange={(e) => setNewName(e.target.value)}
              data-testid="input-new-name"
            />
          </div>
          <div className="flex gap-2">
            <div className="w-28">
              <label className="block text-[13px] mb-1">Method</label>
              <Select
                className="w-full"
                value={newMethod}
                options={METHODS.map((m) => ({ value: m, label: m }))}
                onChange={setNewMethod}
                data-testid="select-new-method"
              />
            </div>
            <div className="flex-1">
              <label className="block text-[13px] mb-1">Path / URL</label>
              <Input
                className="font-mono"
                value={newPath}
                maxLength={2048}
                placeholder="/pets/{id} 或 ${base}/pets"
                onChange={(e) => setNewPath(e.target.value)}
                data-testid="input-new-path"
                onPressEnter={() => newName.trim() && newPath.trim() && create.mutate()}
              />
            </div>
          </div>
          <p className="text-xs text-[#A8ABB0]">
            创建后进入详情页编辑参数体系（Query/Headers/请求体/前后置/断言/提取）。
          </p>
        </div>
      </Modal>

      {/* 导入 */}
      <Modal
        title="导入接口"
        open={importOpen}
        onCancel={() => setImportOpen(false)}
        okText="开始导入"
        cancelText="取消"
        confirmLoading={doImport.isPending}
        okButtonProps={{
          disabled:
            !(importUrl.trim() || importContent.trim()) || !(importModule ?? defaultModuleId),
        }}
        onOk={() => doImport.mutate()}
        width={620}
      >
        <div className="space-y-3">
          <div className="flex gap-3">
            <div className="w-40">
              <label className="block text-[13px] mb-1">格式</label>
              <Select
                className="w-full"
                value={importFormat}
                options={[
                  { value: "openapi3", label: "OpenAPI 3.x" },
                  { value: "postman", label: "Postman Collection" },
                  { value: "rabbit", label: "Rabbit 导出文件" },
                ]}
                onChange={setImportFormat}
                data-testid="select-import-format"
              />
            </div>
            <div className="flex-1">
              <label className="block text-[13px] mb-1">来源 URL（二选一）</label>
              <Input
                value={importUrl}
                placeholder="https://petstore.example.com/openapi.json"
                onChange={(e) => setImportUrl(e.target.value)}
                data-testid="input-import-url"
              />
            </div>
          </div>
          <div>
            <label className="block text-[13px] mb-1">或粘贴文件内容（二选一）</label>
            <Input.TextArea
              rows={5}
              className="font-mono text-xs"
              placeholder='{"openapi": "3.0.0", ...}'
              value={importContent}
              onChange={(e) => setImportContent(e.target.value)}
              data-testid="input-import-content"
            />
          </div>
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <span className="text-[13px]">同名路径覆盖</span>
              <Switch
                size="small"
                checked={importOverwrite}
                onChange={setImportOverwrite}
                data-testid="switch-import-overwrite"
              />
              <span className="text-xs text-[#A8ABB0]">
                {importOverwrite ? "覆盖同名 path 定义" : "同名 path 跳过"}
              </span>
            </div>
          </div>
          <div>
            <label className="block text-[13px] mb-1">目标模块</label>
            <Select
              className="w-full"
              virtual={false}
              value={importModule ?? defaultModuleId}
              options={moduleOptions}
              onChange={setImportModule}
              data-testid="select-import-module"
            />
          </div>
        </div>
      </Modal>

      {/* 导入结果校验报告 */}
      <Modal
        title="导入结果校验报告"
        open={reportOpen}
        onCancel={() => setReportOpen(false)}
        footer={[
          <Button key="done" type="primary" onClick={() => setReportOpen(false)}>
            完成
          </Button>,
        ]}
        width={620}
      >
        {importReport && (
          <div className="space-y-4" data-testid="import-report">
            <div className="grid grid-cols-4 gap-2 text-center py-2">
              <div>
                <p className="text-2xl font-semibold text-[#52C41A]">
                  {importReport.created.length}
                </p>
                <p className="text-xs text-[#646A73] mt-1">新增</p>
              </div>
              <div>
                <p className="text-2xl font-semibold text-[#1677FF]">
                  {importReport.overwritten.length}
                </p>
                <p className="text-xs text-[#646A73] mt-1">覆盖</p>
              </div>
              <div>
                <p className="text-2xl font-semibold text-[#87888D]">
                  {importReport.skipped.length}
                </p>
                <p className="text-xs text-[#646A73] mt-1">跳过</p>
              </div>
              <div>
                <p className="text-2xl font-semibold text-[#FF4D4F]">
                  {importReport.failed.length}
                </p>
                <p className="text-xs text-[#646A73] mt-1">失败</p>
              </div>
            </div>
            {importReport.failed.length > 0 && (
              <div>
                <p className="text-xs text-[#A8ABB0] mb-1.5">失败明细（行号 + 原因）</p>
                <table className="w-full text-xs border border-[#F0F1F3] rounded">
                  <thead className="bg-[#F7F8FA] text-[#87888D]">
                    <tr>
                      <th className="p-1.5 text-left w-20">行号</th>
                      <th className="p-1.5 text-left">原因</th>
                    </tr>
                  </thead>
                  <tbody>
                    {importReport.failed.map((f, idx) => (
                      <tr key={idx} className="border-t bg-[#FF4D4F]/5">
                        <td className="p-1.5">{f.line}</td>
                        <td className="p-1.5 text-[#FF4D4F]">{f.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* cURL 导入 */}
      <Modal
        title="cURL 导入"
        open={curlOpen}
        onCancel={() => setCurlOpen(false)}
        width={640}
        footer={
          parseCurl.data
            ? [
                <Button key="back" onClick={() => parseCurl.reset()}>
                  重新解析
                </Button>,
                <Button
                  key="save"
                  type="primary"
                  loading={saveCurl.isPending}
                  disabled={!curlName.trim()}
                  onClick={() => saveCurl.mutate()}
                  data-testid="btn-curl-save"
                >
                  保存为接口
                </Button>,
              ]
            : [
                <Button key="cancel" onClick={() => setCurlOpen(false)}>
                  取消
                </Button>,
                <Button
                  key="parse"
                  type="primary"
                  loading={parseCurl.isPending}
                  disabled={curlText.trim().length < 3}
                  onClick={() => parseCurl.mutate()}
                  data-testid="btn-curl-parse"
                >
                  解析
                </Button>,
              ]
        }
      >
        <div className="space-y-3">
          <Input.TextArea
            rows={5}
            className="font-mono text-xs"
            placeholder={
              "curl -X POST 'https://httpbin.org/post' \\\n  -H 'Content-Type: application/json' \\\n  -d '{\"k\":\"v\"}'"
            }
            value={curlText}
            onChange={(e) => setCurlText(e.target.value)}
            data-testid="input-curl-text"
            disabled={Boolean(parseCurl.data)}
          />
          {!parseCurl.data && (
            <p className="text-xs text-[#A8ABB0]">
              粘贴完整 cURL 命令（支持 -X/-H/-d/--data-raw/-u），解析后预览并保存为接口定义。
            </p>
          )}
          {parseCurl.data && (
            <div className="space-y-3 border-t pt-3" data-testid="curl-preview">
              <div className="flex gap-2 items-center">
                <span className="text-xs text-[#A8ABB0] w-16">解析结果</span>
                <MethodTag method={parseCurl.data.method} />
                <span className="font-mono text-xs text-[#3D4350] flex-1 truncate">
                  {parseCurl.data.path}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[13px] mb-1">接口名称（可改）</label>
                  <Input
                    value={curlName}
                    maxLength={512}
                    placeholder="接口名称"
                    onChange={(e) => setCurlName(e.target.value)}
                    data-testid="input-curl-name"
                  />
                </div>
                <div>
                  <label className="block text-[13px] mb-1">目标模块</label>
                  <Select
                    className="w-full"
                    virtual={false}
                    value={curlModule ?? defaultModuleId}
                    options={moduleOptions}
                    onChange={setCurlModule}
                    data-testid="select-curl-module"
                  />
                </div>
              </div>
              <div className="border border-[#F0F1F3] rounded-md p-2.5 bg-[#F7F8FA]/60">
                <p className="text-xs text-[#A8ABB0] mb-1">请求摘要（保存后可在详情页继续编辑）</p>
                <ul className="text-xs text-[#646A73] space-y-0.5 list-disc pl-4">
                  <li>Query 参数 {parseCurl.data.request.spec.query.length} 条</li>
                  <li>Headers {parseCurl.data.request.spec.headers.length} 条</li>
                  <li>
                    请求体：
                    {parseCurl.data.request.spec.body.kind === "none"
                      ? "无"
                      : parseCurl.data.request.spec.body.kind}
                  </li>
                  <li>断言 {parseCurl.data.request.asserts.length} 条</li>
                </ul>
              </div>
            </div>
          )}
        </div>
      </Modal>
      <ApiCaseGenerateDrawer
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        projectId={projectId ?? ""}
        target={aiTarget}
        onImported={async (items) => {
          // 导入绑定目标定义（单条=该定义；批量=当前选中定义——AI-003 §6 登记简化，不自动建定义）
          if (!aiTarget) {
            message.warning("请先在列表行操作选择目标接口定义");
            return 0;
          }
          let ok = 0;
          for (const it of items) {
            try {
              await apiCaseApi.create(projectId!, aiTarget.id, {
                name: it.name,
                request: it.request as unknown as Parameters<
                  typeof apiCaseApi.create
                >[2]["request"],
              });
              ok++;
            } catch (e) {
              message.error(`${it.name}：${e instanceof Error ? e.message : "导入失败"}`);
            }
          }
          invalidateApis();
          return ok;
        }}
      />
    </div>
  );
}

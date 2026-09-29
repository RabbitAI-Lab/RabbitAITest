"use client";

import {
  Button,
  Drawer,
  Empty,
  Input,
  InputNumber,
  Modal,
  Select,
  Switch,
  Table,
  Tabs,
  Tag,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { Copy, History, Link2, Play, Plus, Save, Trash2 } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  ApiError,
  apiApi,
  apiCaseApi,
  mockApi,
  type ApiCaseRow,
  type ApiRow,
  type MockRow,
} from "@rabbit/api-client";
import type { HttpMethod } from "@rabbit/shared";
import { MethodTag } from "@rabbit/ui";
import { useProjectStore } from "@/stores/project";
import { usePermissions } from "@/hooks/usePermissions";
import { useApp } from "@/hooks/useApp";
import { ChangeTimeline } from "@/components/crosscut";
import RequestEditor, { type RequestBundle } from "@/components/api/RequestEditor";
import EnvSelect from "@/components/api/EnvSelect";

/** API-002/003/005 定义详情：头部 + API/CASE/MOCK 三页签。 */

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
const levelColor: Record<string, string> = { P0: "red", P1: "orange", P2: "blue", P3: "default" };
const CASE_STATUS: Record<string, { label: string; color: string }> = {
  PREPARE: { label: "未执行", color: "#A8ABB0" },
  UNDERWAY: { label: "正常", color: "#52C41A" },
  COMPLETED: { label: "已完成", color: "#52C41A" },
};
const TASK_STATUS_TAG: Record<string, string> = {
  SUCCESS: "success",
  FAILED: "error",
  RUNNING: "processing",
  PENDING: "default",
  STOPPED: "warning",
};

/** 兜底初始化（老数据缺省字段时不崩） */
function normalizeBundle(r: ApiRow["request"]): RequestBundle {
  return {
    spec: {
      ...r.spec,
      headers: r.spec.headers ?? [],
      query: r.spec.query ?? [],
    },
    asserts: r.asserts ?? [],
    pre: r.pre ?? [],
    post: r.post ?? [],
    extracts: r.extracts ?? [],
  };
}

/** 本地分区 diff：对比定义与用例的 query/headers/auth/body/pre/post/asserts/extracts JSON 串差异 */
function sectionDiff(def: RequestBundle, cs: RequestBundle) {
  const pairs: { label: string; d: unknown; c: unknown }[] = [
    { label: "Query 参数", d: def.spec.query, c: cs.spec.query },
    { label: "Headers", d: def.spec.headers, c: cs.spec.headers },
    { label: "认证", d: def.spec.auth, c: cs.spec.auth },
    { label: "请求体", d: def.spec.body, c: cs.spec.body },
    { label: "前置", d: def.pre, c: cs.pre },
    { label: "后置", d: def.post, c: cs.post },
    { label: "断言", d: def.asserts, c: cs.asserts },
    { label: "提取", d: def.extracts, c: cs.extracts },
  ];
  return pairs
    .filter((p) => JSON.stringify(p.d) !== JSON.stringify(p.c))
    .map((p) => ({
      label: p.label,
      def: JSON.stringify(p.d, null, 2),
      cs: JSON.stringify(p.c, null, 2),
    }));
}

// ══════════════════════════ CASE 页签 ══════════════════════════

function CaseTab({
  projectId,
  apiId,
  definition,
  envId,
}: {
  projectId: string;
  apiId: string;
  definition: ApiRow;
  envId?: string;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const { message, modal } = useApp();
  const { can } = usePermissions();
  const canUpdate = can("PROJECT_API:UPDATE");
  const canDelete = can("PROJECT_API:DELETE");

  const [level, setLevel] = useState<string>();
  const [status, setStatus] = useState<string>();
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<React.Key[]>([]);
  const selectedIds = selected.map(String);

  const caseQuery = {
    page,
    pageSize: 20,
    ...(level ? { level } : {}),
    ...(status ? { status } : {}),
  };
  const casesQ = useQuery({
    queryKey: ["api-cases", projectId, apiId, JSON.stringify(caseQuery)],
    queryFn: () => apiCaseApi.list(projectId, apiId, caseQuery),
    enabled: Boolean(projectId && apiId),
  });
  const rows = casesQ.data?.items ?? [];
  const invalidate = () => void qc.invalidateQueries({ queryKey: ["api-cases", projectId, apiId] });

  // ── 新建用例 ──
  const [newOpen, setNewOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newLevel, setNewLevel] = useState("P2");
  const [newStatus, setNewStatus] = useState("UNDERWAY");
  const [newTags, setNewTags] = useState<string[]>([]);
  const create = useMutation({
    mutationFn: () =>
      apiCaseApi.create(projectId, apiId, {
        name: newName.trim(),
        level: newLevel,
        status: newStatus,
        tags: newTags,
        request: normalizeBundle(definition.request), // 基线 = 定义当前已保存请求
      }),
    onSuccess: (r) => {
      setNewOpen(false);
      invalidate();
      message.success(`用例已创建（#${r.num}，以定义请求为基线）`);
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "创建失败"),
  });

  // ── 执行（单条 / 批量）──
  const execute = useMutation({
    mutationFn: (body: { caseIds: string[]; envId?: string; stopOnFail?: boolean }) =>
      apiCaseApi.execute(projectId, apiId, body),
    onSuccess: ({ taskId }, { caseIds }) => {
      invalidate();
      if (caseIds.length === 1) {
        router.push(`/reports/${taskId}`);
      } else {
        message.success("任务已提交，跳转任务中心");
        router.push("/tasks");
      }
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "提交执行失败"),
  });
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchEnv, setBatchEnv] = useState<string | undefined>(envId);
  const [batchStop, setBatchStop] = useState(false);

  // ── 删除 / 批量删除 ──
  const remove = useMutation({
    mutationFn: (caseId: string) => apiCaseApi.remove(projectId, apiId, caseId),
    onSuccess: () => {
      invalidate();
      message.success("用例已删除");
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "删除失败"),
  });
  const batchDelete = useMutation({
    mutationFn: () => apiCaseApi.batchDelete(projectId, apiId, selectedIds),
    onSuccess: (r) => {
      setSelected([]);
      invalidate();
      message.success(`已删除 ${r.deleted} 条`);
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "批量删除失败"),
  });

  // ── 同步（行内链接 + diff 视图内覆盖按钮共用）──
  const sync = useMutation({
    mutationFn: (caseId: string) => apiCaseApi.sync(projectId, apiId, caseId),
    onSuccess: (r) => {
      invalidate();
      setEditCase(null);
      message.success(`已同步至定义 v${r.syncedVersion}（名称/等级/标签保留）`);
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "同步失败"),
  });

  // ── 执行历史抽屉 ──
  const [historyCase, setHistoryCase] = useState<ApiCaseRow | null>(null);
  const historyQ = useQuery({
    queryKey: ["api-case-history", projectId, apiId, historyCase?.id],
    queryFn: () => apiCaseApi.history(projectId, apiId, historyCase!.id),
    enabled: Boolean(historyCase),
  });

  // ── 编辑抽屉（RequestEditor compact + 可选 diff 视图）──
  const [editCase, setEditCase] = useState<ApiCaseRow | null>(null);
  const [editBundle, setEditBundle] = useState<RequestBundle | null>(null);
  const [editForm, setEditForm] = useState<{
    name: string;
    level: string;
    status: string;
    tags: string[];
  }>({
    name: "",
    level: "P2",
    status: "UNDERWAY",
    tags: [],
  });
  const [diffOpen, setDiffOpen] = useState(false);
  useEffect(() => {
    if (editCase) {
      setEditBundle(normalizeBundle(editCase.request));
      setEditForm({
        name: editCase.name,
        level: editCase.level,
        status: editCase.status,
        tags: editCase.tags,
      });
      setDiffOpen(false);
    }
  }, [editCase]);
  const update = useMutation({
    mutationFn: () =>
      apiCaseApi.update(projectId, apiId, editCase!.id, {
        name: editForm.name.trim(),
        level: editForm.level,
        status: editForm.status,
        tags: editForm.tags,
        request: editBundle!,
        version: editCase!.version,
      }),
    onSuccess: () => {
      invalidate();
      setEditCase(null);
      message.success("用例已保存");
    },
    onError: (e) =>
      message.error(
        e instanceof ApiError && (e.status === 409 || e.code === 20409)
          ? "内容已被他人修改，请刷新后重试"
          : e instanceof Error
            ? e.message
            : "保存失败",
      ),
  });
  const diffs =
    editBundle && editCase?.outOfSync
      ? sectionDiff(normalizeBundle(definition.request), editBundle)
      : [];

  const columns: ColumnsType<ApiCaseRow> = [
    {
      title: "名称",
      dataIndex: "name",
      render: (name: string, r, i) => (
        <span data-testid={`case-name-${i + 1}`}>
          <span className="text-[#1F2329] font-medium">{name}</span>{" "}
          <span className="text-[#A8ABB0] text-xs">#{r.num}</span>
        </span>
      ),
    },
    {
      title: "等级",
      dataIndex: "level",
      width: 68,
      render: (l: string) => (
        <Tag bordered={false} color={levelColor[l]}>
          {l}
        </Tag>
      ),
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 88,
      render: (s: string) => (
        <span className="text-[13px]" style={{ color: CASE_STATUS[s]?.color ?? "#646A73" }}>
          <span
            className="inline-block w-2 h-2 rounded-full mr-1.5 align-middle"
            style={{ background: CASE_STATUS[s]?.color ?? "#646A73" }}
          />
          {CASE_STATUS[s]?.label ?? s}
        </span>
      ),
    },
    {
      title: "标签",
      dataIndex: "tags",
      width: 160,
      render: (tags: string[]) =>
        tags.length ? (
          tags.map((t) => (
            <Tag key={t} bordered={false}>
              {t}
            </Tag>
          ))
        ) : (
          <span className="text-[#C0C4CC]">—</span>
        ),
    },
    {
      title: "同步态",
      dataIndex: "outOfSync",
      width: 120,
      render: (oos: boolean, r, i) =>
        oos ? (
          <span
            data-testid={`case-out-of-sync-${i + 1}`}
            className="inline-flex items-center gap-1 text-[#FA8C16]"
          >
            <span className="w-2 h-2 rounded-full bg-[#FA8C16]" />
            待同步
            <Button
              type="link"
              size="small"
              className="!px-1"
              onClick={() => sync.mutate(r.id)}
              data-testid={`btn-sync-case-${i + 1}`}
            >
              同步
            </Button>
          </span>
        ) : (
          <span className="text-[#C0C4CC]">—</span>
        ),
    },
    {
      title: "操作",
      key: "ops",
      width: 210,
      render: (_, r) => (
        <span className="flex items-center gap-1">
          <Button
            type="link"
            size="small"
            className="!px-0"
            loading={
              execute.isPending &&
              execute.variables?.caseIds.length === 1 &&
              execute.variables?.caseIds[0] === r.id
            }
            onClick={() => execute.mutate({ caseIds: [r.id], envId })}
          >
            执行
          </Button>
          <span className="text-[#E5E6EB]">|</span>
          <Button
            type="link"
            size="small"
            className="!px-0"
            onClick={() => setHistoryCase(r)}
            data-testid={`btn-case-history-${r.num}`}
          >
            历史
          </Button>
          <span className="text-[#E5E6EB]">|</span>
          {canUpdate && (
            <>
              <Button
                type="link"
                size="small"
                className="!px-0"
                onClick={() => setEditCase(r)}
                data-testid={`btn-edit-case-${r.num}`}
              >
                编辑
              </Button>
              <span className="text-[#E5E6EB]">|</span>
            </>
          )}
          {canDelete && (
            <Button
              type="link"
              size="small"
              danger
              className="!px-0"
              onClick={() =>
                modal.confirm({
                  title: `删除用例「${r.name}」？`,
                  okText: "删除",
                  okButtonProps: { danger: true },
                  onOk: () => remove.mutateAsync(r.id),
                })
              }
              data-testid={`btn-del-case-${r.num}`}
            >
              删除
            </Button>
          )}
        </span>
      ),
    },
  ];

  return (
    <div className="p-3">
      {/* 工具条：新建/批量执行/批量删除 + 等级/状态筛选 */}
      <div className="flex items-center gap-2 mb-3 flex-wrap text-[13px]">
        {canUpdate && (
          <Button
            type="primary"
            size="small"
            icon={<Plus size={13} />}
            onClick={() => {
              setNewName(`${definition.name}-`);
              setNewLevel("P2");
              setNewStatus("UNDERWAY");
              setNewTags([]);
              setNewOpen(true);
            }}
            data-testid="btn-new-case"
          >
            新建用例
          </Button>
        )}
        <Button
          size="small"
          icon={<Play size={13} />}
          disabled={selected.length === 0}
          onClick={() => {
            setBatchEnv(envId);
            setBatchStop(false);
            setBatchOpen(true);
          }}
          data-testid="btn-batch-exec"
        >
          批量执行
        </Button>
        {canDelete && (
          <Button
            size="small"
            danger
            disabled={selected.length === 0}
            onClick={() =>
              modal.confirm({
                title: `删除勾选的 ${selectedIds.length} 条用例？`,
                okText: "删除",
                okButtonProps: { danger: true },
                onOk: () => batchDelete.mutateAsync(),
              })
            }
            data-testid="btn-batch-delete"
          >
            批量删除
          </Button>
        )}
        <span className="ml-auto flex items-center gap-2">
          <Select
            className="w-28"
            allowClear
            virtual={false}
            placeholder="全部等级"
            value={level}
            options={["P0", "P1", "P2", "P3"].map((l) => ({ value: l, label: `等级 ${l}` }))}
            onChange={(v) => {
              setLevel(v);
              setPage(1);
            }}
            data-testid="select-case-level"
          />
          <Select
            className="w-28"
            allowClear
            virtual={false}
            placeholder="全部状态"
            value={status}
            options={Object.entries(CASE_STATUS).map(([v, o]) => ({ value: v, label: o.label }))}
            onChange={(v) => {
              setStatus(v);
              setPage(1);
            }}
            data-testid="select-case-status"
          />
        </span>
      </div>

      {/* 用例表格 */}
      <Table<ApiCaseRow>
        rowKey="id"
        size="small"
        loading={casesQ.isLoading}
        dataSource={rows}
        data-testid="case-list-table"
        rowSelection={{ selectedRowKeys: selected, onChange: setSelected }}
        pagination={{
          current: page,
          pageSize: 20,
          total: casesQ.data?.total ?? 0,
          onChange: (p) => {
            setPage(p);
            setSelected([]);
          },
          showTotal: (t) => `共 ${t} 条`,
        }}
        locale={{
          emptyText: (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                <span>
                  暂无接口用例，「新建用例」默认复制定义当前请求为基线
                  <br />
                  （定义更新后可在同步态列一键对齐）
                </span>
              }
            />
          ),
        }}
        columns={columns}
        onRow={(_, i) =>
          ({ "data-testid": `case-row-${(i ?? 0) + 1}` }) as React.HTMLAttributes<ApiCaseRow>
        }
      />

      {/* 新建用例 */}
      <Modal
        title="新建接口用例"
        open={newOpen}
        onCancel={() => setNewOpen(false)}
        okText="创建"
        cancelText="取消"
        okButtonProps={{ disabled: !newName.trim() }}
        confirmLoading={create.isPending}
        onOk={() => create.mutate()}
      >
        <div className="space-y-3">
          <div>
            <label className="block text-[13px] mb-1">用例名称</label>
            <Input
              value={newName}
              maxLength={512}
              placeholder="如：查询宠物-正常路径"
              onChange={(e) => setNewName(e.target.value)}
              data-testid="input-new-case-name"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[13px] mb-1">等级</label>
              <Select
                className="w-full"
                value={newLevel}
                options={["P0", "P1", "P2", "P3"].map((l) => ({ value: l, label: l }))}
                onChange={setNewLevel}
                data-testid="select-new-case-level"
              />
            </div>
            <div>
              <label className="block text-[13px] mb-1">状态</label>
              <Select
                className="w-full"
                value={newStatus}
                options={Object.entries(CASE_STATUS).map(([v, o]) => ({
                  value: v,
                  label: o.label,
                }))}
                onChange={setNewStatus}
                data-testid="select-new-case-status"
              />
            </div>
          </div>
          <div>
            <label className="block text-[13px] mb-1">标签（回车添加）</label>
            <Select
              className="w-full"
              mode="tags"
              allowClear
              value={newTags}
              onChange={setNewTags}
              data-testid="select-new-case-tags"
            />
          </div>
          <p className="text-xs text-[#A8ABB0]">
            基线 = 定义当前已保存请求，创建后可在编辑抽屉改任意区。
          </p>
        </div>
      </Modal>

      {/* 批量执行 */}
      <Modal
        title="批量执行"
        open={batchOpen}
        onCancel={() => setBatchOpen(false)}
        okText="提交执行"
        cancelText="取消"
        confirmLoading={execute.isPending}
        onOk={() =>
          execute.mutate({ caseIds: selectedIds, envId: batchEnv, stopOnFail: batchStop })
        }
      >
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="w-20 text-right text-[#646A73]">执行环境</span>
            <EnvSelect className="flex-1" value={batchEnv} onChange={setBatchEnv} />
          </div>
          <div className="flex items-center gap-2">
            <span className="w-20 text-right text-[#646A73]">失败停止</span>
            <Switch
              size="small"
              checked={batchStop}
              onChange={setBatchStop}
              data-testid="switch-stop-on-fail"
            />
            <span className="text-xs text-[#A8ABB0]">开启后首个失败 item 后余项 SKIPPED</span>
          </div>
          <p className="text-[#646A73] bg-[#F7F8FA] border border-[#F0F1F3] rounded px-2.5 py-2 text-[13px]">
            已勾选 <b>{selectedIds.length}</b> 条 · 串行执行（提交后跳任务中心，报告可回看）
          </p>
        </div>
      </Modal>

      {/* 执行历史抽屉 */}
      <Drawer
        title={`执行历史 · ${historyCase?.name ?? ""}`}
        open={Boolean(historyCase)}
        onClose={() => setHistoryCase(null)}
        width={560}
      >
        {(historyQ.data?.items ?? []).length === 0 && (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无执行记录" />
        )}
        <div className="divide-y divide-[#F0F1F3]">
          {(historyQ.data?.items ?? []).map((h) => (
            <div key={h.itemId} className="flex items-center gap-3 py-2.5 text-[13px]">
              <Tag color={TASK_STATUS_TAG[h.taskStatus] ?? "default"}>{h.taskStatus}</Tag>
              <span className="text-[#646A73]">{h.itemStatus}</span>
              <span className="text-[#A8ABB0] text-xs">
                {h.durationMs != null ? `耗时 ${(h.durationMs / 1000).toFixed(1)}s` : "耗时 —"}
              </span>
              <span className="ml-auto text-[#A8ABB0] text-xs">
                {h.createdAt.replace("T", " ").slice(0, 16)}
              </span>
              <a className="text-[#574BFF]" href={`/reports/${h.taskId}`}>
                查看报告
              </a>
            </div>
          ))}
        </div>
      </Drawer>

      {/* 用例编辑抽屉（头部 + RequestEditor compact + 可选 diff） */}
      <Drawer
        title={`用例编辑 · ${editCase?.name ?? ""}`}
        open={Boolean(editCase)}
        onClose={() => setEditCase(null)}
        width={880}
        destroyOnHidden
        footer={
          <div className="flex justify-end gap-2">
            <Button onClick={() => setEditCase(null)}>取 消</Button>
            <Button
              type="primary"
              icon={<Save size={13} />}
              loading={update.isPending}
              disabled={!editForm.name.trim()}
              onClick={() => update.mutate()}
              data-testid="btn-save-case"
            >
              保 存
            </Button>
          </div>
        }
      >
        {editCase && editBundle && (
          <div className="space-y-3">
            {/* 头部：名称/等级/状态/标签 */}
            <div className="flex gap-2 items-center flex-wrap text-[13px]">
              <span className="text-[#646A73] w-10 text-right">名称</span>
              <Input
                className="w-60"
                value={editForm.name}
                maxLength={512}
                onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                data-testid="input-edit-case-name"
              />
              <span className="text-[#646A73] w-10 text-right">等级</span>
              <Select
                className="w-20"
                value={editForm.level}
                options={["P0", "P1", "P2", "P3"].map((l) => ({ value: l, label: l }))}
                onChange={(level) => setEditForm((f) => ({ ...f, level }))}
                data-testid="select-edit-case-level"
              />
              <span className="text-[#646A73] w-10 text-right">状态</span>
              <Select
                className="w-24"
                value={editForm.status}
                options={Object.entries(CASE_STATUS).map(([v, o]) => ({
                  value: v,
                  label: o.label,
                }))}
                onChange={(status) => setEditForm((f) => ({ ...f, status }))}
                data-testid="select-edit-case-status"
              />
              <span className="text-[#646A73] w-10 text-right">标签</span>
              <Select
                className="w-56"
                mode="tags"
                allowClear
                value={editForm.tags}
                onChange={(tags) => setEditForm((f) => ({ ...f, tags }))}
                data-testid="select-edit-case-tags"
              />
            </div>

            {/* 同步态提示 + diff 视图入口 */}
            {editCase.outOfSync && (
              <div className="flex items-center gap-3 border border-[#FA8C16]/40 bg-[#FA8C16]/5 rounded-md px-3 py-2 text-[13px]">
                <span className="inline-flex items-center gap-1 text-[#FA8C16]">
                  <span className="w-2 h-2 rounded-full bg-[#FA8C16]" />
                  定义已更新（用例基线 v{editCase.syncedVersion} → 定义 v{definition.version}）
                </span>
                <Button
                  type="link"
                  size="small"
                  className="!px-1"
                  onClick={() => setDiffOpen((v) => !v)}
                  data-testid="btn-view-diff"
                >
                  {diffOpen ? "收起差异" : "查看与定义差异"}
                </Button>
                <Button
                  className="ml-auto"
                  size="small"
                  type="primary"
                  loading={sync.isPending}
                  onClick={() =>
                    modal.confirm({
                      title: `以定义最新 v${definition.version} 覆盖用例「${editCase.name}」的请求？`,
                      content: "操作不可撤销；名称/等级/标签保留。",
                      okText: "确定覆盖",
                      onOk: () => sync.mutateAsync(editCase.id),
                    })
                  }
                  data-testid="btn-sync-overwrite"
                >
                  以定义覆盖本用例
                </Button>
              </div>
            )}
            {editCase.outOfSync && diffOpen && (
              <div
                className="border border-[#E5E6EB] rounded-md overflow-hidden"
                data-testid="case-diff-panel"
              >
                <div className="grid grid-cols-2 divide-x divide-[#F0F1F3]">
                  <div className="px-3 py-2 bg-[#F7F8FA] border-b border-[#F0F1F3] font-medium text-[#646A73]">
                    定义最新 · v{definition.version}
                  </div>
                  <div className="px-3 py-2 bg-[#F7F8FA] border-b border-[#F0F1F3] font-medium text-[#646A73]">
                    用例当前 · 基线 v{editCase.syncedVersion}
                  </div>
                </div>
                {diffs.length === 0 ? (
                  <p className="p-3 text-xs text-[#A8ABB0]">
                    当前编辑内容与定义一致（差异已消除，保存后同步态将更新）。
                  </p>
                ) : (
                  diffs.map((d) => (
                    <div
                      key={d.label}
                      className="grid grid-cols-2 divide-x divide-[#F0F1F3] border-b border-[#F0F1F3] last:border-0"
                    >
                      <div className="p-3 bg-[#FA8C16]/5">
                        <p className="text-[13px] font-medium mb-1.5">
                          {d.label}
                          <span className="ml-2 text-xs rounded bg-[#FA8C16]/15 text-[#B87A0E] px-1.5 py-0.5 font-normal">
                            定义
                          </span>
                        </p>
                        <pre className="font-mono text-xs leading-5 text-[#646A73] whitespace-pre-wrap break-all m-0">
                          {d.def}
                        </pre>
                      </div>
                      <div className="p-3">
                        <p className="text-[13px] font-medium mb-1.5">
                          {d.label}
                          <span className="ml-2 text-xs rounded bg-[#F2F3F5] text-[#87888D] px-1.5 py-0.5 font-normal">
                            用例
                          </span>
                        </p>
                        <pre className="font-mono text-xs leading-5 text-[#646A73] whitespace-pre-wrap break-all m-0">
                          {d.cs}
                        </pre>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            <RequestEditor bundle={editBundle} onChange={setEditBundle} compact />
          </div>
        )}
      </Drawer>
    </div>
  );
}

// ══════════════════════════ MOCK 页签 ══════════════════════════

interface MockFormState {
  id?: string;
  name: string;
  enabled: boolean;
  followApi: boolean;
  headers: { key: string; value: string }[];
  query: { key: string; value: string }[];
  bodyContains: string;
  status: number;
  respHeaders: { key: string; value: string }[];
  respBody: string;
  delayMs: number;
}

function emptyMockForm(): MockFormState {
  return {
    name: "",
    enabled: true,
    followApi: false,
    headers: [],
    query: [],
    bodyContains: "",
    status: 200,
    respHeaders: [],
    respBody: "",
    delayMs: 0,
  };
}

function MockTab({
  projectId,
  apiId,
  definition,
}: {
  projectId: string;
  apiId: string;
  definition: ApiRow;
}) {
  const qc = useQueryClient();
  const { message, modal } = useApp();
  const { can } = usePermissions();
  const canUpdate = can("PROJECT_API:UPDATE");

  const urlQ = useQuery({
    queryKey: ["mock-url", projectId, apiId],
    queryFn: () => mockApi.url(projectId, apiId),
    enabled: Boolean(projectId && apiId),
  });
  const mocksQ = useQuery({
    queryKey: ["mocks", projectId, apiId],
    queryFn: () => mockApi.list(projectId, apiId),
    enabled: Boolean(projectId && apiId),
  });
  const rows = mocksQ.data?.items ?? [];
  const invalidate = () => void qc.invalidateQueries({ queryKey: ["mocks", projectId, apiId] });

  async function copyUrl() {
    if (!urlQ.data?.url) return;
    try {
      await navigator.clipboard.writeText(urlQ.data.url);
      message.success("Mock 地址已复制");
    } catch {
      message.error("复制失败，请手动选择复制");
    }
  }

  const toBody = (f: MockFormState) => ({
    name: f.name.trim(),
    enabled: f.enabled,
    followApi: f.followApi,
    matchers: {
      headers: f.headers.filter((h) => h.key),
      query: f.query.filter((q) => q.key),
      ...(f.bodyContains ? { bodyContains: f.bodyContains } : {}),
    },
    response: {
      status: f.status,
      headers: f.respHeaders.filter((h) => h.key),
      body: f.respBody,
      delayMs: f.delayMs,
    },
  });

  const save = useMutation({
    mutationFn: () =>
      editForm.id
        ? mockApi.update(projectId, apiId, editForm.id, toBody(editForm))
        : mockApi.create(projectId, apiId, toBody(editForm)),
    onSuccess: () => {
      setEditOpen(false);
      invalidate();
      message.success(editForm.id ? "规则已保存（热更新生效）" : "规则已创建（热更新生效）");
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "保存失败"),
  });
  const remove = useMutation({
    mutationFn: (mockId: string) => mockApi.remove(projectId, apiId, mockId),
    onSuccess: () => {
      invalidate();
      message.success("规则已删除（禁用规则透明下线）");
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "删除失败"),
  });
  const toggle = useMutation({
    mutationFn: ({ row, enabled }: { row: MockRow; enabled: boolean }) =>
      mockApi.update(projectId, apiId, row.id, {
        name: row.name,
        enabled,
        followApi: row.followApi,
        matchers: row.matchers,
        response: row.response,
      }),
    onSuccess: () => invalidate(),
    onError: (e) => message.error(e instanceof Error ? e.message : "切换失败"),
  });

  // ── 规则编辑/新建弹窗 ──
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState<MockFormState>(emptyMockForm());
  function openEdit(row: MockRow | null) {
    setEditOpen(true);
    setEditForm(
      row
        ? {
            id: row.id,
            name: row.name,
            enabled: row.enabled,
            followApi: row.followApi,
            headers: row.matchers.headers ?? [],
            query: row.matchers.query ?? [],
            bodyContains: row.matchers.bodyContains ?? "",
            status: row.response.status,
            respHeaders: row.response.headers ?? [],
            respBody: row.response.body,
            delayMs: row.response.delayMs,
          }
        : emptyMockForm(),
    );
  }

  // ── Mock 调试弹窗 ──
  const [debugMock, setDebugMock] = useState<MockRow | null>(null);
  const [dbgQuery, setDbgQuery] = useState<{ key: string; value: string }[]>([]);
  const [dbgHeaders, setDbgHeaders] = useState<{ key: string; value: string }[]>([]);
  const [dbgResult, setDbgResult] = useState<Awaited<ReturnType<typeof mockApi.debugMock>> | null>(
    null,
  );
  const debugExec = useMutation({
    mutationFn: () =>
      mockApi.debugMock(projectId, debugMock!.id, {
        query: Object.fromEntries(dbgQuery.filter((q) => q.key).map((q) => [q.key, q.value])),
        headers: Object.fromEntries(dbgHeaders.filter((h) => h.key).map((h) => [h.key, h.value])),
      }),
    onSuccess: (r) => setDbgResult(r),
    onError: (e) => message.error(e instanceof Error ? e.message : "调试发送失败"),
  });

  const matchSummary = (r: MockRow) => {
    const conds =
      (r.matchers.headers?.length ?? 0) +
      (r.matchers.query?.length ?? 0) +
      (r.matchers.bodyContains ? 1 : 0);
    const parts = [
      ...(r.matchers.query ?? []).slice(0, 1).map((q) => `Query ${q.key}=${q.value}`),
      ...(r.matchers.headers ?? []).slice(0, 1).map((h) => `Header ${h.key}: ${h.value}`),
      ...(r.matchers.bodyContains ? ["Body 包含"] : []),
    ];
    return `${parts.join(" · ")}${parts.length ? " · " : ""}${conds} 条件`;
  };

  const columns: ColumnsType<MockRow> = [
    {
      title: "名称",
      dataIndex: "name",
      width: 150,
      render: (n: string, r) => (
        <span>
          {n}
          {!r.enabled && <span className="text-xs text-[#A8ABB0]">（禁用=透明下线）</span>}
        </span>
      ),
    },
    {
      title: "匹配摘要",
      key: "match",
      render: (_, r) => (
        <span className="text-xs">
          <MethodTag method={definition.method} />
          <span className="font-mono text-[#3D4350] ml-1">{definition.path}</span>
          <span className="text-[#A8ABB0] ml-1">+ {matchSummary(r)}</span>
        </span>
      ),
    },
    {
      title: "响应摘要",
      key: "resp",
      render: (_, r) =>
        r.followApi ? (
          <span className="text-xs">
            <span className="rounded bg-[#574BFF]/10 text-[#574BFF] px-1.5 py-0.5">跟随 API</span>
            <span className="text-[#A8ABB0] ml-1">· 定义默认响应</span>
          </span>
        ) : (
          <span className="font-mono text-xs text-[#646A73]">
            {r.response.status} · {r.response.body.slice(0, 40)}
            {r.response.body.length > 40 ? "…" : ""}
            {r.response.delayMs > 0 ? ` · 延迟${r.response.delayMs}ms` : ""}
          </span>
        ),
    },
    {
      title: "启用",
      dataIndex: "enabled",
      width: 72,
      render: (on: boolean, r) => (
        <Switch
          size="small"
          checked={on}
          disabled={!canUpdate || toggle.isPending}
          onChange={(enabled) => toggle.mutate({ row: r, enabled })}
        />
      ),
    },
    {
      title: "操作",
      key: "ops",
      width: 150,
      render: (_, r) => (
        <span className="flex items-center gap-1">
          <Button
            type="link"
            size="small"
            className="!px-0"
            onClick={() => {
              setDebugMock(r);
              setDbgQuery((r.matchers.query ?? []).map((q) => ({ ...q })));
              setDbgHeaders((r.matchers.headers ?? []).map((h) => ({ ...h })));
              setDbgResult(null);
            }}
            data-testid={`btn-debug-mock-${r.id}`}
          >
            调试
          </Button>
          {canUpdate && (
            <>
              <span className="text-[#E5E6EB]">|</span>
              <Button
                type="link"
                size="small"
                className="!px-0"
                onClick={() => openEdit(r)}
                data-testid={`btn-edit-mock-${r.id}`}
              >
                编辑
              </Button>
              <span className="text-[#E5E6EB]">|</span>
              <Button
                type="link"
                size="small"
                danger
                className="!px-0"
                onClick={() =>
                  modal.confirm({
                    title: `删除 Mock 规则「${r.name}」？`,
                    okText: "删除",
                    okButtonProps: { danger: true },
                    onOk: () => remove.mutateAsync(r.id),
                  })
                }
                data-testid={`btn-del-mock-${r.id}`}
              >
                删除
              </Button>
            </>
          )}
        </span>
      ),
    },
  ];

  const kvEditor = (
    rows: { key: string; value: string }[],
    setRows: (r: { key: string; value: string }[]) => void,
    keyPh: string,
  ) => (
    <div className="space-y-1.5">
      {rows.map((kv, i) => (
        <div key={i} className="flex gap-2 items-center">
          <Input
            className="w-32"
            placeholder={keyPh}
            value={kv.key}
            onChange={(e) =>
              setRows(rows.map((x, idx) => (idx === i ? { ...x, key: e.target.value } : x)))
            }
          />
          <Input
            className="flex-1 font-mono text-xs"
            placeholder="value"
            value={kv.value}
            onChange={(e) =>
              setRows(rows.map((x, idx) => (idx === i ? { ...x, value: e.target.value } : x)))
            }
          />
          <Button
            type="text"
            size="small"
            className="!text-[#A8ABB0]"
            onClick={() => setRows(rows.filter((_, idx) => idx !== i))}
          >
            ✕
          </Button>
        </div>
      ))}
      <Button
        type="link"
        size="small"
        className="!px-0"
        onClick={() => setRows([...rows, { key: "", value: "" }])}
      >
        ＋ 添加
      </Button>
    </div>
  );

  return (
    <div className="p-3 space-y-3">
      {/* Mock 地址卡 */}
      <div
        className="border border-[#E5E6EB] rounded-md p-3 flex items-center gap-3 flex-wrap"
        data-testid="mock-url-box"
      >
        <span className="inline-flex items-center gap-1.5 text-[#52C41A] text-[13px] font-medium">
          <span className="w-2 h-2 rounded-full bg-[#52C41A]" />
          Mock 服务
        </span>
        <span className="font-mono text-[13px] bg-[#F7F8FA] border border-[#F0F1F3] rounded px-2 py-1.5">
          {urlQ.data?.url ?? (urlQ.isLoading ? "加载中…" : "—")}
        </span>
        <Button
          size="small"
          icon={<Copy size={12} />}
          onClick={() => void copyUrl()}
          data-testid="btn-copy-mock-url"
        >
          复制
        </Button>
        <span className="text-xs text-[#A8ABB0]">
          地址 = {"{MOCK_PUBLIC_URL}"}/mock/{urlQ.data?.apiPath ?? definition.path} · 保存即热更新
        </span>
      </div>

      {/* 规则表格 */}
      <div className="border border-[#E5E6EB] rounded-md overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-[#F0F1F3] flex-wrap">
          {canUpdate && (
            <Button
              type="primary"
              size="small"
              icon={<Plus size={13} />}
              onClick={() => openEdit(null)}
              data-testid="btn-new-mock"
            >
              新建规则
            </Button>
          )}
          <span className="text-xs text-[#A8ABB0]">
            命中语义：多规则按「匹配条件最多者」优先；未命中 404 · code 40401 · 禁用规则透明下线
          </span>
        </div>
        <Table<MockRow>
          rowKey="id"
          size="small"
          loading={mocksQ.isLoading}
          dataSource={rows}
          data-testid="mock-rule-table"
          pagination={false}
          columns={columns}
          locale={{
            emptyText: (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  <span>
                    暂无 Mock 规则，「新建规则」创建
                    <br />
                    开启「跟随 API」可直接复用定义默认响应
                  </span>
                }
              />
            ),
          }}
        />
      </div>

      {/* 规则编辑/新建弹窗 */}
      <Modal
        title={editForm.id ? "编辑 Mock 规则" : "新建 Mock 规则"}
        open={editOpen}
        onCancel={() => setEditOpen(false)}
        okText="保 存"
        cancelText="取 消"
        confirmLoading={save.isPending}
        okButtonProps={{ disabled: !editForm.name.trim() }}
        onOk={() => save.mutate()}
        width={760}
      >
        <div className="grid grid-cols-2 gap-3">
          {/* 匹配区 */}
          <div className="border border-[#F0F1F3] rounded-md">
            <p className="px-3 py-2 bg-[#F7F8FA] border-b border-[#F0F1F3] font-medium text-[13px]">
              匹配条件（{definition.method} {definition.path}）
            </p>
            <div className="p-2.5 space-y-2">
              <div>
                <Input
                  placeholder="规则名称（如：狗查询）"
                  value={editForm.name}
                  maxLength={256}
                  onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                  data-testid="input-mock-name"
                />
              </div>
              <p className="text-[#646A73] font-medium text-[13px] pt-1">请求头 KV</p>
              {kvEditor(
                editForm.headers,
                (headers) => setEditForm((f) => ({ ...f, headers })),
                "X-Api-Version",
              )}
              <p className="text-[#646A73] font-medium text-[13px] pt-1">Query KV</p>
              {kvEditor(editForm.query, (query) => setEditForm((f) => ({ ...f, query })), "kind")}
              <p className="text-[#646A73] font-medium text-[13px] pt-1">请求体包含</p>
              <Input.TextArea
                rows={2}
                className="font-mono text-xs"
                placeholder="留空 = 不校验请求体"
                value={editForm.bodyContains}
                onChange={(e) => setEditForm((f) => ({ ...f, bodyContains: e.target.value }))}
              />
            </div>
          </div>
          {/* 响应区 */}
          <div className="border border-[#F0F1F3] rounded-md">
            <p className="px-3 py-2 bg-[#F7F8FA] border-b border-[#F0F1F3] font-medium text-[13px]">
              响应{editForm.followApi ? "（跟随 API）" : ""}
            </p>
            <div
              className={`p-2.5 space-y-2 ${editForm.followApi ? "bg-[#F7F8FA] opacity-60 pointer-events-none" : ""}`}
            >
              <div className="flex items-center gap-2">
                <span className="text-[#646A73] w-14 text-[13px]">状态码</span>
                <InputNumber
                  className="w-20"
                  min={100}
                  max={599}
                  value={editForm.status}
                  onChange={(v) => setEditForm((f) => ({ ...f, status: v ?? 200 }))}
                  data-testid="input-mock-status"
                />
              </div>
              <p className="text-[#646A73] font-medium text-[13px] pt-1">响应头 KV</p>
              {kvEditor(
                editForm.respHeaders,
                (respHeaders) => setEditForm((f) => ({ ...f, respHeaders })),
                "Content-Type",
              )}
              <p className="text-[#646A73] font-medium text-[13px] pt-1">响应体</p>
              <Input.TextArea
                rows={4}
                className="font-mono text-xs leading-5"
                placeholder='{"code": 0}'
                value={editForm.respBody}
                onChange={(e) => setEditForm((f) => ({ ...f, respBody: e.target.value }))}
              />
              <div className="flex items-center gap-2">
                <span className="text-[#646A73] text-[13px]">延迟</span>
                <InputNumber
                  className="w-20"
                  min={0}
                  max={10000}
                  value={editForm.delayMs}
                  onChange={(v) => setEditForm((f) => ({ ...f, delayMs: v ?? 0 }))}
                />
                <span className="text-[#646A73] text-[13px]">ms</span>
                <span className="text-xs text-[#A8ABB0]">≤10000 · 响应前 sleep</span>
              </div>
            </div>
            <div className="px-2.5 py-2.5 flex items-center gap-2 border-t border-[#F0F1F3]">
              <span className="text-[#646A73] text-[13px]">跟随 API</span>
              <Switch
                size="small"
                checked={editForm.followApi}
                onChange={(followApi) => setEditForm((f) => ({ ...f, followApi }))}
                data-testid="switch-mock-follow-api"
              />
              <span className="text-xs text-[#A8ABB0]">
                {editForm.followApi
                  ? "已开启：将返回接口定义的默认响应"
                  : "关闭 · 使用左侧自定义响应"}
              </span>
            </div>
          </div>
        </div>
      </Modal>

      {/* Mock 调试弹窗 */}
      <Modal
        title={`Mock 调试 · ${debugMock?.name ?? ""}`}
        open={Boolean(debugMock)}
        onCancel={() => setDebugMock(null)}
        footer={null}
        width={720}
      >
        {debugMock && (
          <div className="space-y-3">
            <p className="text-xs text-[#A8ABB0]">
              web 服务端代发（避免浏览器跨域）· 可改 Query / 头后发送
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-[#646A73] font-medium text-[13px] mb-1.5">Query</p>
                {kvEditor(dbgQuery, setDbgQuery, "kind")}
              </div>
              <div>
                <p className="text-[#646A73] font-medium text-[13px] mb-1.5">请求头</p>
                {kvEditor(dbgHeaders, setDbgHeaders, "X-Debug")}
              </div>
            </div>
            <div className="flex justify-end">
              <Button
                type="primary"
                loading={debugExec.isPending}
                onClick={() => debugExec.mutate()}
                data-testid="btn-send-mock-debug"
              >
                发 送
              </Button>
            </div>
            {dbgResult && (
              <div
                className={`border rounded-md overflow-hidden ${dbgResult.matched ? "border-[#52C41A]/40" : "border-[#E5E6EB]"}`}
                data-testid="mock-debug-result"
              >
                <div
                  className={`px-3 py-2 border-b text-[13px] font-medium flex items-center gap-2 ${dbgResult.matched ? "bg-[#52C41A]/10 text-[#389E0D]" : "bg-[#F7F8FA] text-[#646A73]"}`}
                >
                  {dbgResult.matched ? (
                    <span>✓ 命中规则：{dbgResult.ruleName}</span>
                  ) : (
                    <span>✗ 无匹配 Mock 规则</span>
                  )}
                  {dbgResult.matched && (
                    <span className="ml-auto text-xs font-normal">
                      HTTP {dbgResult.response.status}
                      {dbgResult.response.delayMs > 0
                        ? ` · 延迟 ${dbgResult.response.delayMs}ms`
                        : ""}
                    </span>
                  )}
                </div>
                {dbgResult.matched ? (
                  <pre className="p-3 font-mono text-xs leading-5 text-[#646A73] whitespace-pre-wrap break-all m-0">
                    {dbgResult.response.headers
                      .filter((h) => h.key)
                      .map((h) => `${h.key}: ${h.value}`)
                      .join("\n")}
                    {"\n\n"}
                    {dbgResult.response.body}
                  </pre>
                ) : (
                  <div className="p-3 space-y-2">
                    <pre className="font-mono text-xs leading-5 text-[#A8ABB0] m-0">
                      {`{\n  "code": 40401,\n  "message": "无匹配 Mock 规则"\n}`}
                    </pre>
                    {dbgResult.unmatched.length > 0 && (
                      <div>
                        <p className="text-xs text-[#87888D] mb-1">未命中条件明细（unmatched）：</p>
                        <ul className="text-xs text-[#FF4D4F] space-y-0.5 list-disc pl-4">
                          {dbgResult.unmatched.map((u, i) => (
                            <li key={i}>{u}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <p className="text-xs text-[#A8ABB0]">
                      禁用规则不参与匹配；多候选按匹配条件数最多者优先
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}

// ══════════════════════════ 详情页主体 ══════════════════════════

export default function ApiDetailPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { message, modal } = useApp();
  const { can } = usePermissions();
  const { currentProjectId } = useProjectStore();
  const projectId = currentProjectId;
  const canUpdate = can("PROJECT_API:UPDATE");
  const canDelete = can("PROJECT_API:DELETE");

  const { id } = useParams<{ id: string }>();
  const [tab, setTab] = useState("api");
  const [envId, setEnvId] = useState<string>();
  const [executing, setExecuting] = useState(false);

  const apiQ = useQuery({
    queryKey: ["apis", "detail", projectId, id],
    queryFn: () => apiApi.detail(projectId!, id),
    enabled: Boolean(projectId && id),
  });
  const api = apiQ.data;

  // 本地编辑态（从服务端初始化一次；保存成功只更新 version，不覆盖编辑中内容）
  const [bundle, setBundle] = useState<RequestBundle | null>(null);
  const [name, setName] = useState("");
  const [status, setStatus] = useState<"DEBUG" | "RELEASED">("DEBUG");
  const [response, setResponse] = useState<ApiRow["response"] | null>(null);
  const [version, setVersion] = useState(1);
  const [loadedId, setLoadedId] = useState<string | null>(null);
  useEffect(() => {
    if (api && loadedId !== api.id) {
      setLoadedId(api.id);
      setBundle(normalizeBundle(api.request));
      setName(api.name);
      setStatus(api.status);
      setResponse(api.response);
      setVersion(api.version);
    }
  }, [api, loadedId]);

  const save = useMutation({
    mutationFn: () =>
      apiApi.update(projectId!, id, {
        name: name.trim(),
        status,
        request: bundle!,
        response: response!,
        version,
      }),
    onSuccess: (r) => {
      setVersion(r.version);
      void qc.invalidateQueries({ queryKey: ["apis", "detail", projectId, id] });
      void qc.invalidateQueries({ queryKey: ["apis"] });
      message.success(`已保存（v${r.version}）`);
    },
    onError: (e) => {
      if (e instanceof ApiError && (e.status === 409 || e.code === 20409)) {
        message.error("内容已被他人修改，请刷新页面后重试");
      } else {
        message.error(e instanceof Error ? e.message : "保存失败");
      }
    },
  });

  const remove = useMutation({
    mutationFn: () => apiApi.remove(projectId!, id),
    onSuccess: () => {
      message.success("接口已删除");
      router.push("/apis");
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "删除失败"),
  });

  /** 执行：以当前编辑态（未保存也生效）+ 环境发起调试 */
  async function exec() {
    if (!projectId || !bundle) return;
    setExecuting(true);
    try {
      const { taskId } = await apiApi.debug(projectId, id, { request: bundle, envId });
      router.push(`/reports/${taskId}`);
    } catch (e) {
      message.error(e instanceof ApiError ? e.message : "提交执行失败");
    } finally {
      setExecuting(false);
    }
  }

  // ── 变更历史 / 引用关系抽屉 ──
  const [changesOpen, setChangesOpen] = useState(false);
  const changesQ = useQuery({
    queryKey: ["api-changes", projectId, id],
    queryFn: () => apiApi.changes(projectId!, id),
    enabled: Boolean(projectId && id && changesOpen),
  });
  const [refsOpen, setRefsOpen] = useState(false);
  const refsQ = useQuery({
    queryKey: ["api-references", projectId, id],
    queryFn: () => apiApi.references(projectId!, id),
    enabled: Boolean(projectId && id && refsOpen),
  });

  if (!projectId) return <Empty description="请先选择项目" />;
  if (!api || !bundle || !response)
    return (
      <div className="rabbit-card p-6 text-[13px] text-[#A8ABB0]">
        {apiQ.isLoading ? "加载中…" : "接口不存在或已删除"}
        {!apiQ.isLoading && (
          <Button type="link" href="/apis" className="ml-2">
            返回列表
          </Button>
        )}
      </div>
    );

  return (
    <div className="space-y-3">
      {/* 头部：名称 / method / path / 状态 / 环境 / 变更历史 / 引用关系 / 删除 / 保存 */}
      <div className="rabbit-card p-3 flex items-center gap-2 flex-wrap">
        <Input
          className="w-52 font-medium"
          value={name}
          maxLength={512}
          disabled={!canUpdate}
          onChange={(e) => setName(e.target.value)}
          data-testid="input-api-name"
        />
        <Select
          className="w-24"
          value={bundle.spec.method}
          disabled={!canUpdate}
          options={METHODS.map((m) => ({ value: m, label: m }))}
          onChange={(method) => setBundle({ ...bundle, spec: { ...bundle.spec, method } })}
          data-testid="select-api-method"
        />
        <Input
          className="w-72 font-mono"
          value={bundle.spec.url}
          maxLength={2048}
          disabled={!canUpdate}
          placeholder="/pets/{id} 或 ${base}/pets"
          onChange={(e) => setBundle({ ...bundle, spec: { ...bundle.spec, url: e.target.value } })}
          data-testid="input-api-path"
        />
        <Select
          className="w-24"
          value={status}
          disabled={!canUpdate}
          options={[
            { value: "DEBUG", label: "调试中" },
            { value: "RELEASED", label: "已发布" },
          ]}
          onChange={(v) => setStatus(v)}
          data-testid="select-api-status"
        />
        <span className="text-xs text-[#A8ABB0] border border-[#E5E6EB] rounded px-2 py-1">
          当前版本 v{version}
        </span>
        <span className="ml-auto flex items-center gap-2 flex-wrap">
          <EnvSelect value={envId} onChange={setEnvId} />
          <Button
            icon={<History size={14} />}
            onClick={() => setChangesOpen(true)}
            data-testid="btn-api-changes"
          >
            变更历史
          </Button>
          <Button
            icon={<Link2 size={14} />}
            onClick={() => setRefsOpen(true)}
            data-testid="btn-api-refs"
          >
            引用关系
          </Button>
          {canDelete && (
            <Button
              danger
              icon={<Trash2 size={14} />}
              onClick={() =>
                modal.confirm({
                  title: `删除接口「${name}」？`,
                  content: "其下接口用例与 Mock 规则将一并删除，操作不可恢复。",
                  okText: "删除",
                  okButtonProps: { danger: true },
                  onOk: () => remove.mutateAsync(),
                })
              }
              data-testid="btn-del-api"
            >
              删除
            </Button>
          )}
          {canUpdate && (
            <Button
              type="primary"
              icon={<Save size={14} />}
              loading={save.isPending}
              disabled={!name.trim() || !bundle.spec.url.trim()}
              onClick={() => save.mutate()}
              data-testid="btn-save-api"
            >
              保 存
            </Button>
          )}
        </span>
      </div>

      {/* 三页签 */}
      <div className="rabbit-card">
        <Tabs
          activeKey={tab}
          onChange={setTab}
          items={[
            {
              key: "api",
              label: <span data-testid="api-tab-api">API</span>,
              children: (
                <div className="flex gap-3 p-3 items-start">
                  {/* 左：统一请求编辑器（七区） */}
                  <div className="flex-1 min-w-0">
                    <RequestEditor bundle={bundle} onChange={setBundle} />
                    <p className="text-xs text-[#A8ABB0] mt-1">
                      URL 支持 ${"{var}"} 渲染；相对路径按环境域名拼接（路径条件 &gt; 模块 &gt;
                      默认）
                    </p>
                  </div>
                  {/* 右：默认响应 + 执行 */}
                  <div className="w-96 shrink-0 space-y-3">
                    <div className="border border-[#E5E6EB] rounded-md p-3">
                      <p className="font-medium mb-2 text-[13px] flex items-center gap-2">
                        默认响应
                        <span className="text-xs text-[#A8ABB0] font-normal">
                          （Mock「跟随 API」的响应源）
                        </span>
                      </p>
                      <div className="flex gap-2 items-center mb-2">
                        <span className="text-xs text-[#646A73]">状态码</span>
                        <InputNumber
                          className="w-20"
                          min={100}
                          max={599}
                          value={response.status}
                          disabled={!canUpdate}
                          onChange={(v) => setResponse({ ...response, status: v ?? 200 })}
                          data-testid="input-resp-status"
                        />
                      </div>
                      <div className="space-y-1.5 mb-2">
                        {response.headers.map((h, i) => (
                          <div key={i} className="flex gap-2 items-center">
                            <Input
                              className="w-36"
                              placeholder="Header"
                              disabled={!canUpdate}
                              value={h.key}
                              onChange={(e) =>
                                setResponse({
                                  ...response,
                                  headers: response.headers.map((x, idx) =>
                                    idx === i ? { ...x, key: e.target.value } : x,
                                  ),
                                })
                              }
                            />
                            <Input
                              className="flex-1 font-mono text-xs"
                              placeholder="value"
                              disabled={!canUpdate}
                              value={h.value}
                              onChange={(e) =>
                                setResponse({
                                  ...response,
                                  headers: response.headers.map((x, idx) =>
                                    idx === i ? { ...x, value: e.target.value } : x,
                                  ),
                                })
                              }
                            />
                            <Button
                              type="text"
                              size="small"
                              className="!text-[#A8ABB0]"
                              disabled={!canUpdate}
                              onClick={() =>
                                setResponse({
                                  ...response,
                                  headers: response.headers.filter((_, idx) => idx !== i),
                                })
                              }
                            >
                              ✕
                            </Button>
                          </div>
                        ))}
                        {canUpdate && (
                          <Button
                            type="link"
                            size="small"
                            className="!px-0"
                            onClick={() =>
                              setResponse({
                                ...response,
                                headers: [...response.headers, { key: "", value: "" }],
                              })
                            }
                          >
                            ＋ 添加 Header
                          </Button>
                        )}
                      </div>
                      <Input.TextArea
                        rows={5}
                        className="font-mono text-xs leading-5"
                        placeholder='{"code": 0, "data": {…}}'
                        disabled={!canUpdate}
                        value={response.body}
                        onChange={(e) => setResponse({ ...response, body: e.target.value })}
                        data-testid="input-resp-body"
                      />
                    </div>
                    <div className="border border-[#E5E6EB] rounded-md p-3 flex items-center gap-2">
                      <Button
                        type="primary"
                        icon={<Play size={14} />}
                        loading={executing}
                        onClick={() => void exec()}
                        data-testid="btn-exec-api"
                      >
                        执 行
                      </Button>
                      <span className="text-xs text-[#A8ABB0]">
                        以当前编辑态发起（未保存亦生效），跳转执行报告实时查看
                      </span>
                    </div>
                  </div>
                </div>
              ),
            },
            {
              key: "case",
              label: <span data-testid="api-tab-case">CASE（{api.caseCount ?? 0}）</span>,
              children: <CaseTab projectId={projectId} apiId={id} definition={api} envId={envId} />,
            },
            {
              key: "mock",
              label: <span data-testid="api-tab-mock">MOCK</span>,
              children: <MockTab projectId={projectId} apiId={id} definition={api} />,
            },
          ]}
        />
      </div>

      {/* 变更历史抽屉 */}
      <Drawer title="变更历史" open={changesOpen} onClose={() => setChangesOpen(false)} width={560}>
        <ChangeTimeline
          items={(changesQ.data?.items ?? []).map((c) => ({
            id: String(c.seq),
            seq: c.seq,
            action: c.action,
            diff: c.diff,
            userName: c.user,
            createdAt: c.createdAt,
          }))}
        />
      </Drawer>

      {/* 引用关系抽屉（三段列表） */}
      <Drawer title="引用关系" open={refsOpen} onClose={() => setRefsOpen(false)} width={560}>
        <div className="space-y-5 text-[13px]">
          <div>
            <p className="font-medium mb-2">接口用例（{(refsQ.data?.cases ?? []).length}）</p>
            {(refsQ.data?.cases ?? []).length === 0 ? (
              <p className="text-xs text-[#A8ABB0]">暂无引用</p>
            ) : (
              (refsQ.data?.cases ?? []).map((c) => (
                <div
                  key={c.id}
                  className="flex items-center gap-2 py-1.5 border-b border-[#F7F8FA] last:border-0"
                >
                  <span className="text-xs text-[#87888D]">#{c.num}</span>
                  <span className="flex-1 truncate">{c.name}</span>
                  <Tag bordered={false} color={levelColor[c.level]}>
                    {c.level}
                  </Tag>
                  <span className="text-xs text-[#A8ABB0]">{c.planCount} 计划</span>
                </div>
              ))
            )}
          </div>
          <div>
            <p className="font-medium mb-2">测试计划（{(refsQ.data?.plans ?? []).length}）</p>
            {(refsQ.data?.plans ?? []).length === 0 ? (
              <p className="text-xs text-[#A8ABB0]">暂无关联</p>
            ) : (
              (refsQ.data?.plans ?? []).map((p) => (
                <div
                  key={p.id}
                  className="flex items-center gap-2 py-1.5 border-b border-[#F7F8FA] last:border-0"
                >
                  <a className="text-[#574BFF] flex-1 truncate" href={`/plans/${p.id}`}>
                    {p.name}
                  </a>
                  <span className="text-xs text-[#A8ABB0]">引用 {p.refCount} 次</span>
                </div>
              ))
            )}
          </div>
          <div>
            <p className="font-medium mb-2">
              功能用例（{(refsQ.data?.functionalCases ?? []).length}）
            </p>
            {(refsQ.data?.functionalCases ?? []).length === 0 ? (
              <p className="text-xs text-[#A8ABB0]">暂无关联</p>
            ) : (
              (refsQ.data?.functionalCases ?? []).map((c) => (
                <div
                  key={c.id}
                  className="flex items-center gap-2 py-1.5 border-b border-[#F7F8FA] last:border-0"
                >
                  <span className="text-xs text-[#87888D]">C-{String(c.num).padStart(4, "0")}</span>
                  <a className="text-[#574BFF] flex-1 truncate" href={`/cases/${c.id}`}>
                    {c.name}
                  </a>
                </div>
              ))
            )}
          </div>
        </div>
      </Drawer>
    </div>
  );
}

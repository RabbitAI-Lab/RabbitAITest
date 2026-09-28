"use client";

import { Button, Checkbox, Empty, Input, Modal, Popconfirm, Table, Tag, Tree } from "antd";
import type { DataNode } from "antd/es/tree";
import { Plus } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  ApiError,
  apiApi,
  apiCaseApi,
  caseApiRefApi,
  moduleApi,
  type ApiCaseRow,
  type ApiRow,
} from "@rabbit/api-client";
import { MethodTag } from "@rabbit/ui";
import { useApp } from "@/hooks/useApp";

/** CASE-006：用例详情「关联」Tab——已关联接口用例列表 + 选择器弹窗（模块树 + 定义展开 CASE 勾选）。 */

const levelColor: Record<string, string> = { P0: "red", P1: "orange", P2: "blue", P3: "default" };
const CASE_STATUS_TEXT: Record<string, { label: string; color: string }> = {
  PREPARE: { label: "未开始", color: "#87888D" },
  UNDERWAY: { label: "进行中", color: "#1677FF" },
  COMPLETED: { label: "已完成", color: "#52C41A" },
};

type ModuleLike = { id: string; name: string; subtreeCount: number; children: ModuleLike[] };

function toTree(nodes: ModuleLike[]): DataNode[] {
  return nodes.map((n) => ({
    key: n.id,
    title: (
      <span className="flex items-center gap-1.5">
        <span className="truncate max-w-32">{n.name}</span>
        <span className="text-[10px] text-[#A8ABB0]">{n.subtreeCount}</span>
      </span>
    ),
    children: n.children.length ? toTree(n.children) : undefined,
  }));
}

export function ApiRefPanel({
  projectId,
  caseId,
  canUpdate,
}: {
  projectId: string;
  caseId: string;
  canUpdate: boolean;
}) {
  const qc = useQueryClient();
  const { message } = useApp();
  const [pickerOpen, setPickerOpen] = useState(false);

  const refsQ = useQuery({
    queryKey: ["case-api-refs", projectId, caseId],
    queryFn: () => caseApiRefApi.list(projectId, caseId),
  });
  const invalidate = () =>
    void qc.invalidateQueries({ queryKey: ["case-api-refs", projectId, caseId] });

  const remove = useMutation({
    mutationFn: (refId: string) => caseApiRefApi.remove(projectId, caseId, refId),
    onSuccess: () => {
      invalidate();
      message.success("已移除关联");
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "移除失败"),
  });

  const rows = refsQ.data?.items ?? [];

  return (
    <div className="rabbit-card" data-testid="case-api-refs-panel">
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-[#F0F1F3]">
        {canUpdate && (
          <Button
            type="primary"
            size="small"
            icon={<Plus size={14} />}
            onClick={() => setPickerOpen(true)}
            data-testid="btn-link-api"
          >
            关联接口用例
          </Button>
        )}
        <span className="text-xs text-[#A8ABB0]">
          关联后供追溯与 S4 计划内执行；场景用例关联为 S3 能力（refType 预留 scenario）
        </span>
      </div>

      {rows.length === 0 ? (
        <div
          className="m-3 border-2 border-dashed border-[#E5E6EB] rounded-md py-10 grid place-items-center gap-2 text-[#A8ABB0]"
          data-testid="case-api-refs-empty"
        >
          <p className="text-[13px] m-0">暂未关联接口用例，点击「关联接口用例」开始关联</p>
          <p className="text-xs m-0">支持按接口模块树筛选，勾选 CASE 级批量关联</p>
        </div>
      ) : (
        <table className="w-full text-[13px]" data-testid="case-api-refs-table">
          <thead className="text-[#87888D] text-xs bg-[#F7F8FA]">
            <tr>
              <th className="text-left font-normal p-3">接口用例</th>
              <th className="text-left font-normal p-3">所属接口</th>
              <th className="text-left font-normal p-3 w-16">等级</th>
              <th className="text-left font-normal p-3 w-24">状态</th>
              <th className="text-left font-normal p-3 w-20">操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const st = CASE_STATUS_TEXT[r.status];
              return (
                <tr
                  key={r.id}
                  className={`border-t border-[#F0F1F3] ${r.deleted ? "text-[#A8ABB0] bg-[#FAFBFC]" : ""}`}
                  data-testid="case-api-ref-row"
                >
                  <td className="p-3">
                    <span
                      className={r.deleted ? "line-through decoration-[#C9CDD4]" : "text-[#574BFF]"}
                    >
                      {r.name}
                    </span>
                    {r.deleted && (
                      <Tag className="ml-1.5" bordered={false}>
                        已删除
                      </Tag>
                    )}
                  </td>
                  <td className="p-3">
                    {r.method || r.path ? (
                      <span className="flex items-center gap-1.5 whitespace-nowrap">
                        <MethodTag method={r.method} />
                        <span className="font-mono text-xs">{r.path}</span>
                        {r.apiName && <span className="text-[#A8ABB0]">· {r.apiName}</span>}
                      </span>
                    ) : (
                      <span className="text-[#A8ABB0]">—</span>
                    )}
                  </td>
                  <td className="p-3">
                    {r.level ? <Tag color={levelColor[r.level] ?? "default"}>{r.level}</Tag> : "—"}
                  </td>
                  <td className="p-3">
                    {r.deleted || !st ? (
                      <span className="text-[#A8ABB0]">—</span>
                    ) : (
                      <span style={{ color: st.color }}>{st.label}</span>
                    )}
                  </td>
                  <td className="p-3">
                    {canUpdate && !r.deleted ? (
                      <Popconfirm title="移除该关联？" onConfirm={() => remove.mutate(r.refId)}>
                        <Button type="link" size="small" danger className="!px-0">
                          移除
                        </Button>
                      </Popconfirm>
                    ) : (
                      <span className="text-xs text-[#C9CDD4]">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <ApiRefPicker
        projectId={projectId}
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSubmit={async (refIds) => {
          const r = await caseApiRefApi.add(projectId, caseId, refIds);
          invalidate();
          message.success(`已关联 ${r.added} 条接口用例`);
        }}
      />
    </div>
  );
}

/* ── 关联选择器弹窗：左接口模块树 + 右定义列表（展开 CASE 勾选） ── */
function ApiRefPicker({
  projectId,
  open,
  onClose,
  onSubmit,
}: {
  projectId: string;
  open: boolean;
  onClose: () => void;
  onSubmit: (refIds: string[]) => Promise<void>;
}) {
  const { message } = useApp();
  const [keyword, setKeyword] = useState("");
  const [moduleId, setModuleId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (open) {
      setKeyword("");
      setModuleId(null);
      setPage(1);
      setSelected(new Set());
    }
  }, [open]);

  const modsQ = useQuery({
    queryKey: ["modules", projectId, "api"],
    queryFn: () => moduleApi.list(projectId, "api"),
    enabled: open,
  });
  const apisQ = useQuery({
    queryKey: ["picker-apis", projectId, keyword, moduleId, page, open],
    queryFn: () =>
      apiApi.list(projectId, {
        name: keyword || undefined,
        moduleId: moduleId ?? undefined,
        includeChildren: moduleId ? true : undefined,
        page,
        pageSize: 10,
      }),
    enabled: open,
  });

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const submit = useMutation({
    mutationFn: () => onSubmit([...selected]),
    onSuccess: () => onClose(),
    onError: (e) => {
      // 重复关联 10009 → 提示（服务端 422 DUP_ASSOC）
      message.error(e instanceof ApiError || e instanceof Error ? e.message : "关联失败");
    },
  });

  return (
    <Modal
      title="关联接口用例"
      open={open}
      onCancel={onClose}
      footer={null}
      width={820}
      destroyOnHidden
    >
      <div className="mt-1" data-testid="api-ref-picker">
        <Input.Search
          allowClear
          placeholder="搜索接口名称 / 用例名"
          value={keyword}
          onChange={(e) => {
            setKeyword(e.target.value);
            setPage(1);
          }}
          data-testid="api-ref-picker-search"
        />
        <div className="flex gap-3 mt-3 min-h-[320px]">
          {/* 左：接口模块树 */}
          <div className="w-56 shrink-0 border border-[#F0F1F3] rounded-md p-2 max-h-96 overflow-y-auto">
            <p className="text-xs text-[#87888D] px-1 pb-1">接口模块（scene=api）</p>
            <Tree
              blockNode
              defaultExpandAll
              selectedKeys={moduleId ? [moduleId] : []}
              treeData={toTree((modsQ.data?.items ?? []) as ModuleLike[])}
              onSelect={(keys) => {
                setModuleId(keys[0] ? String(keys[0]) : null);
                setPage(1);
              }}
            />
          </div>
          {/* 右：定义列表 → 展开显示 CASE 勾选 */}
          <div className="flex-1 min-w-0">
            <Table<ApiRow>
              rowKey="id"
              size="small"
              loading={apisQ.isLoading}
              dataSource={apisQ.data?.items ?? []}
              pagination={{
                current: page,
                pageSize: 10,
                total: apisQ.data?.total ?? 0,
                onChange: setPage,
                size: "small",
                showTotal: (t) => `共 ${t} 个接口`,
              }}
              expandable={{
                expandRowByClick: true,
                expandedRowRender: (api) => (
                  <ApiCaseCheckList
                    projectId={projectId}
                    api={api}
                    keyword={keyword}
                    selected={selected}
                    onToggle={toggle}
                  />
                ),
              }}
              columns={[
                {
                  title: "接口",
                  dataIndex: "path",
                  render: (_v: string, row) => (
                    <span className="flex items-center gap-2 min-w-0">
                      <MethodTag method={row.method} />
                      <span className="font-mono text-xs truncate">{row.path}</span>
                      <span className="truncate">{row.name}</span>
                      <span className="text-[#A8ABB0] text-xs shrink-0">#{row.num}</span>
                    </span>
                  ),
                },
                {
                  title: "CASE",
                  key: "caseCount",
                  width: 90,
                  render: (_, row) => (
                    <span className="text-xs text-[#A8ABB0]">{row.caseCount ?? 0} 条 CASE</span>
                  ),
                },
              ]}
            />
          </div>
        </div>
        <div className="flex justify-end items-center gap-2 mt-3">
          <span className="text-xs text-[#87888D] mr-auto">已选 {selected.size} 条</span>
          <Button onClick={onClose}>取消</Button>
          <Button
            type="primary"
            loading={submit.isPending}
            disabled={selected.size === 0}
            onClick={() => submit.mutate()}
            data-testid="btn-confirm-link-api"
          >
            确定关联
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/* ── 定义展开行：该接口下 CASE 勾选列表 ── */
function ApiCaseCheckList({
  projectId,
  api,
  keyword,
  selected,
  onToggle,
}: {
  projectId: string;
  api: ApiRow;
  keyword: string;
  selected: Set<string>;
  onToggle: (id: string) => void;
}) {
  const casesQ = useQuery({
    queryKey: ["picker-api-cases", projectId, api.id, keyword],
    queryFn: () => apiCaseApi.list(projectId, api.id, { name: keyword || undefined, pageSize: 50 }),
  });
  const cases: ApiCaseRow[] = casesQ.data?.items ?? [];
  if (casesQ.isLoading) return <p className="text-xs text-[#A8ABB0] px-2 py-1 m-0">CASE 加载中…</p>;
  if (cases.length === 0)
    return (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        className="py-4"
        description={<span className="text-xs">该接口暂无用例（或无匹配）</span>}
      />
    );
  return (
    <div className="bg-[#FAFBFC] px-3 pb-2 space-y-0.5">
      {cases.map((c) => {
        const st = CASE_STATUS_TEXT[c.status];
        return (
          <label
            key={c.id}
            className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-white text-[13px] cursor-pointer"
            data-testid="api-case-option"
          >
            <Checkbox checked={selected.has(c.id)} onChange={() => onToggle(c.id)} />
            <span>
              {c.name}{" "}
              <span className="text-[#A8ABB0] text-xs">AC-{String(c.num).padStart(4, "0")}</span>
            </span>
            <span className="text-xs text-[#A8ABB0]">
              {c.level}
              {st ? ` · ${st.label}` : ""}
            </span>
          </label>
        );
      })}
    </div>
  );
}

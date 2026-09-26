"use client";

import { Button, Input, Popconfirm, Select, Table, Tag } from "antd";
import { Plus, RotateCcw, Search, Star, Trash2 } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { HTMLAttributes } from "react";
import { bugApi, memberApi, workflowApi, type BugRow } from "@rabbit/api-client";
import { PageHeader } from "@/components/PageHeader";
import { ModuleTreePanel } from "@/components/ModuleTreePanel";
import { MemberSelect } from "@/components/crosscut";
import { useApp } from "@/hooks/useApp";
import { usePermissions } from "@/hooks/usePermissions";
import { useProjectStore } from "@/stores/project";

/** BUG-001：缺陷列表（左 bug 模块树 + 右列表；全部/回收站）。 */

function statusColor(
  serial: string,
  wf?: { states: { serial: string; isStart: boolean; isEnd: boolean }[] },
): string {
  const s = wf?.states.find((x) => x.serial === serial);
  if (s?.isEnd) return "#52C41A";
  if (s?.isStart) return "#FF4D4F";
  return "#1677FF";
}

export default function BugListPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { message } = useApp();
  const { can } = usePermissions();
  const { currentProjectId } = useProjectStore();
  const projectId = currentProjectId;

  const [recycled, setRecycled] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [status, setStatus] = useState<string>();
  const [handler, setHandler] = useState<string>();
  const [moduleId, setModuleId] = useState<string | null>(null);
  const [includeChildren, setIncludeChildren] = useState(false);
  const [page, setPage] = useState(1);

  const wfQ = useQuery({
    queryKey: ["workflow", projectId],
    queryFn: () => workflowApi.get(projectId!),
    enabled: Boolean(projectId),
  });
  const membersQ = useQuery({
    queryKey: ["members", projectId],
    queryFn: () => memberApi.projectMembers(projectId!),
    enabled: Boolean(projectId),
    staleTime: 60_000,
  });
  const memberName = (id: string | null) =>
    membersQ.data?.items.find((m) => m.id === id)?.name ?? "—";

  const listQ = useQuery({
    queryKey: [
      "bug",
      "list",
      projectId,
      recycled,
      keyword,
      status,
      handler,
      moduleId,
      includeChildren,
      page,
    ],
    queryFn: () =>
      bugApi.list(projectId!, {
        page,
        pageSize: 20,
        keyword: keyword || undefined,
        status,
        handler,
        moduleId: moduleId ?? undefined,
        includeChildren: moduleId ? includeChildren : undefined,
        recycled,
      }),
    enabled: Boolean(projectId),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["bug"] });
  const remove = useMutation({
    mutationFn: (id: string) => bugApi.remove(projectId!, id),
    onSuccess: () => {
      invalidate();
      message.success("已删除（进入回收站，可恢复）");
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "删除失败"),
  });
  const restore = useMutation({
    mutationFn: (id: string) => bugApi.restore(projectId!, id),
    onSuccess: () => {
      invalidate();
      message.success("已恢复至原模块");
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "恢复失败"),
  });
  const purge = useMutation({
    mutationFn: (id: string) => bugApi.remove(projectId!, id, true),
    onSuccess: () => {
      invalidate();
      message.success("已彻底删除");
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "删除失败"),
  });
  const follow = useMutation({
    mutationFn: (id: string) => bugApi.follow(projectId!, id, true),
    onSuccess: () => message.success("已关注，变更将提醒"),
    onError: (e) => message.error(e instanceof Error ? e.message : "操作失败"),
  });

  const wf = wfQ.data;
  const stateOptions = (wf?.states ?? []).map((s) => ({ value: s.serial, label: s.serial }));

  return (
    <div>
      <PageHeader
        title={recycled ? "缺陷回收站" : "缺陷管理"}
        sub={recycled ? "已删除缺陷可恢复或彻底删除" : "本地缺陷全流程（模板 + 工作流 + 关联用例）"}
        extra={
          <div className="flex items-center gap-2">
            <div className="flex bg-white border border-[#E5E6EB] rounded-md p-0.5 text-[13px]">
              <span
                data-testid="tab-all"
                className={`px-3 py-1 rounded cursor-pointer transition-colors ${!recycled ? "bg-[#574BFF]/8 text-[#574BFF] font-medium" : "text-[#646A73]"}`}
                onClick={() => {
                  setRecycled(false);
                  setPage(1);
                }}
              >
                全部
              </span>
              <span
                data-testid="tab-recycle"
                className={`px-3 py-1 rounded cursor-pointer transition-colors ${recycled ? "bg-[#574BFF]/8 text-[#574BFF] font-medium" : "text-[#646A73]"}`}
                onClick={() => {
                  setRecycled(true);
                  setPage(1);
                  setStatus(undefined);
                  setHandler(undefined);
                }}
              >
                回收站
              </span>
            </div>
            {!recycled && can("PROJECT_BUG:CREATE") && (
              <Button
                type="primary"
                icon={<Plus size={14} />}
                onClick={() => router.push("/bugs/new")}
                data-testid="btn-new-bug"
              >
                新建缺陷
              </Button>
            )}
          </div>
        }
      />
      <div className="flex gap-4 items-start">
        {!recycled && (
          <ModuleTreePanel
            projectId={projectId!}
            scene="bug"
            selectedId={moduleId}
            includeChildren={includeChildren}
            onSelect={(id) => {
              setModuleId(id);
              setPage(1);
            }}
            onIncludeChildrenChange={setIncludeChildren}
            canEdit={can("PROJECT_BUG:UPDATE")}
          />
        )}
        <div className="rabbit-card flex-1 min-w-0">
          <div className="flex gap-2 p-3 border-b border-[#F0F1F3] flex-wrap">
            <Input
              className="w-56"
              allowClear
              prefix={<Search size={14} className="text-[#A8ABB0]" />}
              placeholder="标题 / 编号搜索"
              value={keyword}
              onChange={(e) => {
                setKeyword(e.target.value);
                setPage(1);
              }}
              onPressEnter={() => setPage(1)}
              data-testid="input-bug-keyword"
            />
            <Select
              className="w-36"
              allowClear
              placeholder="状态：全部"
              value={status}
              options={stateOptions}
              onChange={(v) => {
                setStatus(v);
                setPage(1);
              }}
              data-testid="select-bug-status"
            />
            {!recycled && (
              <MemberSelect
                projectId={projectId!}
                value={handler}
                onChange={(v) => {
                  setHandler(Array.isArray(v) ? v[0] : v);
                  setPage(1);
                }}
                placeholder="处理人：全部"
              />
            )}
          </div>
          <Table<BugRow>
            rowKey="id"
            loading={listQ.isLoading}
            dataSource={listQ.data?.items ?? []}
            data-testid="bug-table"
            pagination={{
              current: page,
              pageSize: 20,
              total: listQ.data?.total ?? 0,
              onChange: setPage,
              showTotal: (t) => `共 ${t} 条`,
            }}
            onRow={() => ({ "data-testid": "bug-row" }) as HTMLAttributes<HTMLTableRowElement>}
            columns={[
              {
                title: "编号",
                dataIndex: "num",
                width: 96,
                render: (n: number) => (
                  <span className="text-[#87888D]">B-{String(n).padStart(4, "0")}</span>
                ),
              },
              {
                title: "标题",
                dataIndex: "title",
                render: (v: string, r) => (
                  <a
                    className="text-[#1F2329] hover:text-[#574BFF] font-medium"
                    href={`/bugs/${r.id}`}
                  >
                    {v}
                  </a>
                ),
              },
              {
                title: "状态",
                dataIndex: "status",
                width: 110,
                render: (v: string) => (
                  <span className="whitespace-nowrap">
                    <span
                      className="inline-block w-2 h-2 rounded-full mr-1.5 align-middle"
                      style={{ background: statusColor(v, wf) }}
                    />
                    {v}
                  </span>
                ),
              },
              {
                title: "处理人",
                dataIndex: "handleUserId",
                width: 90,
                render: (id: string | null) => {
                  if (!id) return <span className="text-[#A8ABB0]">—</span>;
                  const name = memberName(id);
                  return (
                    <span title={name} className="inline-flex items-center gap-1">
                      <span className="w-6 h-6 rounded-full bg-[#574BFF]/10 text-[#574BFF] text-xs grid place-items-center">
                        {name.slice(0, 1)}
                      </span>
                      {name}
                    </span>
                  );
                },
              },
              {
                title: "严重程度",
                key: "severity",
                width: 90,
                render: (_, r) => {
                  const sev = r.fields?.severity;
                  return sev ? (
                    <span className="text-xs font-medium text-[#FA8C16]">{String(sev)}</span>
                  ) : (
                    <span className="text-[#A8ABB0]">—</span>
                  );
                },
              },
              {
                title: "标签",
                dataIndex: "tags",
                width: 160,
                render: (tags: string[]) =>
                  tags.length ? (
                    tags.map((t) => (
                      <Tag key={t} bordered={false} color="processing">
                        {t}
                      </Tag>
                    ))
                  ) : (
                    <span className="text-[#C0C4CC]">—</span>
                  ),
              },
              {
                title: "更新时间",
                dataIndex: "updatedAt",
                width: 120,
                render: (s: string) => (
                  <span className="text-[#87888D] text-xs">{s.replace("T", " ").slice(5, 16)}</span>
                ),
              },
              {
                title: "操作",
                key: "op",
                width: recycled ? 190 : 210,
                render: (_, r) =>
                  recycled ? (
                    <span className="flex items-center gap-1">
                      <Button
                        type="link"
                        size="small"
                        icon={<RotateCcw size={13} />}
                        onClick={() => restore.mutate(r.id)}
                      >
                        恢复
                      </Button>
                      <Popconfirm
                        title="彻底删除"
                        description="该操作不可恢复（级联删除关联与附件记录），确认删除？"
                        okText="彻底删除"
                        okButtonProps={{ danger: true }}
                        onConfirm={() => purge.mutate(r.id)}
                      >
                        <Button type="link" size="small" danger icon={<Trash2 size={13} />}>
                          彻底删除
                        </Button>
                      </Popconfirm>
                    </span>
                  ) : (
                    <span className="flex items-center gap-1">
                      <a className="text-[#574BFF] hover:opacity-80" href={`/bugs/${r.id}`}>
                        编辑
                      </a>
                      <span className="text-[#E5E6EB]">|</span>
                      <Button
                        type="link"
                        size="small"
                        className="!px-0"
                        icon={<Star size={13} />}
                        onClick={() => follow.mutate(r.id)}
                        data-testid={`btn-follow-${r.num}`}
                      >
                        关注
                      </Button>
                      {can("PROJECT_BUG:DELETE") && (
                        <Popconfirm
                          title={`删除缺陷「${r.title}」？`}
                          description="删除后进入回收站，可恢复"
                          onConfirm={() => remove.mutate(r.id)}
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
        </div>
      </div>
    </div>
  );
}

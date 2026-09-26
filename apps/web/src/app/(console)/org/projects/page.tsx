"use client";

import { Button, Empty, Input, Modal, Popconfirm, Switch, Table, Tag } from "antd";
import { Plus, Search } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { orgApi, projectInfoApi, type OrgProjectRow } from "@rabbit/api-client";
import { PageHeader } from "@/components/PageHeader";
import { useApp } from "@/hooks/useApp";
import { usePermissions, useProjectInfo } from "@/hooks/usePermissions";
import { useProjectStore } from "@/stores/project";

const MODULE_OPTIONS: { key: "case" | "plan" | "bug" | "api"; label: string }[] = [
  { key: "case", label: "测试用例" },
  { key: "plan", label: "测试计划" },
  { key: "bug", label: "缺陷管理" },
  { key: "api", label: "接口测试" },
];

const fmt = (v: string | null) => (v ? v.replace("T", " ").slice(0, 10) : "—");

/** PROJ-001：组织 › 项目管理（项目列表 / 已删除可恢复 / 新建 / 编辑 / 结束·开启 / 删除二次确认）。 */
export default function OrgProjectsPage() {
  const qc = useQueryClient();
  const { message, modal } = useApp();
  const { can } = usePermissions();
  const { setCurrent } = useProjectStore();
  const orgId = useProjectInfo()?.org.id;

  const [tab, setTab] = useState<"list" | "deleted">("list");
  const [keyword, setKeyword] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ name: "", description: "" });
  const [editTarget, setEditTarget] = useState<OrgProjectRow | null>(null);
  const [editForm, setEditForm] = useState<{
    name: string;
    description: string;
    modules: Record<string, boolean>;
  }>({
    name: "",
    description: "",
    modules: { case: true, plan: true, bug: true, api: true },
  });

  const { data, isLoading } = useQuery({
    queryKey: ["org-projects", orgId, tab, keyword],
    queryFn: () =>
      orgApi.projects(orgId!, {
        deleted: tab === "deleted" ? "1" : undefined,
        keyword: keyword || undefined,
      }),
    enabled: Boolean(orgId),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["org-projects", orgId] });
  const errText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

  const create = useMutation({
    mutationFn: () =>
      orgApi.createProject(orgId!, {
        name: createForm.name.trim(),
        description: createForm.description.trim() || undefined,
      }),
    onSuccess: () => {
      invalidate();
      setCreateOpen(false);
      setCreateForm({ name: "", description: "" });
      message.success("项目已创建");
    },
    onError: (e) => message.error(errText(e, "创建失败")),
  });

  const updateProject = useMutation({
    mutationFn: () =>
      projectInfoApi.update(editTarget!.id, {
        name: editForm.name.trim(),
        description: editForm.description.trim() || null,
        modules: editForm.modules,
      }),
    onSuccess: () => {
      invalidate();
      setEditTarget(null);
      message.success("项目已更新");
    },
    onError: (e) => message.error(errText(e, "更新失败")),
  });

  const closeProject = useMutation({
    mutationFn: (id: string) => projectInfoApi.close(id),
    onSuccess: () => {
      invalidate();
      message.success("项目已结束，转为只读");
    },
    onError: (e) => message.error(errText(e, "操作失败")),
  });

  const reopenProject = useMutation({
    mutationFn: (id: string) => projectInfoApi.reopen(id),
    onSuccess: () => {
      invalidate();
      message.success("项目已重新开启");
    },
    onError: (e) => message.error(errText(e, "操作失败")),
  });

  const removeProject = useMutation({
    mutationFn: (id: string) => projectInfoApi.remove(id),
    onSuccess: () => {
      invalidate();
      message.success("项目已删除，30 天内可在「已删除」页签恢复");
    },
    onError: (e) => message.error(errText(e, "删除失败")),
  });

  const restoreProject = useMutation({
    mutationFn: (id: string) => projectInfoApi.restore(id),
    onSuccess: () => {
      invalidate();
      message.success("项目已恢复");
    },
    onError: (e) => message.error(errText(e, "恢复失败")),
  });

  if (!orgId) {
    return (
      <div>
        <PageHeader title="项目管理" sub="组织内全部项目" />
        <Empty className="py-24" description="请先选择项目" />
      </div>
    );
  }

  const items = data?.items ?? [];
  const enter = (row: OrgProjectRow) => {
    setCurrent(row.id);
    window.location.href = "/";
  };
  const confirmDelete = (row: OrgProjectRow) =>
    modal.confirm({
      title: "删除项目",
      content: `删除后「${row.name}」进入回收站，30 天内可在「已删除」页签撤销恢复；逾期将由系统永久删除并级联清除项目全部数据，该操作不可恢复。`,
      okText: "确认删除",
      okButtonProps: { danger: true },
      onOk: () => removeProject.mutate(row.id),
    });
  const openEdit = (row: OrgProjectRow) => {
    setEditTarget(row);
    setEditForm({
      name: row.name,
      description: row.description ?? "",
      modules: { case: true, plan: true, bug: true, api: true, ...row.modules },
    });
  };

  return (
    <div>
      <PageHeader
        title="项目管理"
        sub="组织内项目：删除进入回收站，30 天内可撤销"
        extra={
          <div className="flex items-center gap-2">
            <div className="flex bg-white border border-[#E5E6EB] rounded-md p-0.5 text-[13px]">
              <span
                data-testid="tab-list"
                className={`px-3 py-1 rounded cursor-pointer transition-colors ${tab === "list" ? "bg-[#574BFF]/8 text-[#574BFF] font-medium" : "text-[#646A73]"}`}
                onClick={() => setTab("list")}
              >
                项目列表
              </span>
              <span
                data-testid="tab-deleted"
                className={`px-3 py-1 rounded cursor-pointer transition-colors ${tab === "deleted" ? "bg-[#574BFF]/8 text-[#574BFF] font-medium" : "text-[#646A73]"}`}
                onClick={() => setTab("deleted")}
              >
                已删除
              </span>
            </div>
            {can("ORG_PROJECT:CREATE") && (
              <Button
                type="primary"
                icon={<Plus size={14} />}
                onClick={() => setCreateOpen(true)}
                data-testid="btn-new-project"
              >
                新建项目
              </Button>
            )}
          </div>
        }
      />

      <div className="rabbit-card">
        <div className="flex gap-2 p-3 border-b border-[#F0F1F3]">
          <Input
            className="w-64"
            allowClear
            prefix={<Search size={14} className="text-[#A8ABB0]" />}
            placeholder="搜索项目名称"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            data-testid="input-project-keyword"
          />
        </div>

        {tab === "list" ? (
          <Table<OrgProjectRow>
            rowKey="id"
            loading={isLoading}
            dataSource={items}
            pagination={{ pageSize: 20, total: data?.total ?? 0, showTotal: (t) => `共 ${t} 条` }}
            locale={{ emptyText: <Empty description="暂无项目，点击右上角「新建项目」创建" /> }}
            columns={[
              {
                title: "名称",
                dataIndex: "name",
                render: (v: string, row) => (
                  <div>
                    <a
                      className="text-[#1F2329] hover:text-[#574BFF] font-medium"
                      onClick={() => enter(row)}
                      data-testid={`project-name-${row.num}`}
                    >
                      {v}
                    </a>
                    {row.description && (
                      <p className="text-xs text-[#A8ABB0] mt-0.5">{row.description}</p>
                    )}
                  </div>
                ),
              },
              {
                title: "编号",
                dataIndex: "num",
                width: 80,
                render: (n: number) => <span className="text-[#87888D]">#{n}</span>,
              },
              {
                title: "成员数",
                dataIndex: "memberCount",
                width: 90,
                render: (n: number) => `${n} 人`,
              },
              {
                title: "状态",
                dataIndex: "status",
                width: 120,
                render: (v: string) =>
                  v === "ENDED" ? <Tag>已结束（只读）</Tag> : <Tag color="success">启用</Tag>,
              },
              {
                title: "创建时间",
                dataIndex: "createdAt",
                width: 110,
                render: (v: string) => <span className="text-[#87888D]">{fmt(v)}</span>,
              },
              {
                title: "操作",
                key: "op",
                width: 260,
                render: (_, row) => (
                  <span className="flex items-center gap-1 text-[13px]">
                    <Button type="link" size="small" className="!px-0" onClick={() => enter(row)}>
                      进入
                    </Button>
                    <span className="text-[#E5E6EB]">|</span>
                    {can("ORG_PROJECT:UPDATE") && (
                      <>
                        <Button
                          type="link"
                          size="small"
                          className="!px-0"
                          onClick={() => openEdit(row)}
                        >
                          编辑
                        </Button>
                        <span className="text-[#E5E6EB]">|</span>
                        {row.status === "ENDED" ? (
                          <Button
                            type="link"
                            size="small"
                            className="!px-0"
                            onClick={() => reopenProject.mutate(row.id)}
                          >
                            开启
                          </Button>
                        ) : (
                          <Popconfirm
                            title="结束项目"
                            description="结束后项目转为只读，全部写操作将被拒绝"
                            okText="确认结束"
                            onConfirm={() => closeProject.mutate(row.id)}
                          >
                            <Button type="link" size="small" className="!px-0">
                              结束
                            </Button>
                          </Popconfirm>
                        )}
                        <span className="text-[#E5E6EB]">|</span>
                      </>
                    )}
                    {can("ORG_PROJECT:DELETE") && (
                      <Button
                        type="link"
                        size="small"
                        danger
                        className="!px-0"
                        onClick={() => confirmDelete(row)}
                        data-testid="btn-delete-project"
                      >
                        删除
                      </Button>
                    )}
                  </span>
                ),
              },
            ]}
          />
        ) : (
          <Table<OrgProjectRow>
            rowKey="id"
            loading={isLoading}
            dataSource={items}
            pagination={{ pageSize: 20, total: data?.total ?? 0, showTotal: (t) => `共 ${t} 条` }}
            locale={{ emptyText: "回收站为空" }}
            columns={[
              {
                title: "名称",
                dataIndex: "name",
                render: (v: string, row) => (
                  <div>
                    <span className="text-[#3D4350]">{v}</span>
                    {row.description && (
                      <p className="text-xs text-[#A8ABB0] mt-0.5">{row.description}</p>
                    )}
                  </div>
                ),
              },
              {
                title: "删除时间",
                dataIndex: "deletedAt",
                width: 110,
                render: (v: string | null) => <span className="text-[#87888D]">{fmt(v)}</span>,
              },
              {
                title: "剩余可恢复时间",
                key: "purge",
                width: 200,
                render: (_, row) => {
                  const days = row.purgeAt
                    ? Math.max(
                        0,
                        Math.ceil((new Date(row.purgeAt).getTime() - Date.now()) / 86_400_000),
                      )
                    : 0;
                  return (
                    <span className="text-[#87888D]">
                      {days > 0 ? `剩余 ${days} 天自动清除` : "即将清除"}
                    </span>
                  );
                },
              },
              {
                title: "操作",
                key: "op",
                width: 100,
                render: (_, row) => (
                  <Button
                    type="link"
                    size="small"
                    className="!px-0"
                    loading={restoreProject.isPending}
                    onClick={() => restoreProject.mutate(row.id)}
                    data-testid="btn-restore-project"
                  >
                    撤销恢复
                  </Button>
                ),
              },
            ]}
          />
        )}
      </div>

      {/* 新建项目 Modal */}
      <Modal
        title="新建项目"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => create.mutate()}
        okText="创建"
        cancelText="取消"
        confirmLoading={create.isPending}
        okButtonProps={{ disabled: !createForm.name.trim() }}
      >
        <div className="space-y-4 pt-2">
          <div>
            <label className="block text-[13px] mb-1">
              名称 <span className="text-[#FF4D4F]">*</span>
            </label>
            <Input
              value={createForm.name}
              onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
              maxLength={128}
              placeholder="如：电商平台 V2"
              data-testid="input-new-project-name"
            />
          </div>
          <div>
            <label className="block text-[13px] mb-1">描述</label>
            <Input
              value={createForm.description}
              onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
              maxLength={512}
              data-testid="input-new-project-desc"
            />
          </div>
          <p className="text-xs text-[#A8ABB0]">
            创建后可在「设置 › 基本信息」中配置模块开关；模块默认全部开启。
          </p>
        </div>
      </Modal>

      {/* 编辑项目 Modal */}
      <Modal
        title="编辑项目"
        open={editTarget !== null}
        onCancel={() => setEditTarget(null)}
        onOk={() => updateProject.mutate()}
        okText="保存"
        cancelText="取消"
        confirmLoading={updateProject.isPending}
        okButtonProps={{ disabled: !editForm.name.trim() }}
      >
        <div className="space-y-4 pt-2">
          <div>
            <label className="block text-[13px] mb-1">
              名称 <span className="text-[#FF4D4F]">*</span>
            </label>
            <Input
              value={editForm.name}
              onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
              maxLength={128}
              data-testid="input-edit-project-name"
            />
          </div>
          <div>
            <label className="block text-[13px] mb-1">描述</label>
            <Input
              value={editForm.description}
              onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
              maxLength={512}
              data-testid="input-edit-project-desc"
            />
          </div>
          <div>
            <label className="block text-[13px] mb-1">模块开关</label>
            <div className="space-y-2 pt-1">
              {MODULE_OPTIONS.map((m) => (
                <div key={m.key} className="flex items-center gap-3">
                  <Switch
                    checked={editForm.modules[m.key] !== false}
                    onChange={(v) =>
                      setEditForm({ ...editForm, modules: { ...editForm.modules, [m.key]: v } })
                    }
                    data-testid={`edit-module-switch-${m.key}`}
                  />
                  <span className="text-[13px]">{m.label}</span>
                  {editForm.modules[m.key] === false && (
                    <span className="text-xs text-[#FF4D4F]">关闭后左导航菜单隐藏，数据保留</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}

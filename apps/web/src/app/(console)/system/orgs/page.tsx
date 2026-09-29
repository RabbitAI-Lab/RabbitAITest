"use client";

import {
  Alert,
  Button,
  Empty,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
} from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { orgAdminApi, userApi, type OrgRow } from "@rabbit/api-client";
import { PageHeader } from "@/components/PageHeader";
import { useApp } from "@/hooks/useApp";
import { usePermissions } from "@/hooks/usePermissions";
import { useEntp } from "@/hooks/useEntp";
import { Lock } from "lucide-react";

/** ENTP-001 组织管理：CRUD（建/编/结束恢复/删除级联）；社区版只读+新建禁用。 */

export default function OrgsPage() {
  const qc = useQueryClient();
  const { message, modal } = useApp();
  const { canGlobal } = usePermissions();
  const canRead = canGlobal("ENTP_ORG:READ");
  const canCreate = canGlobal("ENTP_ORG:CREATE");
  const canUpdate = canGlobal("ENTP_ORG:UPDATE");
  const entp = useEntp();
  const multiOrg = entp.can("MULTI_ORG");

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<OrgRow | null>(null);
  const [form, setForm] = useState({ name: "", ownerEmail: "", description: "" });
  const [editForm, setEditForm] = useState({ name: "", description: "" });

  const orgsQ = useQuery({
    queryKey: ["system-orgs"],
    queryFn: () => orgAdminApi.list(),
    enabled: canRead,
  });

  // 候选管理员（既有 ACTIVE 用户）
  const usersQ = useQuery({
    queryKey: ["system-users-for-org-owner"],
    queryFn: () => userApi.list({ page: 1, pageSize: 100 }),
    enabled: creating,
  });

  const refresh = () => void qc.invalidateQueries({ queryKey: ["system-orgs"] });

  const createMut = useMutation({
    mutationFn: () =>
      orgAdminApi.create({
        name: form.name,
        ownerEmail: form.ownerEmail,
        description: form.description || undefined,
      }),
    onSuccess: () => {
      message.success("组织已创建（成员/用户组/模板预设已初始化）");
      setCreating(false);
      refresh();
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "创建失败"),
  });

  const updateMut = useMutation({
    mutationFn: (v: { id: string; body: Parameters<typeof orgAdminApi.update>[1] }) =>
      orgAdminApi.update(v.id, v.body),
    onSuccess: () => {
      message.success("已保存");
      setEditing(null);
      refresh();
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "保存失败"),
  });

  const removeMut = useMutation({
    mutationFn: (id: string) => orgAdminApi.remove(id),
    onSuccess: (r) => {
      message.success(`组织已删除（连带 ${r.deletedProjects} 个项目）`);
      refresh();
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "删除失败"),
  });

  const confirmDelete = (org: OrgRow) => {
    let typed = "";
    modal.confirm({
      title: <span className="text-red-500">删除组织「{org.name}」</span>,
      content: (
        <div className="text-[13px] space-y-2">
          <div className="border border-red-200 bg-red-50 rounded p-2 text-red-600">
            将删除 {org.projectCount} 个项目及其全部用例/接口/场景/执行/报告数据，<b>不可恢复</b>
          </div>
          <Input
            placeholder={`输入组织名称「${org.name}」确认`}
            onChange={(e) => (typed = e.target.value)}
            data-testid="input-org-delete-confirm"
          />
        </div>
      ),
      okText: "确认删除",
      okButtonProps: { danger: true },
      onOk: () => {
        if (typed !== org.name) {
          message.error("组织名称不匹配");
          return Promise.reject();
        }
        return removeMut.mutateAsync(org.id);
      },
    });
  };

  if (!canRead) {
    return (
      <div>
        <PageHeader title="组织管理" sub="系统 › 组织管理" />
        <Empty className="py-24" description="无访问权限（ENTP_ORG:READ）" />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="组织管理"
        sub="系统 › 组织管理 · 多组织为企业版能力（MULTI_ORG）"
        extra={
          canCreate &&
          (multiOrg ? (
            <Button
              type="primary"
              onClick={() => {
                setForm({ name: "", ownerEmail: "", description: "" });
                setCreating(true);
              }}
              data-testid="btn-new-org"
            >
              ＋ 新建组织
            </Button>
          ) : (
            <Tooltip title="企业版功能（License 未启用）">
              <Button disabled icon={<Lock size={13} />} data-testid="btn-new-pool-locked">
                ＋ 新建组织
              </Button>
            </Tooltip>
          ))
        }
      />

      {!multiOrg && (
        <Alert
          type="info"
          showIcon
          className="mb-4"
          message="社区版限 1 个组织——添加企业版 License 后可创建多组织（结束/删除操作同样受门控）"
        />
      )}

      <div className="rabbit-card">
        <Table
          rowKey="id"
          loading={orgsQ.isLoading}
          dataSource={orgsQ.data?.items ?? []}
          data-testid="orgs-table"
          pagination={false}
          columns={[
            {
              title: "组织名称",
              dataIndex: "name",
              render: (v: string, r) => (
                <span className="flex items-center gap-2">
                  <b>{v}</b>
                  {r.isDefault && <Tag bordered={false}>默认</Tag>}
                </span>
              ),
            },
            {
              title: "描述",
              dataIndex: "description",
              render: (v: string | null) => (
                <span className="text-xs text-[#87888D]">{v ?? "—"}</span>
              ),
            },
            { title: "成员", dataIndex: "memberCount", width: 80 },
            { title: "项目", dataIndex: "projectCount", width: 80 },
            {
              title: "状态",
              dataIndex: "status",
              width: 100,
              render: (v: string) => (
                <Tag bordered={false} color={v === "ACTIVE" ? "green" : "default"}>
                  {v === "ACTIVE" ? "进行中" : "已结束"}
                </Tag>
              ),
            },
            {
              title: "创建时间",
              dataIndex: "createdAt",
              width: 110,
              render: (v: string) => (
                <span className="text-xs text-[#87888D]">{v.slice(0, 10)}</span>
              ),
            },
            {
              title: "操作",
              key: "ops",
              width: 220,
              render: (_, r) =>
                multiOrg ? (
                  <Space size={4}>
                    <a
                      className="text-[13px] text-[#574BFF]"
                      onClick={() => {
                        setEditing(r);
                        setEditForm({ name: r.name, description: r.description ?? "" });
                      }}
                      data-testid={`btn-edit-org-${r.id}`}
                    >
                      编辑
                    </a>
                    <a
                      className="text-[13px] text-[#574BFF]"
                      onClick={() =>
                        updateMut.mutate({
                          id: r.id,
                          body: { status: r.status === "ACTIVE" ? "ENDED" : "ACTIVE" },
                        })
                      }
                      data-testid={`btn-toggle-org-${r.id}`}
                    >
                      {r.status === "ACTIVE" ? "结束" : "恢复"}
                    </a>
                    {!r.isDefault && (
                      <a
                        className="text-[13px] text-red-500"
                        onClick={() => confirmDelete(r)}
                        data-testid={`btn-delete-org-${r.id}`}
                      >
                        删除
                      </a>
                    )}
                  </Space>
                ) : (
                  <span className="text-xs text-[#A8ABB0]">企业版操作（License 未启用）</span>
                ),
            },
          ]}
        />
      </div>

      {/* 新建弹窗 */}
      <Modal
        title="新建组织"
        open={creating}
        onCancel={() => setCreating(false)}
        okText="创 建"
        confirmLoading={createMut.isPending}
        okButtonProps={{ disabled: !form.name || !form.ownerEmail }}
        onOk={() => createMut.mutate()}
      >
        <div className="space-y-3 py-1 text-[13px]">
          <div>
            <p className="text-[#646A73] text-xs mb-1">组织名称</p>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="如：电商事业部"
              data-testid="input-org-name"
            />
          </div>
          <div>
            <p className="text-[#646A73] text-xs mb-1">管理员（既有用户）</p>
            <Select
              showSearch
              className="w-full"
              placeholder="搜索用户邮箱"
              value={form.ownerEmail || undefined}
              onChange={(v) => setForm({ ...form, ownerEmail: v })}
              options={(usersQ.data?.items ?? []).map((u) => ({
                value: u.email,
                label: `${u.name}（${u.email}）`,
              }))}
              optionFilterProp="label"
              data-testid="select-org-owner"
            />
          </div>
          <div>
            <p className="text-[#646A73] text-xs mb-1">描述</p>
            <Input
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="选填"
            />
          </div>
          <p className="text-xs text-[#A8ABB0]">
            创建后自动初始化用户组/默认模板；不创建演示项目（企业组织从空开始）
          </p>
        </div>
      </Modal>

      {/* 编辑弹窗 */}
      <Modal
        title={`编辑「${editing?.name ?? ""}」`}
        open={Boolean(editing)}
        onCancel={() => setEditing(null)}
        okText="保 存"
        confirmLoading={updateMut.isPending}
        onOk={() => editing && updateMut.mutate({ id: editing.id, body: editForm })}
      >
        <div className="space-y-3 py-1 text-[13px]">
          <div>
            <p className="text-[#646A73] text-xs mb-1">组织名称</p>
            <Input
              value={editForm.name}
              onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
            />
          </div>
          <div>
            <p className="text-[#646A73] text-xs mb-1">描述</p>
            <Input
              value={editForm.description}
              onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}

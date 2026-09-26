"use client";

import { Button, Drawer, Input, Modal, Popconfirm, Switch, Table, Tag } from "antd";
import { Plus, Search } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { userApi, type UserRow } from "@rabbit/api-client";
import { PageHeader } from "@/components/PageHeader";
import { useApp } from "@/hooks/useApp";
import { useState } from "react";

/** SYS-004：系统设置 › 用户管理。 */
export default function SystemUsersPage() {
  const qc = useQueryClient();
  const { message } = useApp();
  const [keyword, setKeyword] = useState("");
  const [page, setPage] = useState(1);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [form, setForm] = useState({ email: "", name: "", phone: "", password: "" });
  const [editing, setEditing] = useState<{ id: string; name: string; phone: string } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["system-users", keyword, page],
    queryFn: () => userApi.list({ keyword: keyword || undefined, page, pageSize: 20 }),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["system-users"] });
  const create = useMutation({
    mutationFn: () =>
      userApi.create({
        email: form.email.trim(),
        name: form.name.trim(),
        phone: form.phone || undefined,
        password: form.password || undefined,
      }),
    onSuccess: (u) => {
      invalidate();
      setDrawerOpen(false);
      setForm({ email: "", name: "", phone: "", password: "" });
      Modal.success({
        title: "用户已创建",
        content: (
          <p>
            初始密码（仅本次展示）：<b data-testid="initial-password">{u.initialPassword}</b>
          </p>
        ),
      });
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "创建失败"),
  });
  const update = useMutation({
    mutationFn: () => userApi.update(editing!.id, { name: editing!.name.trim(), phone: editing!.phone.trim() || null }),
    onSuccess: () => {
      invalidate();
      setEditing(null);
      message.success("用户信息已更新");
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "更新失败"),
  });
  const reset = useMutation({
    mutationFn: (id: string) => userApi.resetPassword(id),
    onSuccess: (r) => {
      Modal.success({
        title: "密码已重置",
        content: (
          <p>
            新密码（仅本次展示）：<b>{r.newPassword}</b>
          </p>
        ),
      });
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "重置失败"),
  });
  const toggle = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "ACTIVE" | "DISABLED" }) =>
      userApi.setStatus(id, status),
    onSuccess: () => {
      invalidate();
      message.success("状态已更新（该用户全部会话已失效）");
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "操作失败"),
  });
  const remove = useMutation({
    mutationFn: (id: string) => userApi.remove(id),
    onSuccess: () => {
      invalidate();
      message.success("用户已删除（软删，邮箱保留占用）");
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "删除失败"),
  });

  return (
    <div>
      <PageHeader
        title="用户管理"
        sub={`系统用户（社区版上限 ${data?.limit ?? 30} 人）`}
        extra={
          <Button
            type="primary"
            icon={<Plus size={14} />}
            onClick={() => setDrawerOpen(true)}
            data-testid="btn-new-user"
          >
            新建用户
          </Button>
        }
      />
      <div className="rabbit-card">
        <div className="flex gap-2 p-3 border-b border-[#F0F1F3]">
          <Input
            className="w-64"
            allowClear
            prefix={<Search size={14} className="text-[#A8ABB0]" />}
            placeholder="搜索邮箱/姓名"
            value={keyword}
            onChange={(e) => {
              setKeyword(e.target.value);
              setPage(1);
            }}
            data-testid="input-user-keyword"
          />
        </div>
        <Table<UserRow>
          rowKey="id"
          loading={isLoading}
          dataSource={data?.items ?? []}
          pagination={{
            current: page,
            pageSize: 20,
            total: data?.total ?? 0,
            onChange: setPage,
            showTotal: (t) => `共 ${t} 人`,
          }}
          columns={[
            {
              title: "邮箱",
              dataIndex: "email",
              render: (v: string) => <span data-testid="user-email">{v}</span>,
            },
            { title: "姓名", dataIndex: "name" },
            { title: "手机", dataIndex: "phone", render: (v: string | null) => v ?? "—" },
            {
              title: "状态",
              dataIndex: "status",
              render: (v: string, row) => (
                <Switch
                  checked={v === "ACTIVE"}
                  checkedChildren="启用"
                  unCheckedChildren="禁用"
                  disabled={row.email === "admin@rabbit.test"}
                  onChange={(checked) =>
                    toggle.mutate({ id: row.id, status: checked ? "ACTIVE" : "DISABLED" })
                  }
                  data-testid={`user-status-${row.email}`}
                />
              ),
            },
            {
              title: "创建时间",
              dataIndex: "createdAt",
              render: (v: string) => v.replace("T", " ").slice(0, 16),
            },
            {
              title: "操作",
              key: "op",
              width: 220,
              render: (_, row) => (
                <span className="flex gap-2">
                  <Button
                    type="link"
                    size="small"
                    className="!px-0"
                    onClick={() => setEditing({ id: row.id, name: row.name, phone: row.phone ?? "" })}
                    data-testid={`btn-edit-user-${row.email}`}
                  >
                    编辑
                  </Button>
                  <Button
                    type="link"
                    size="small"
                    className="!px-0"
                    onClick={() => reset.mutate(row.id)}
                    data-testid={`btn-reset-${row.email}`}
                  >
                    重置密码
                  </Button>
                  {row.email !== "admin@rabbit.test" && (
                    <Popconfirm
                      title={`删除用户「${row.name}」？登录将失效，业务数据保留。`}
                      onConfirm={() => remove.mutate(row.id)}
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
      <Modal
        title="编辑用户"
        open={Boolean(editing)}
        onCancel={() => setEditing(null)}
        onOk={() => update.mutate()}
        confirmLoading={update.isPending}
        okText="保存"
        okButtonProps={{ disabled: !editing?.name.trim() }}
      >
        {editing && (
          <div className="space-y-4 pt-2">
            <div>
              <label className="block text-[13px] mb-1">姓名 *</label>
              <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} data-testid="input-edit-user-name" />
            </div>
            <div>
              <label className="block text-[13px] mb-1">手机</label>
              <Input value={editing.phone} onChange={(e) => setEditing({ ...editing, phone: e.target.value })} data-testid="input-edit-user-phone" />
            </div>
          </div>
        )}
      </Modal>
      <Drawer title="新建用户" open={drawerOpen} onClose={() => setDrawerOpen(false)} width={420}>
        <div className="space-y-4">
          <div>
            <label className="block text-[13px] mb-1">
              邮箱 <span className="text-[#FF4D4F]">*</span>
            </label>
            <Input
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="user@example.com"
              data-testid="input-user-email"
            />
          </div>
          <div>
            <label className="block text-[13px] mb-1">
              姓名 <span className="text-[#FF4D4F]">*</span>
            </label>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              data-testid="input-user-name"
            />
          </div>
          <div>
            <label className="block text-[13px] mb-1">手机</label>
            <Input
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </div>
          <div>
            <label className="block text-[13px] mb-1">初始密码</label>
            <Input.Password
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder="留空自动生成"
            />
          </div>
          <Button
            type="primary"
            block
            loading={create.isPending}
            onClick={() => create.mutate()}
            disabled={!form.email.trim() || !form.name.trim()}
            data-testid="btn-submit-user"
          >
            创建
          </Button>
        </div>
      </Drawer>
    </div>
  );
}

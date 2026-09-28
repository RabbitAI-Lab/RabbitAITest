"use client";

import { Alert, Button, Empty, Input, Modal, Popconfirm, Select, Table, Tooltip } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { departmentApi, orgApi, type DepartmentTreeNode } from "@rabbit/api-client";
import { PageHeader } from "@/components/PageHeader";
import { useApp } from "@/hooks/useApp";
import { usePermissions } from "@/hooks/usePermissions";
import { useOrgContext } from "@/hooks/useOrgContext";
import { useEntp } from "@/hooks/useEntp";
import { Plus } from "lucide-react";

/** ENTP-008 部门管理：左部门树（两级+）右成员表；USER_SCALE 门控（社区版入口隐藏+API 403）。 */

function flatten(
  nodes: DepartmentTreeNode[],
  depth = 0,
  out: { node: DepartmentTreeNode; depth: number }[] = [],
) {
  for (const n of nodes) {
    out.push({ node: n, depth });
    flatten(n.children, depth + 1, out);
  }
  return out;
}

export default function DepartmentsPage() {
  const qc = useQueryClient();
  const { message } = useApp();
  const { canGlobal } = usePermissions();
  const canRead = canGlobal("ORG_DEPARTMENT:READ");
  const canWrite = canGlobal("ORG_DEPARTMENT:UPDATE");
  const entp = useEntp();
  const enabled = entp.can("USER_SCALE");
  const { currentOrgId, currentOrg } = useOrgContext();

  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState<{ parentId: string | null } | null>(null);
  const [name, setName] = useState("");
  const [renaming, setRenaming] = useState<DepartmentTreeNode | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [addingMember, setAddingMember] = useState(false);
  const [memberIds, setMemberIds] = useState<string[]>([]);

  const treeQ = useQuery({
    queryKey: ["org-departments", currentOrgId],
    queryFn: () => departmentApi.tree(currentOrgId!),
    enabled: canRead && enabled && Boolean(currentOrgId),
  });

  const membersQ = useQuery({
    queryKey: ["org-department-members", currentOrgId, selected],
    queryFn: () => departmentApi.members(currentOrgId!, selected!),
    enabled: Boolean(selected),
  });

  // 候选成员：本组织成员（orgApi.members 返回 {items:[{id,email,name}]}）
  const orgMembersQ = useQuery({
    queryKey: ["org-members-for-department", currentOrgId],
    queryFn: () => orgApi.members(currentOrgId!, { page: 1, pageSize: 100 }),
    enabled: addingMember && Boolean(currentOrgId),
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["org-departments", currentOrgId] });
  };

  const createMut = useMutation({
    mutationFn: () =>
      departmentApi.create(currentOrgId!, { name, parentId: creating?.parentId ?? null }),
    onSuccess: () => {
      message.success("部门已创建");
      setCreating(null);
      setName("");
      refresh();
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "创建失败"),
  });

  const renameMut = useMutation({
    mutationFn: () => departmentApi.update(currentOrgId!, renaming!.id, { name: renameValue }),
    onSuccess: () => {
      message.success("已重命名");
      setRenaming(null);
      refresh();
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "重命名失败"),
  });

  const removeMut = useMutation({
    mutationFn: (id: string) => departmentApi.remove(currentOrgId!, id),
    onSuccess: () => {
      message.success("部门已删除");
      if (selected) setSelected(null);
      refresh();
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "删除失败"),
  });

  const addMembersMut = useMutation({
    mutationFn: () => departmentApi.addMembers(currentOrgId!, selected!, memberIds),
    onSuccess: () => {
      message.success("成员已挂载");
      setAddingMember(false);
      setMemberIds([]);
      void qc.invalidateQueries({ queryKey: ["org-department-members", currentOrgId, selected] });
      refresh();
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "添加失败"),
  });

  const removeMemberMut = useMutation({
    mutationFn: (userId: string) => departmentApi.removeMember(currentOrgId!, selected!, userId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["org-department-members", currentOrgId, selected] });
      refresh();
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "移除失败"),
  });

  if (!canRead || !enabled) {
    return (
      <div>
        <PageHeader title="部门管理" sub="组织 › 部门管理" />
        <Empty
          className="py-24"
          description={
            canRead
              ? "部门管理为企业版能力（License · USER_SCALE）"
              : "无访问权限（ORG_DEPARTMENT:READ）"
          }
        />
      </div>
    );
  }

  const flat = flatten(treeQ.data ?? []);
  const selectedNode = flat.find((f) => f.node.id === selected)?.node ?? null;
  const breadcrumb = (node: DepartmentTreeNode): string => {
    const path: string[] = [];
    let cur: DepartmentTreeNode | undefined = node;
    while (cur) {
      path.unshift(cur.name);
      cur = flat.find((f) => f.node.id === cur!.parentId)?.node;
    }
    return path.join(" / ");
  };

  return (
    <div>
      <PageHeader title="部门管理" sub={`组织 › 部门管理 · 当前组织：${currentOrg?.name ?? "—"}`} />
      <div className="flex gap-4">
        {/* 左：部门树 */}
        <div className="rabbit-card w-72 shrink-0 p-3" data-testid="department-tree">
          <div className="flex items-center gap-2 mb-2">
            <span className="font-medium text-sm">部门树</span>
            {canWrite && (
              <Button
                size="small"
                type="primary"
                icon={<Plus size={12} />}
                onClick={() => setCreating({ parentId: null })}
                data-testid="btn-new-department-root"
              >
                子部门
              </Button>
            )}
          </div>
          {flat.length === 0 && !treeQ.isLoading && (
            <p className="text-xs text-[#A8ABB0] py-4 text-center">暂无部门，从根节点开始创建</p>
          )}
          <div className="space-y-0.5">
            {flat.map(({ node, depth }) => (
              <div
                key={node.id}
                className={`rounded px-2 py-1.5 text-[13px] flex items-center gap-1 cursor-pointer ${selected === node.id ? "bg-[#574BFF]/10 text-[#574BFF]" : "hover:bg-slate-50"}`}
                style={{ marginLeft: depth * 16 }}
                onClick={() => setSelected(node.id)}
                data-testid={`department-node-${node.id}`}
              >
                <span>
                  {depth === 0 ? "📂" : "📄"} {node.name}
                </span>
                <span className="text-[10px] text-[#A8ABB0]">（{node.memberCount} 人）</span>
                <span className="ml-auto flex gap-1.5" onClick={(e) => e.stopPropagation()}>
                  {canWrite && (
                    <>
                      <a
                        className="text-[#574BFF] text-[10px]"
                        onClick={() => {
                          setCreating({ parentId: node.id });
                          setName("");
                        }}
                      >
                        ＋
                      </a>
                      <a
                        className="text-[#574BFF] text-[10px]"
                        onClick={() => {
                          setRenaming(node);
                          setRenameValue(node.name);
                        }}
                      >
                        ✎
                      </a>
                      <Popconfirm
                        title="删除该部门？（成员挂载将解除）"
                        onConfirm={() => removeMut.mutate(node.id)}
                      >
                        <a className="text-red-400 text-[10px]">✕</a>
                      </Popconfirm>
                    </>
                  )}
                </span>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-[#A8ABB0] mt-3 border-t pt-2">
            层级不限；同层重名 409；有子部门不可删
          </p>
        </div>

        {/* 右：成员表 */}
        <div className="rabbit-card flex-1">
          <div className="flex items-center gap-2 p-3 border-b border-[#F0F1F3]">
            <span className="font-medium text-sm">{selectedNode ? selectedNode.name : "成员"}</span>
            {selectedNode && (
              <span className="text-xs text-[#A8ABB0]">面包屑：{breadcrumb(selectedNode)}</span>
            )}
            {canWrite && selected && (
              <Button
                size="small"
                type="primary"
                className="ml-auto"
                onClick={() => setAddingMember(true)}
                data-testid="btn-add-department-member"
              >
                ＋ 添加成员
              </Button>
            )}
          </div>
          {selected ? (
            <Table
              rowKey="userId"
              loading={membersQ.isLoading}
              dataSource={membersQ.data ?? []}
              data-testid="department-members"
              pagination={false}
              columns={[
                { title: "姓名", dataIndex: "name" },
                {
                  title: "邮箱",
                  dataIndex: "email",
                  render: (v: string) => (
                    <span className="font-mono text-xs text-[#87888D]">{v}</span>
                  ),
                },
                {
                  title: "操作",
                  key: "ops",
                  width: 90,
                  render: (_, r) =>
                    canWrite && (
                      <a
                        className="text-[13px] text-red-500"
                        onClick={() => removeMemberMut.mutate(r.userId)}
                      >
                        移除
                      </a>
                    ),
                },
              ]}
            />
          ) : (
            <Empty
              className="py-16"
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="选择左侧部门查看成员"
            />
          )}
        </div>
      </div>

      {/* 新建部门 */}
      <Modal
        title={creating?.parentId ? "新增子部门" : "新增根部门"}
        open={Boolean(creating)}
        onCancel={() => setCreating(null)}
        okText="创 建"
        confirmLoading={createMut.isPending}
        okButtonProps={{ disabled: !name.trim() }}
        onOk={() => createMut.mutate()}
      >
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="部门名称（同层唯一）"
          data-testid="input-department-name"
        />
      </Modal>

      {/* 重命名 */}
      <Modal
        title="重命名部门"
        open={Boolean(renaming)}
        onCancel={() => setRenaming(null)}
        okText="保 存"
        confirmLoading={renameMut.isPending}
        onOk={() => renameMut.mutate()}
      >
        <Input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} />
      </Modal>

      {/* 添加成员 */}
      <Modal
        title={`添加成员到「${selectedNode?.name ?? ""}」`}
        open={addingMember}
        onCancel={() => setAddingMember(false)}
        okText="确 定"
        confirmLoading={addMembersMut.isPending}
        okButtonProps={{ disabled: memberIds.length === 0 }}
        onOk={() => addMembersMut.mutate()}
      >
        <Select
          mode="multiple"
          className="w-full"
          placeholder="搜索本组织成员"
          value={memberIds}
          onChange={setMemberIds}
          options={(
            (
              orgMembersQ.data as
                | { items?: { id: string; name: string; email: string }[] }
                | undefined
            )?.items ?? []
          ).map((m) => ({
            value: m.id,
            label: `${m.name}（${m.email}）`,
          }))}
          optionFilterProp="label"
          data-testid="select-department-members"
        />
        <p className="text-xs text-[#A8ABB0] mt-2">成员可属多部门；仅可选择本组织成员</p>
      </Modal>
    </div>
  );
}

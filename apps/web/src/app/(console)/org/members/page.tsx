"use client";

import { Button, Empty, Input, Popconfirm, Select, Table, Tag } from "antd";
import { UserPlus } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orgApi } from "@rabbit/api-client";
import { PageHeader } from "@/components/PageHeader";
import { usePermissions, useProjectInfo } from "@/hooks/usePermissions";
import { useApp } from "@/hooks/useApp";
import { useState } from "react";

/**
 * P-2（coverage-audit §10）：组织 › 成员管理——组织管理员从系统用户搜索拉人进组织。
 * 对齐基线三级链路：系统建用户 → 组织拉人（本页）→ 项目拉人（设置›成员管理）。
 */
export default function OrgMembersPage() {
  const project = useProjectInfo();
  const orgId = project?.org.id;
  const { canGlobal } = usePermissions();
  const editable = canGlobal("ORG_MEMBER:UPDATE");
  const qc = useQueryClient();
  const { message } = useApp();
  const [keyword, setKeyword] = useState("");
  const [pickKeyword, setPickKeyword] = useState("");
  const [picked, setPicked] = useState<string[]>([]);

  const { data, isLoading } = useQuery({
    queryKey: ["org-members", orgId, keyword],
    queryFn: () => orgApi.members(orgId!, { keyword: keyword || undefined, pageSize: 50 }),
    enabled: Boolean(orgId),
  });

  // 候选：系统用户（排除已在组织）
  const { data: candidates, isFetching: searching } = useQuery({
    queryKey: ["org-member-candidates", pickKeyword],
    queryFn: () => orgApi.memberCandidates(orgId!, { keyword: pickKeyword || undefined, pageSize: 20 }),
    enabled: Boolean(orgId) && editable,
  });
  const memberIds = new Set((data?.items ?? []).map((m) => m.id));

  const invalidate = () => qc.invalidateQueries({ queryKey: ["org-members", orgId] });
  const add = useMutation({
    mutationFn: () => orgApi.addMembers(orgId!, picked),
    onSuccess: (r) => {
      invalidate();
      setPicked([]);
      message.success(`已添加 ${r.added} 名组织成员`);
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "添加失败"),
  });
  const remove = useMutation({
    mutationFn: (userId: string) => orgApi.removeMember(orgId!, userId),
    onSuccess: () => {
      invalidate();
      message.success("已移出组织（项目内成员与用户组已联动清除）");
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "移除失败"),
  });

  if (!project || !orgId) return <Empty description="请先选择项目（组织上下文取自当前项目）" />;

  return (
    <div>
      <PageHeader
        title="组织成员管理"
        sub="组织管理员从系统用户中添加成员；项目成员与项目用户组从这里拉人（基线三级链路）"
      />
      <div className="rabbit-card">
        <div className="flex gap-2 p-3 border-b border-[#F0F1F3] flex-wrap">
          <Input.Search
            className="w-64"
            allowClear
            placeholder="搜索成员邮箱/姓名"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            data-testid="input-org-member-keyword"
          />
          {editable && (
            <div className="ml-auto flex gap-2">
              <Select
                className="min-w-[280px]"
                mode="multiple"
                virtual={false}
                showSearch
                filterOption={false}
                onSearch={setPickKeyword}
                value={picked}
                onChange={setPicked}
                loading={searching}
                allowClear
                placeholder="搜索系统用户邮箱/姓名添加（可多选）"
                options={(candidates?.items ?? [])
                  
                  .map((u) => ({ value: u.id, label: `${u.name}（${u.email}）` }))}
                data-testid="org-member-candidate-select"
              />
              <Button
                type="primary"
                icon={<UserPlus size={14} />}
                disabled={picked.length === 0}
                loading={add.isPending}
                onClick={() => add.mutate()}
                data-testid="btn-add-org-member"
              >
                添加成员
              </Button>
            </div>
          )}
        </div>
        <Table
          rowKey="id"
          size="small"
          loading={isLoading}
          dataSource={data?.items ?? []}
          pagination={{ pageSize: 20, showTotal: (t) => `共 ${t} 人` }}
          columns={[
            { title: "姓名", dataIndex: "name", render: (v: string, r) => <span data-testid={`org-member-${r.email}`}>{v}</span> },
            { title: "邮箱", dataIndex: "email", render: (v: string) => <span className="text-[#87888D]">{v}</span> },
            { title: "手机", dataIndex: "phone", render: (v: string | null) => v ?? "—" },
            {
              title: "角色",
              key: "role",
              render: (_, r) =>
                project.org ? <Tag>组织成员</Tag> : null,
            },
            { title: "加入时间", dataIndex: "joinedAt", render: (v: string) => v.replace("T", " ").slice(0, 16) },
            ...(editable
              ? [
                  {
                    title: "操作",
                    key: "op",
                    width: 90,
                    render: (_: unknown, r: { id: string; email: string }) => (
                      <Popconfirm
                        title={`将「${r.email}」移出组织？`}
                        description="其在本组织各项目内的成员与用户组资格将一并移除"
                        okText="移除"
                        okButtonProps={{ danger: true }}
                        onConfirm={() => remove.mutate(r.id)}
                      >
                        <Button type="link" size="small" danger className="!px-0" data-testid={`btn-remove-org-member-${r.email}`}>
                          移除
                        </Button>
                      </Popconfirm>
                    ),
                  },
                ]
              : []),
          ]}
        />
      </div>
    </div>
  );
}

'use client';

import Link from 'next/link';
import { Button, Empty, Input, Popconfirm, Select, Table, Tag } from 'antd';
import { Lock, Search, UserPlus } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { groupApi, orgApi, projectInfoApi } from '@rabbit/api-client';
import { PageHeader } from '@/components/PageHeader';
import { useApp } from '@/hooks/useApp';
import { usePermissions, useProjectInfo } from '@/hooks/usePermissions';
import { useProjectStore } from '@/stores/project';

type MemberRow = { id: string; email: string; name: string; role: string; joinedAt: string; groups: { name: string; isSystem: boolean }[] };

const fmt = (v: string) => v.replace('T', ' ').slice(0, 10);

/** PROJ-001：项目 › 设置 › 成员管理（左成员表 + 右用户组入口）。 */
export default function SettingsMembersPage() {
  const qc = useQueryClient();
  const { message } = useApp();
  const { can } = usePermissions();
  const { currentProjectId } = useProjectStore();
  const info = useProjectInfo();
  const orgId = info?.org.id;
  const canUpdate = can('PROJECT_MEMBER:UPDATE');

  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);
  const [orgKeyword, setOrgKeyword] = useState('');
  const [picked, setPicked] = useState<string[]>([]);

  const membersKey = ['project-members', currentProjectId, keyword, page];
  const { data, isLoading } = useQuery({
    queryKey: membersKey,
    queryFn: () => projectInfoApi.members(currentProjectId!, { keyword: keyword || undefined, page, pageSize: 20 }),
    enabled: Boolean(currentProjectId),
  });

  const { data: groups } = useQuery({
    queryKey: ['groups', 'project', currentProjectId],
    queryFn: () => groupApi.list('project', currentProjectId!),
    enabled: Boolean(currentProjectId),
  });

  // 添加成员：仅组织成员可加（排除已是项目成员）
  const memberIds = new Set((data?.items ?? []).map((m) => m.id));
  const { data: orgUsers, isFetching: searchingOrg } = useQuery({
    queryKey: ['org-users', orgId, orgKeyword],
    queryFn: () => orgApi.members(orgId!, { keyword: orgKeyword || undefined, pageSize: 20 }),
    enabled: Boolean(currentProjectId) && Boolean(orgId),
  });
  const orgUserOptions = (orgUsers?.items ?? [])
    .filter((u) => !memberIds.has(u.id))
    .map((u) => ({ value: u.id, label: `${u.name}（${u.email}）` }));

  const invalidateMembers = () => qc.invalidateQueries({ queryKey: ['project-members', currentProjectId] });
  const errText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

  const addMembers = useMutation({
    mutationFn: () => projectInfoApi.addMembers(currentProjectId!, picked),
    onSuccess: (r) => {
      invalidateMembers();
      setPicked([]);
      message.success(`已添加 ${r.added} 名成员（默认「项目成员」组）`);
    },
    onError: (e) => message.error(errText(e, '添加失败')),
  });

  const removeMember = useMutation({
    mutationFn: (userId: string) => projectInfoApi.removeMember(currentProjectId!, userId),
    onSuccess: () => {
      invalidateMembers();
      message.success('成员已移出项目');
    },
    onError: (e) => message.error(errText(e, '移除失败')),
  });

  if (!currentProjectId) {
    return (
      <div>
        <PageHeader title="成员管理" sub="项目设置" />
        <Empty className="py-24" description="请先选择项目" />
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="成员管理" sub="成员与用户组共同决定项目内权限（权限并集 − 禁用交集）" />
      <div className="flex gap-4 items-start">
        {/* 左：成员表 */}
        <div className="flex-1 min-w-0 rabbit-card">
          <div className="flex items-center gap-2 p-3 border-b border-[#F0F1F3] flex-wrap">
            <Input
              className="w-64"
              allowClear
              prefix={<Search size={14} className="text-[#A8ABB0]" />}
              placeholder="搜索成员邮箱 / 姓名"
              value={keyword}
              onChange={(e) => { setKeyword(e.target.value); setPage(1); }}
              data-testid="member-search"
            />
            {canUpdate && (
              <>
                <Select
                  className="ml-auto min-w-[260px]"
                  mode="multiple"
                  showSearch
                  filterOption={false}
                  onSearch={setOrgKeyword}
                  value={picked}
                  onChange={setPicked}
                  options={orgUserOptions}
                  loading={searchingOrg}
                  allowClear
                  placeholder="搜索组织用户（邮箱 / 姓名）批量添加"
                  data-testid="org-user-select"
                />
                <Button
                  type="primary"
                  icon={<UserPlus size={14} />}
                  disabled={picked.length === 0}
                  loading={addMembers.isPending}
                  onClick={() => addMembers.mutate()}
                  data-testid="btn-add-member"
                >
                  添加成员
                </Button>
              </>
            )}
          </div>
          <Table<MemberRow>
            rowKey="id"
            loading={isLoading}
            dataSource={data?.items ?? []}
            pagination={{ current: page, pageSize: 20, total: data?.total ?? 0, onChange: setPage, showTotal: (t) => `共 ${t} 人` }}
            locale={{ emptyText: <Empty description="暂无成员，从组织用户中搜索添加第一批成员" /> }}
            columns={[
              { title: '邮箱', dataIndex: 'email', render: (v: string) => <span data-testid="member-email">{v}</span> },
              { title: '姓名', dataIndex: 'name' },
              {
                title: '所属用户组', dataIndex: 'groups',
                render: (gs: MemberRow['groups']) =>
                  gs.length > 0 ? (
                    <span className="flex gap-1 flex-wrap">
                      {gs.map((g) => (
                        <Tag key={g.name} bordered={false} color={g.isSystem ? 'default' : 'purple'}>{g.name}</Tag>
                      ))}
                    </span>
                  ) : (
                    <span className="text-xs text-[#C0C4CC]">未分组</span>
                  ),
              },
              { title: '加入时间', dataIndex: 'joinedAt', width: 110, render: (v: string) => <span className="text-[#87888D]">{fmt(v)}</span> },
              {
                title: '操作', key: 'op', width: 90,
                render: (_, m) =>
                  canUpdate ? (
                    <Popconfirm
                      title={`将「${m.name}」移出项目？`}
                      description="移除后该用户立即失去本项目访问权限"
                      okText="移除"
                      okButtonProps={{ danger: true }}
                      onConfirm={() => removeMember.mutate(m.id)}
                    >
                      <Button type="link" size="small" danger className="!px-0" data-testid="btn-remove-member">移除</Button>
                    </Popconfirm>
                  ) : (
                    <span className="text-xs text-[#C0C4CC]">—</span>
                  ),
              },
            ]}
          />
        </div>

        {/* 右：用户组入口卡片 */}
        <div className="w-72 shrink-0 rabbit-card">
          <p className="rabbit-card-title flex items-center gap-2">用户组</p>
          <div className="p-2">
            {(groups ?? []).map((g) => (
              <Link
                key={g.id}
                href="/settings/groups"
                className="flex items-center gap-2 px-3 py-2 mx-1 rounded-md text-[13px] text-[#3D4350] hover:bg-[#F2F3F5] transition-colors"
                data-testid={`entry-group-${g.name}`}
              >
                {g.isSystem && <Lock size={13} className="text-[#A8ABB0] shrink-0" aria-label="预置组只读" />}
                <span className="truncate">{g.name}</span>
                {g.isSystem ? (
                  <span className="ml-auto text-xs text-[#A8ABB0] shrink-0">{g.memberCount} 人</span>
                ) : (
                  <Tag className="ml-auto !mr-0" bordered={false}>自定义组 · {g.memberCount} 人</Tag>
                )}
              </Link>
            ))}
            {(groups ?? []).length === 0 && <p className="px-3 py-2 text-xs text-[#C0C4CC]">暂无用户组</p>}
            <p className="px-3 pt-2 pb-1 text-xs text-[#A8ABB0]">点击用户组进入组详情：成员维护 + 项目级权限点勾选</p>
            <div className="p-2">
              <Link href="/settings/groups" className="block text-center text-[13px] text-[#574BFF] hover:opacity-80" data-testid="link-settings-groups">
                管理用户组 →
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

'use client';

import { Alert, Button, Checkbox, Empty, Input, Modal, Popconfirm, Select, Spin, Table, Tag } from 'antd';
import { Lock, Plus } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { groupApi, userApi, type GroupMemberRow, type GroupRow } from '@rabbit/api-client';
import { PERMISSION_POINTS } from '@rabbit/shared';
import { useApp } from '@/hooks/useApp';
import { usePermissions } from '@/hooks/usePermissions';

/** SYS-004：三级用户组管理组件（system / org / project 复用，权限点按 {SCOPE}_{RESOURCE} 分组勾选）。 */
type GroupScope = 'system' | 'org' | 'project';

const RESOURCE_LABELS: Record<string, string> = {
  SYSTEM_USER: '系统用户', SYSTEM_GROUP: '系统用户组', SYSTEM_PARAM: '系统参数', SYSTEM_POOL: '资源池',
  ORG_PROJECT: '组织项目', ORG_MEMBER: '组织成员', ORG_GROUP: '组织用户组', ORG_TEMPLATE: '组织模板',
  PROJECT_GROUP: '项目用户组', PROJECT_MEMBER: '项目成员', PROJECT_TEMPLATE: '项目模板',
  PROJECT_CASE: '测试用例', PROJECT_CASE_REVIEW: '用例评审', PROJECT_PLAN: '测试计划',
  PROJECT_BUG: '缺陷管理', PROJECT_API: '接口测试', PROJECT_SCENARIO: '接口场景',
  PROJECT_ENV: '环境配置', PROJECT_FILE: '项目文件', PROJECT_SCRIPT: '脚本', PROJECT_REPORT: '测试报告',
};
const MAIN_ACTIONS: readonly string[] = ['READ', 'CREATE', 'UPDATE', 'DELETE'];
const ACTION_LABELS: Record<string, string> = { READ: '读取', CREATE: '创建', UPDATE: '更新', DELETE: '删除', SHARE: '分享', EXPORT: '导出', EXECUTE: '执行' };

/** 权限点目录：资源 → 可用动作（按 scope 过滤可见资源）。 */
function buildCatalog(scope: GroupScope): [string, string[]][] {
  const map = new Map<string, string[]>();
  for (const p of PERMISSION_POINTS) {
    const idx = p.lastIndexOf(':');
    const res = p.slice(0, idx);
    const act = p.slice(idx + 1);
    const list = map.get(res) ?? [];
    list.push(act);
    map.set(res, list);
  }
  const visible =
    scope === 'system'
      ? () => true
      : scope === 'org'
        ? (r: string) => r.startsWith('ORG_') || r.startsWith('PROJECT_')
        : (r: string) => r.startsWith('PROJECT_');
  return [...map.entries()].filter(([r]) => visible(r));
}

export function GroupManager({ scope, scopeId }: { scope: GroupScope; scopeId?: string }) {
  const qc = useQueryClient();
  const { message, modal } = useApp();
  const { can } = usePermissions();
  const permPrefix = scope === 'system' ? 'SYSTEM_GROUP' : scope === 'org' ? 'ORG_GROUP' : 'PROJECT_GROUP';
  const canCreate = can(`${permPrefix}:CREATE`);
  const canUpdate = can(`${permPrefix}:UPDATE`);
  const canDelete = can(`${permPrefix}:DELETE`);

  const resolvedScopeId = scopeId ?? '';
  const groupsKey = ['groups', scope, resolvedScopeId];
  const { data: groups, isLoading } = useQuery({
    queryKey: groupsKey,
    queryFn: () => groupApi.list(scope, resolvedScopeId, true),
    enabled: scope === 'system' || Boolean(scopeId),
  });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = useMemo(() => groups?.find((g) => g.id === selectedId) ?? null, [groups, selectedId]);
  const readonly = selected?.isSystem ?? false;

  // 权限勾选草稿：随选中组（或服务端权限变化，如恢复默认）重置
  const [draft, setDraft] = useState<string[]>([]);
  const permKey = selected ? [...selected.permissions].sort().join('|') : '';
  useEffect(() => {
    setDraft(selected ? [...selected.permissions] : []);
  }, [selected?.id, permKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // 添加成员：搜索系统用户（排除已在组成员）
  const [userKeyword, setUserKeyword] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  useEffect(() => {
    setPicked([]);
    setUserKeyword('');
  }, [selectedId]);
  const memberIds = useMemo(() => new Set((selected?.members ?? []).map((m) => m.userId)), [selected]);
  const { data: userPage, isFetching: searchingUsers } = useQuery({
    queryKey: ['group-user-options', userKeyword],
    queryFn: () => userApi.list({ keyword: userKeyword || undefined, pageSize: 20 }),
    enabled: Boolean(selected) && !readonly,
  });
  const userOptions = (userPage?.items ?? [])
    .filter((u) => !memberIds.has(u.id))
    .map((u) => ({ value: u.id, label: `${u.name}（${u.email}）` }));

  const invalidate = () => qc.invalidateQueries({ queryKey: groupsKey });
  const errText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ name: '', description: '' });
  const create = useMutation({
    mutationFn: () =>
      groupApi.create(scope, resolvedScopeId, {
        name: createForm.name.trim(),
        description: createForm.description.trim() || undefined,
        permissions: [],
      }),
    onSuccess: (r) => {
      invalidate();
      setSelectedId(r.id);
      setCreateOpen(false);
      setCreateForm({ name: '', description: '' });
      message.success('用户组已创建，请在右侧勾选权限点');
    },
    onError: (e) => message.error(errText(e, '创建失败')),
  });

  const [renameTarget, setRenameTarget] = useState<{ group: GroupRow; name: string; description: string } | null>(null);
  const rename = useMutation({
    mutationFn: () =>
      groupApi.update(scope, resolvedScopeId, renameTarget!.group.id, {
        name: renameTarget!.name.trim(),
        description: renameTarget!.description.trim() || undefined,
        permissions: renameTarget!.group.permissions,
        disabled: renameTarget!.group.disabled,
      }),
    onSuccess: () => {
      invalidate();
      setRenameTarget(null);
      message.success('用户组已更新');
    },
    onError: (e) => message.error(errText(e, '更新失败')),
  });

  const savePerms = useMutation({
    mutationFn: () => {
      const g = selected!;
      return groupApi.update(scope, resolvedScopeId, g.id, {
        name: g.name,
        description: g.description ?? undefined,
        permissions: draft,
        disabled: g.disabled,
      });
    },
    onSuccess: () => {
      invalidate();
      message.success('权限已保存并即时生效');
    },
    onError: (e) => message.error(errText(e, '保存失败')),
  });

  const restoreDefault = useMutation({
    mutationFn: (id: string) => groupApi.restoreDefault(scope, resolvedScopeId, id),
    onSuccess: () => {
      invalidate();
      message.success('已恢复默认权限');
    },
    onError: (e) => message.error(errText(e, '恢复失败')),
  });

  const removeGroup = useMutation({
    mutationFn: (id: string) => groupApi.remove(scope, resolvedScopeId, id),
    onSuccess: () => {
      invalidate();
      setSelectedId(null);
      message.success('用户组已删除');
    },
    onError: (e) => message.error(errText(e, '删除失败')),
  });

  const addMembers = useMutation({
    mutationFn: (id: string) => groupApi.addMembers(scope, resolvedScopeId, id, picked),
    onSuccess: (r) => {
      invalidate();
      setPicked([]);
      message.success(`已添加 ${r.added} 名成员`);
    },
    onError: (e) => message.error(errText(e, '添加失败')),
  });

  const removeMember = useMutation({
    mutationFn: ({ id, userId }: { id: string; userId: string }) =>
      groupApi.removeMember(scope, resolvedScopeId, id, userId),
    onSuccess: () => {
      invalidate();
      message.success('成员已移出该组');
    },
    onError: (e) => message.error(errText(e, '移除失败')),
  });

  const catalog = useMemo(() => buildCatalog(scope), [scope]);
  const presets = groups?.filter((g) => g.isSystem) ?? [];
  const customs = groups?.filter((g) => !g.isSystem) ?? [];

  const renderGroupItem = (g: GroupRow) => {
    const active = g.id === selectedId;
    return (
      <button
        key={g.id}
        type="button"
        data-testid={`group-item-${g.name}`}
        onClick={() => setSelectedId(g.id)}
        className={`w-full flex items-center gap-2 px-3 py-2 mx-1 rounded-md text-[13px] text-left transition-colors ${
          active ? 'bg-[#574BFF]/8 text-[#574BFF] font-medium' : 'text-[#3D4350] hover:bg-[#F2F3F5]'
        }`}
      >
        {g.isSystem && <Lock size={13} className="text-[#A8ABB0] shrink-0" aria-label="预置组只读" />}
        <span className="truncate">{g.name}</span>
        <span className="ml-auto text-xs text-[#A8ABB0] shrink-0">{g.memberCount} 人</span>
      </button>
    );
  };

  return (
    <div className="flex gap-4 items-start" data-testid={`group-manager-${scope}`}>
      {/* 左：组列表 */}
      <div className="w-64 shrink-0 rabbit-card">
        <p className="rabbit-card-title">组列表</p>
        <div className="p-1.5 min-h-[200px]">
          {isLoading ? (
            <div className="flex justify-center py-8"><Spin /></div>
          ) : (
            <>
              <p className="px-3 pt-2 pb-1 text-xs text-[#909399]">预置组（只读）</p>
              {presets.map(renderGroupItem)}
              <p className="px-3 pt-4 pb-1 text-xs text-[#909399]">自定义组</p>
              {customs.map(renderGroupItem)}
              {customs.length === 0 && <p className="px-3 py-2 text-xs text-[#C0C4CC]">暂无自定义组</p>}
            </>
          )}
        </div>
        {canCreate && (
          <div className="p-2 border-t border-[#F0F1F3]">
            <Button
              block
              type="primary"
              ghost
              icon={<Plus size={14} />}
              onClick={() => setCreateOpen(true)}
              data-testid="btn-new-group"
            >
              新建用户组
            </Button>
          </div>
        )}
      </div>

      {/* 右：组详情 */}
      <div className="flex-1 min-w-0 rabbit-card">
        {!selected ? (
          <Empty className="py-20" description="请在左侧选择一个用户组" />
        ) : (
          <>
            <div className="p-4 border-b border-[#F0F1F3] flex items-center gap-3 flex-wrap">
              <span className="font-medium">{selected.name}</span>
              <Tag bordered={false} color={readonly ? 'default' : 'purple'}>{readonly ? '预置组' : '自定义组'}</Tag>
              {selected.description && <span className="text-xs text-[#87888D]">{selected.description}</span>}
              {!readonly && (
                <div className="ml-auto flex gap-2">
                  {canUpdate && (
                    <>
                      <Button
                        size="small"
                        onClick={() => setRenameTarget({ group: selected, name: selected.name, description: selected.description ?? '' })}
                        data-testid="btn-rename-group"
                      >
                        重命名
                      </Button>
                      <Popconfirm
                        title="恢复默认权限"
                        description="将清空自定义勾选并恢复初始权限"
                        okText="恢复默认"
                        onConfirm={() => restoreDefault.mutate(selected.id)}
                        disabled={restoreDefault.isPending}
                      >
                        <Button size="small" loading={restoreDefault.isPending}>恢复默认</Button>
                      </Popconfirm>
                    </>
                  )}
                  {canDelete && (
                    <Button
                      size="small"
                      danger
                      data-testid="btn-delete-group"
                      onClick={() =>
                        modal.confirm({
                          title: `删除用户组「${selected.name}」？`,
                          content: '组内还有成员时无法删除（请先移出成员）；删除后不可恢复。',
                          okText: '确认删除',
                          okButtonProps: { danger: true },
                          onOk: () => removeGroup.mutate(selected.id),
                        })
                      }
                    >
                      删除
                    </Button>
                  )}
                </div>
              )}
            </div>
            {readonly && <Alert type="info" showIcon banner message="预置组不可修改，仅可查看成员与权限" />}

            {/* 成员区 */}
            <div className="p-4 border-b border-[#F0F1F3]">
              <div className="flex items-center gap-2 mb-3 flex-wrap">
                <span className="text-[13px] font-medium">成员（{selected.memberCount}）</span>
                {!readonly && canUpdate && (
                  <>
                    <Select
                      className="ml-auto min-w-[260px]"
                      mode="multiple"
                      showSearch
                      filterOption={false}
                      onSearch={setUserKeyword}
                      value={picked}
                      onChange={setPicked}
                      options={userOptions}
                      loading={searchingUsers}
                      allowClear
                      placeholder="搜索用户邮箱 / 姓名添加（可多选）"
                      data-testid="group-member-select"
                    />
                    <Button
                      type="primary"
                      disabled={picked.length === 0}
                      loading={addMembers.isPending}
                      onClick={() => addMembers.mutate(selected.id)}
                      data-testid="btn-group-add-member"
                    >
                      添加成员
                    </Button>
                  </>
                )}
              </div>
              <Table<GroupMemberRow>
                rowKey="userId"
                size="small"
                dataSource={selected.members ?? []}
                pagination={false}
                locale={{ emptyText: '暂无成员' }}
                columns={[
                  { title: '姓名', dataIndex: 'name' },
                  { title: '邮箱', dataIndex: 'email', render: (v: string) => <span className="text-[#87888D]">{v}</span> },
                  {
                    title: '操作', key: 'op', width: 90,
                    render: (_, m) =>
                      !readonly && canUpdate ? (
                        <Popconfirm
                          title={`将「${m.name}」移出该组？`}
                          okText="移除"
                          okButtonProps={{ danger: true }}
                          onConfirm={() => removeMember.mutate({ id: selected.id, userId: m.userId })}
                        >
                          <Button type="link" size="small" danger className="!px-0" data-testid={`btn-group-remove-member-${m.email}`}>移除</Button>
                        </Popconfirm>
                      ) : (
                        <span className="text-xs text-[#C0C4CC]">—</span>
                      ),
                  },
                ]}
              />
            </div>

            {/* 权限点勾选区 */}
            <div className="p-4">
              <div className="flex items-center gap-2 mb-3 flex-wrap">
                <span className="text-[13px] font-medium">权限点</span>
                <span className="text-xs text-[#A8ABB0]">按 资源 分组、动作复选；用户最终权限 = 所在各组并集 − 任一组禁用交集</span>
                {!readonly && canUpdate && (
                  <Button
                    className="ml-auto"
                    type="primary"
                    loading={savePerms.isPending}
                    onClick={() => savePerms.mutate()}
                    data-testid="btn-save-group"
                  >
                    保存权限配置
                  </Button>
                )}
              </div>
              <div className="border border-[#ECEEF1] rounded-md divide-y divide-[#F0F1F3]">
                {catalog.map(([res, acts]) => {
                  const has = (a: string) => draft.includes(`${res}:${a}`);
                  const allChecked = acts.every((a) => has(a));
                  const extras = acts.filter((a) => !MAIN_ACTIONS.includes(a));
                  const toggle = (point: string, on: boolean) =>
                    setDraft((prev) => (on ? [...new Set([...prev, point])] : prev.filter((p) => p !== point)));
                  const toggleAll = (on: boolean) =>
                    setDraft((prev) => {
                      const points = acts.map((a) => `${res}:${a}`);
                      return on ? [...new Set([...prev, ...points])] : prev.filter((p) => !points.includes(p));
                    });
                  return (
                    <div key={res} className="p-3">
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] font-medium">{RESOURCE_LABELS[res] ?? res}</span>
                        <span className="text-xs text-[#A8ABB0]">{res}</span>
                        <Checkbox
                          className="ml-auto"
                          checked={allChecked}
                          disabled={readonly}
                          onChange={(e) => toggleAll(e.target.checked)}
                          data-testid={`perm-check-all-${res}`}
                        >
                          <span className="text-xs text-[#646A73]">全选</span>
                        </Checkbox>
                      </div>
                      <div className="flex gap-6 mt-2 flex-wrap">
                        {MAIN_ACTIONS.map((a) => (
                          <Checkbox
                            key={a}
                            checked={has(a)}
                            disabled={readonly || !acts.includes(a)}
                            onChange={(e) => toggle(`${res}:${a}`, e.target.checked)}
                            data-testid={`perm-check-${res}:${a}`}
                          >
                            {ACTION_LABELS[a] ?? a}
                          </Checkbox>
                        ))}
                        {extras.map((a) => (
                          <Checkbox
                            key={a}
                            checked={has(a)}
                            disabled={readonly}
                            onChange={(e) => toggle(`${res}:${a}`, e.target.checked)}
                            data-testid={`perm-check-${res}:${a}`}
                          >
                            {ACTION_LABELS[a] ?? a}
                          </Checkbox>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>

      {/* 新建用户组 Modal */}
      <Modal
        title="新建用户组"
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
            <label className="block text-[13px] mb-1">名称 <span className="text-[#FF4D4F]">*</span></label>
            <Input
              value={createForm.name}
              onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
              placeholder="如：只读访客"
              maxLength={128}
              data-testid="input-new-group-name"
            />
          </div>
          <div>
            <label className="block text-[13px] mb-1">描述</label>
            <Input
              value={createForm.description}
              onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
              maxLength={512}
              data-testid="input-new-group-desc"
            />
          </div>
          <p className="text-xs text-[#A8ABB0]">创建后可在右侧勾选权限点并添加成员。</p>
        </div>
      </Modal>

      {/* 重命名 Modal */}
      <Modal
        title="重命名用户组"
        open={renameTarget !== null}
        onCancel={() => setRenameTarget(null)}
        onOk={() => rename.mutate()}
        okText="保存"
        cancelText="取消"
        confirmLoading={rename.isPending}
        okButtonProps={{ disabled: !renameTarget?.name.trim() }}
      >
        <div className="space-y-4 pt-2">
          <div>
            <label className="block text-[13px] mb-1">名称 <span className="text-[#FF4D4F]">*</span></label>
            <Input
              value={renameTarget?.name ?? ''}
              onChange={(e) => setRenameTarget((t) => (t ? { ...t, name: e.target.value } : t))}
              maxLength={128}
              data-testid="input-rename-group-name"
            />
          </div>
          <div>
            <label className="block text-[13px] mb-1">描述</label>
            <Input
              value={renameTarget?.description ?? ''}
              onChange={(e) => setRenameTarget((t) => (t ? { ...t, description: e.target.value } : t))}
              maxLength={512}
              data-testid="input-rename-group-desc"
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}

'use client';

import { Button, DatePicker, Empty, Input, Modal, Popconfirm, Progress, Select, Table, Tag, Tooltip } from 'antd';
import { Plus, Search } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { memberApi, reviewApi, type ReviewRow } from '@rabbit/api-client';
import { PageHeader } from '@/components/PageHeader';
import { MemberSelect } from '@/components/crosscut';
import { useApp } from '@/hooks/useApp';
import { usePermissions } from '@/hooks/usePermissions';
import { useProjectStore } from '@/stores/project';

const MODE_INFO: Record<string, { label: string; tip: string }> = {
  SINGLE: { label: '单人', tip: '单人评审：最后评审结果生效' },
  MULTI: { label: '多人', tip: '多人评审：全员通过才通过，任一失败即失败，建议不否决' },
};
const AVATAR_COLORS = ['#574BFF', '#52C41A', '#FA8C16', '#EB2F96', '#722ED1', '#13C2C2'];
const VIEWS = [
  { key: 'all', label: '全部', testid: 'tab-all-reviews' },
  { key: 'mine', label: '我评审的', testid: 'view-mine' },
  { key: 'created', label: '我创建的', testid: 'view-myreviews' },
] as const;
type DayjsLike = { toISOString(): string };

function AvatarStack({ ids, nameOf }: { ids: string[]; nameOf: (id: string) => string | undefined }) {
  const shown = ids.slice(0, 3);
  const rest = ids.length - shown.length;
  return (
    <Tooltip title={ids.map((id) => nameOf(id) ?? '已退出成员').join('、')}>
      <span className="flex -space-x-1.5 items-center">
        {shown.map((id) => (
          <span
            key={id}
            className="w-6 h-6 rounded-full ring-2 ring-white text-white grid place-items-center text-xs"
            style={{ background: AVATAR_COLORS[[...id].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_COLORS.length] }}
          >
            {(nameOf(id) ?? '?').slice(0, 1)}
          </span>
        ))}
        {rest > 0 && <span className="text-xs text-[#A8ABB0] ml-2.5">+{rest}</span>}
      </span>
    </Tooltip>
  );
}

/** CASE-005：用例评审列表（视图 Tabs / 评审人头像组 / 通过率 / 复制·结束·删除）。 */
export default function ReviewListPage() {
  const qc = useQueryClient();
  const router = useRouter();
  const { message } = useApp();
  const { can } = usePermissions();
  const { currentProjectId: projectId } = useProjectStore();
  const [view, setView] = useState<(typeof VIEWS)[number]['key']>('all');
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<{ name: string; reviewMode: 'SINGLE' | 'MULTI'; reviewers: string[]; range: [DayjsLike, DayjsLike] | null; description: string }>(
    { name: '', reviewMode: 'SINGLE', reviewers: [], range: null, description: '' },
  );

  const { data, isLoading } = useQuery({
    queryKey: ['reviews', projectId, view, keyword, page],
    queryFn: () => reviewApi.list(projectId!, { view: view === 'all' ? undefined : view, keyword: keyword || undefined, page, pageSize: 20 }),
    enabled: Boolean(projectId),
  });
  const { data: members } = useQuery({
    queryKey: ['members', projectId],
    queryFn: () => memberApi.projectMembers(projectId!),
    enabled: Boolean(projectId),
    staleTime: 60_000,
  });
  const nameOf = (id: string) => members?.items.find((m) => m.id === id)?.name;

  const invalidate = () => qc.invalidateQueries({ queryKey: ['reviews', projectId] });
  const create = useMutation({
    mutationFn: () => reviewApi.create(projectId!, {
      name: form.name.trim(),
      reviewMode: form.reviewMode,
      reviewers: form.reviewers,
      description: form.description || undefined,
      startAt: form.range?.[0]?.toISOString() ?? null,
      endAt: form.range?.[1]?.toISOString() ?? null,
      caseIds: [],
    }),
    onSuccess: (r) => {
      invalidate();
      message.success('评审已创建，接下来在详情页关联用例');
      router.push(`/reviews/${r.id}`);
    },
    onError: (e) => message.error(e instanceof Error ? e.message : '创建失败'),
  });
  const copy = useMutation({
    mutationFn: (id: string) => reviewApi.copy(projectId!, id),
    onSuccess: () => { invalidate(); message.success('已复制（名称 +copy，评审结果全部重置）'); },
    onError: (e) => message.error(e instanceof Error ? e.message : '复制失败'),
  });
  const close = useMutation({
    mutationFn: (id: string) => reviewApi.close(projectId!, id),
    onSuccess: () => { invalidate(); message.success('评审已结束'); },
    onError: (e) => message.error(e instanceof Error ? e.message : '操作失败'),
  });
  const remove = useMutation({
    mutationFn: (id: string) => reviewApi.remove(projectId!, id),
    onSuccess: () => { invalidate(); message.success('评审已删除'); },
    onError: (e) => message.error(e instanceof Error ? e.message : '删除失败'),
  });

  if (!projectId) {
    return <div className="rabbit-card p-16 flex justify-center"><Empty description="请先选择项目" /></div>;
  }
  const canUpdate = can('PROJECT_CASE_REVIEW:UPDATE');

  return (
    <div>
      <PageHeader
        title="用例评审"
        sub="用例质量门禁：创建评审 → 关联用例 → 评审人逐条标记 → 通过率驱动结论"
        extra={
          <div className="flex items-center gap-2">
            <div className="flex bg-white border border-[#E5E6EB] rounded-md p-0.5 text-[13px]">
              {VIEWS.map((v) => (
                <span
                  key={v.key}
                  data-testid={v.testid}
                  className={`px-3 py-1 rounded cursor-pointer transition-colors ${view === v.key ? 'bg-[#574BFF]/8 text-[#574BFF] font-medium' : 'text-[#646A73]'}`}
                  onClick={() => { setView(v.key); setPage(1); }}
                >
                  {v.label}{view === v.key ? `（${data?.total ?? 0}）` : ''}
                </span>
              ))}
            </div>
            {canUpdate && (
              <Button type="primary" icon={<Plus size={14} />} onClick={() => setOpen(true)} data-testid="btn-new-review">新建评审</Button>
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
            placeholder="搜索评审名称"
            value={keyword}
            onChange={(e) => { setKeyword(e.target.value); setPage(1); }}
            data-testid="input-review-keyword"
          />
        </div>
        <Table<ReviewRow>
          rowKey="id"
          loading={isLoading}
          dataSource={data?.items ?? []}
          onRow={(record) => ({ 'data-testid': 'review-row', 'data-row-id': record.id } as React.HTMLAttributes<HTMLTableRowElement>)}
          pagination={{ current: page, pageSize: 20, total: data?.total ?? 0, onChange: setPage, showTotal: (t) => `共 ${t} 条` }}
          columns={[
            {
              title: '评审名称', dataIndex: 'name',
              render: (v: string, row) => (
                <a className="text-[#574BFF] font-medium" href={`/reviews/${row.id}`} onClick={(e) => { e.preventDefault(); router.push(`/reviews/${row.id}`); }}>{v}</a>
              ),
            },
            {
              title: '模式', dataIndex: 'reviewMode', width: 80,
              render: (v: string) => {
                const info = MODE_INFO[v] ?? { label: v, tip: v };
                return <Tooltip title={info.tip}><Tag color={v === 'MULTI' ? 'blue' : 'default'} className="cursor-help">{info.label}</Tag></Tooltip>;
              },
            },
            { title: '评审人', dataIndex: 'reviewers', width: 130, render: (ids: string[]) => <AvatarStack ids={ids} nameOf={nameOf} /> },
            { title: '用例数', dataIndex: 'caseCount', width: 80 },
            {
              title: '通过率', dataIndex: 'passRate', width: 180,
              render: (v: number, row) => (
                <div className="flex items-center gap-2" data-testid="review-pass-rate">
                  <Progress percent={v} size="small" showInfo={false} strokeColor="#52C41A" className="!m-0 w-24" />
                  <span className="text-xs text-[#87888D]">{v}%（{row.stats.judged}/{row.caseCount} 已评）</span>
                </div>
              ),
            },
            {
              title: '状态', dataIndex: 'status', width: 130,
              render: (v: string, row) => (
                <span className="whitespace-nowrap">
                  <Tag color={v === 'UNDERWAY' ? 'processing' : 'default'}>{v === 'UNDERWAY' ? '进行中' : '已结束'}</Tag>
                  {row.overdue && <Tag color="warning">已逾期</Tag>}
                </span>
              ),
            },
            {
              title: '起止时间', key: 'period', width: 150,
              render: (_, row) => (
                <span className="text-[#87888D] text-xs whitespace-nowrap">
                  {row.startAt ? row.startAt.slice(5, 10) : '—'} ~ {row.endAt ? row.endAt.slice(5, 10) : '—'}
                </span>
              ),
            },
            {
              title: '操作', key: 'op', width: 210,
              render: (_, row) => (
                <span className="flex gap-2 whitespace-nowrap">
                  <Button type="link" size="small" className="!px-0" onClick={() => router.push(`/reviews/${row.id}`)}>进入</Button>
                  {canUpdate && <Button type="link" size="small" className="!px-0" onClick={() => copy.mutate(row.id)}>复制</Button>}
                  {canUpdate && row.status === 'UNDERWAY' && (
                    <Popconfirm title="结束后不可再标记评审，确认结束？" okText="确认结束" onConfirm={() => close.mutate(row.id)}>
                      <Button type="link" size="small" className="!px-0" data-testid="btn-close-review">结束</Button>
                    </Popconfirm>
                  )}
                  {canUpdate && row.status === 'UNDERWAY' && (
                    <Popconfirm title={`删除评审「${row.name}」？仅解除关联，不影响用例本身。`} okButtonProps={{ danger: true }} onConfirm={() => remove.mutate(row.id)}>
                      <Button type="link" size="small" danger className="!px-0">删除</Button>
                    </Popconfirm>
                  )}
                </span>
              ),
            },
          ]}
        />
      </div>

      <Modal
        title="新建评审"
        open={open}
        onCancel={() => setOpen(false)}
        footer={null}
        width={520}
        destroyOnHidden
      >
        <div className="space-y-4 pt-2">
          <div>
            <label className="block text-[13px] mb-1">名称 <span className="text-[#FF4D4F]">*</span></label>
            <Input value={form.name} maxLength={256} placeholder="评审名称" onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="input-review-name" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[13px] mb-1">模式</label>
              <Select
                className="w-full"
                virtual={false}
                value={form.reviewMode}
                onChange={(v) => setForm({ ...form, reviewMode: v })}
                options={[
                  { value: 'SINGLE', label: '单人（最后结果生效）' },
                  { value: 'MULTI', label: '多人（全员通过才通过）' },
                ]}
                data-testid="select-review-mode"
              />
            </div>
            <div>
              <label className="block text-[13px] mb-1">评审人 <span className="text-[#FF4D4F]">*</span></label>
              <MemberSelect
                projectId={projectId}
                mode="multiple"
                value={form.reviewers}
                onChange={(v) => setForm({ ...form, reviewers: v as string[] })}
                placeholder="选择评审人（可多选）"
                testId="select-reviewers"
              />
            </div>
          </div>
          <div>
            <label className="block text-[13px] mb-1">起止时间</label>
            <DatePicker.RangePicker
              className="w-full"
              showTime={{ format: 'HH:mm' }}
              format="YYYY-MM-DD HH:mm"
              value={form.range as never}
              onChange={(vals) => setForm({ ...form, range: vals as unknown as [DayjsLike, DayjsLike] | null })}
              data-testid="input-review-range"
            />
          </div>
          <div>
            <label className="block text-[13px] mb-1">描述</label>
            <Input.TextArea rows={3} maxLength={2000} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="评审目的 / 范围说明（选填）" />
          </div>
          <p className="text-xs text-[#A8ABB0]">用例可在创建后进入详情页关联（创建时可不关联）。</p>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setOpen(false)}>取消</Button>
            <Button
              type="primary"
              loading={create.isPending}
              disabled={!form.name.trim() || form.reviewers.length === 0}
              onClick={() => create.mutate()}
              data-testid="btn-submit-review"
            >
              创建
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

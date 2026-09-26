'use client';

import { Button, Input, Modal, Popconfirm, Select, Table, Tag, Upload } from 'antd';
import type { UploadProps } from 'antd';
import { Pencil, Share2, Star, Upload as UploadIcon, X } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import {
  authApi, bugApi, caseApiV2, commentApi, fieldDefApi, memberApi, templateApi, workflowApi,
  type CommentDto,
} from '@rabbit/api-client';
import type { FieldDefInput, TemplateFieldBinding } from '@rabbit/shared';
import { ChangeTimeline, CommentThread, MarkdownView, MemberSelect } from '@/components/crosscut';
import { DynamicFieldCell, DynamicFieldForm, type DynFieldDef } from '@/components/DynamicField';
import { useApp } from '@/hooks/useApp';
import { usePermissions, useProjectInfo } from '@/hooks/usePermissions';
import { useProjectStore } from '@/stores/project';

/** BUG-001：缺陷详情（头部流转 + 详情/关联用例/评论/变更历史）。变更历史口径：无独立 changeLogs 端点，取评论中【流转 x→y】前缀记录。 */

const FLOW_PREFIX = '【流转 ';

function statusColor(serial: string, states?: { serial: string; isStart: boolean; isEnd: boolean }[]): string {
  const s = states?.find((x) => x.serial === serial);
  if (s?.isEnd) return '#52C41A';
  if (s?.isStart) return '#FF4D4F';
  return '#1677FF';
}

function fmtSize(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)}MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(0)}KB`;
  return `${n}B`;
}

export default function BugDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const { message } = useApp();
  const { can } = usePermissions();
  const { currentProjectId } = useProjectStore();
  const project = useProjectInfo();
  const projectId = currentProjectId;
  const orgId = project?.org.id ?? null;
  const canUpdate = can('PROJECT_BUG:UPDATE');

  const [tab, setTab] = useState<'detail' | 'cases' | 'comments' | 'history'>('detail');
  const [editing, setEditing] = useState(false);
  const [followed, setFollowed] = useState(false);
  const [transitionTo, setTransitionTo] = useState<string | null>(null);
  const [transitionComment, setTransitionComment] = useState('');
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkKeyword, setLinkKeyword] = useState('');
  const [linkCaseId, setLinkCaseId] = useState<string>();

  // 编辑表单态
  const [form, setForm] = useState<{ title: string; description: string; handleUserId?: string; tags: string[]; fields: Record<string, unknown> } | null>(null);

  const bugQ = useQuery({
    queryKey: ['bug', 'detail', projectId, id],
    queryFn: () => bugApi.detail(projectId!, id),
    enabled: Boolean(projectId && id),
  });
  const wfQ = useQuery({
    queryKey: ['workflow', projectId],
    queryFn: () => workflowApi.get(projectId!),
    enabled: Boolean(projectId),
  });
  const defsQ = useQuery({
    queryKey: ['field-defs', orgId, 'bug'],
    queryFn: () => fieldDefApi.list(orgId!, 'bug'),
    enabled: Boolean(orgId),
  });
  const templatesQ = useQuery({
    queryKey: ['templates', orgId, projectId, 'bug'],
    queryFn: () => templateApi.list(orgId!, projectId!, 'bug'),
    enabled: Boolean(orgId && projectId),
  });
  const membersQ = useQuery({
    queryKey: ['members', projectId],
    queryFn: () => memberApi.projectMembers(projectId!),
    enabled: Boolean(projectId),
    staleTime: 60_000,
  });
  const meQ = useQuery({ queryKey: ['me'], queryFn: () => authApi.me(), staleTime: 5 * 60_000 });
  const attachQ = useQuery({
    queryKey: ['bug-attachments', projectId, id],
    queryFn: () => bugApi.attachments(projectId!, id),
    enabled: Boolean(projectId && id),
  });
  const linkedCasesQ = useQuery({
    queryKey: ['bug-cases', projectId, id],
    queryFn: () => bugApi.cases(projectId!, id),
    enabled: Boolean(projectId && id),
  });
  const commentsQ = useQuery({
    queryKey: ['comments', projectId, `bug:${id}`],
    queryFn: () => commentApi.list(projectId!, `bug:${id}`),
    enabled: Boolean(projectId && id),
  });
  const caseSearchQ = useQuery({
    queryKey: ['case', 'list', projectId, linkKeyword],
    queryFn: () => caseApiV2.list(projectId!, { page: 1, pageSize: 20, keyword: linkKeyword || undefined }),
    enabled: Boolean(projectId && linkOpen),
  });

  const bug = bugQ.data;
  const memberName = (uid: string | null) => membersQ.data?.items.find((m) => m.id === uid)?.name;
  const tplBindings: TemplateFieldBinding[] | undefined = (() => {
    const list = templatesQ.data ?? [];
    if (!bug) return undefined;
    const tpl = (bug.templateId ? list.find((t) => t.id === bug.templateId) : null) ?? list.find((t) => t.isDefault);
    return tpl?.fields?.map((b) => ({ ...b, visibleInList: b.visibleInList ?? false }));
  })();
  const defs: DynFieldDef[] = (defsQ.data ?? [])
    .filter((d) => d.enabled)
    .map((d) => ({ ...d, options: d.options as FieldDefInput['options'] }) as DynFieldDef);
  const visibleDefs = tplBindings ? defs.filter((d) => tplBindings.some((b) => b.fieldKey === d.key)) : defs;

  const invalidateBug = () => {
    void qc.invalidateQueries({ queryKey: ['bug'] });
    void qc.invalidateQueries({ queryKey: ['bug-attachments', projectId, id] });
    void qc.invalidateQueries({ queryKey: ['bug-cases', projectId, id] });
    void qc.invalidateQueries({ queryKey: ['comments', projectId, `bug:${id}`] });
  };

  const doTransition = useMutation({
    mutationFn: () => bugApi.transition(projectId!, id, transitionTo!, transitionComment.trim()),
    onSuccess: (r) => {
      setTransitionTo(null); setTransitionComment('');
      invalidateBug();
      message.success(`已流转为「${r.status}」`);
    },
    onError: (e) => message.error(e instanceof Error ? e.message : '流转失败'),
  });
  const follow = useMutation({
    mutationFn: () => bugApi.follow(projectId!, id, !followed),
    onSuccess: () => { setFollowed((v) => !v); message.success(followed ? '已取消关注' : '已关注，变更将提醒'); },
    onError: (e) => message.error(e instanceof Error ? e.message : '操作失败'),
  });
  const saveEdit = useMutation({
    mutationFn: () => bugApi.update(projectId!, id, {
      title: form!.title.trim(), description: form!.description,
      handleUserId: form!.handleUserId ?? null, tags: form!.tags, fields: form!.fields,
      version: bug!.version,
    }),
    onSuccess: () => { setEditing(false); invalidateBug(); message.success('已保存'); },
    onError: (e) => message.error(e instanceof Error ? e.message : '保存失败'),
  });
  const uploadProps: UploadProps = {
    showUploadList: false,
    multiple: true,
    customRequest: async ({ file, onSuccess, onError }) => {
      try {
        await bugApi.addAttachment(projectId!, id, file as File);
        onSuccess?.({});
        void qc.invalidateQueries({ queryKey: ['bug-attachments', projectId, id] });
        message.success('附件已上传');
      } catch (e) {
        onError?.(e as Error);
        message.error(e instanceof Error ? e.message : '上传失败');
      }
    },
  };
  const removeAttachment = useMutation({
    mutationFn: (attachmentId: string) => bugApi.removeAttachment(projectId!, attachmentId),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['bug-attachments', projectId, id] }); message.success('附件已删除'); },
    onError: (e) => message.error(e instanceof Error ? e.message : '删除失败'),
  });
  const linkCase = useMutation({
    mutationFn: () => bugApi.linkCase(projectId!, id, linkCaseId!),
    onSuccess: () => { setLinkOpen(false); setLinkCaseId(undefined); void qc.invalidateQueries({ queryKey: ['bug-cases', projectId, id] }); message.success('已关联用例'); },
    onError: (e) => message.error(e instanceof Error ? e.message : '关联失败'),
  });
  const unlinkCase = useMutation({
    mutationFn: (caseId: string) => bugApi.unlinkCase(projectId!, id, caseId),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['bug-cases', projectId, id] }); message.success('已解绑'); },
    onError: (e) => message.error(e instanceof Error ? e.message : '解绑失败'),
  });

  const share = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      message.success('链接已复制');
    } catch {
      message.error('复制失败，请手动复制地址栏链接');
    }
  };

  // 变更历史口径：评论中以【流转 x→y】开头的记录（缺陷无独立 changeLogs 端点）
  const flowComments = (commentsQ.data?.items ?? [])
    .filter((c) => c.content.startsWith(FLOW_PREFIX))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const flowItems = flowComments.map((c: CommentDto, i: number) => {
    const m = /^【流转 (.+?)→(.+?)】([\s\S]*)$/.exec(c.content);
    const diff: Record<string, { before: unknown; after: unknown }> = {
      状态: { before: m?.[1] ?? '?', after: m?.[2] ?? '?' },
    };
    if (m?.[3]?.trim()) diff.意见 = { before: '', after: m[3].trim() };
    return { id: c.id, seq: flowComments.length - i, action: 'transition', diff, userName: c.userName, createdAt: c.createdAt };
  });

  const states = wfQ.data?.states;
  const tabs = [
    { key: 'detail', label: '详情', testid: 'tab-detail' },
    { key: 'cases', label: `关联用例（${linkedCasesQ.data?.length ?? 0}）`, testid: 'tab-cases' },
    { key: 'comments', label: `评论（${(commentsQ.data?.items ?? []).filter((c) => !c.content.startsWith(FLOW_PREFIX)).length ?? 0}）`, testid: 'tab-comments' },
    { key: 'history', label: '变更历史', testid: 'tab-history' },
  ] as const;

  if (!bug) {
    if (bugQ.isError) {
      return (
        <div className="rabbit-card p-6">
          <p className="text-[13px] text-[#FF4D4F] mb-3" data-testid="bug-load-error">{bugQ.error instanceof Error ? bugQ.error.message : '缺陷加载失败'}</p>
          <a className="text-[#574BFF] text-[13px]" href="/bugs">‹ 返回缺陷列表</a>
        </div>
      );
    }
    return <div className="rabbit-card p-6 text-[13px] text-[#A8ABB0]">加载中…</div>;
  }

  return (
    <div>
      {/* 头部：标题 + 状态徽标 + 流转按钮组 + 关注/分享/编辑 */}
      <div className="flex items-center gap-3 flex-wrap">
        <a className="text-[13px] text-[#87888D] hover:text-[#574BFF] no-underline" href="/bugs">‹ 缺陷列表</a>
        <h1 className="text-lg font-medium m-0">{bug.title}</h1>
        <span className="text-sm text-[#A8ABB0]">B-{String(bug.num).padStart(4, '0')}</span>
        <span
          data-testid="bug-status"
          className="rounded-full text-xs px-2 py-0.5 font-medium"
          style={{ background: `${statusColor(bug.status, states)}1A`, color: statusColor(bug.status, states) }}
        >
          {bug.status}
        </span>
        <div className="ml-auto flex gap-2 items-center">
          {canUpdate && bug.allowedTransitions.map((to) => (
            <Button key={to} data-testid={`btn-transition-${to}`} onClick={() => { setTransitionTo(to); setTransitionComment(''); }}>
              流转为 {to}
            </Button>
          ))}
          <span className="w-px h-5 bg-[#E5E6EB]" />
          <Button icon={<Star size={14} className={followed ? 'fill-[#FA8C16] text-[#FA8C16]' : ''} />} onClick={() => follow.mutate()} data-testid="btn-follow-bug">
            {followed ? '已关注' : '关注'}
          </Button>
          <Button icon={<Share2 size={14} />} onClick={share} data-testid="btn-share-bug">分享</Button>
          {canUpdate && (
            <Button
              type={editing ? 'default' : 'primary'} ghost={!editing}
              icon={<Pencil size={14} />}
              onClick={() => {
                if (editing) { setEditing(false); return; }
                setForm({ title: bug.title, description: bug.description, handleUserId: bug.handleUserId ?? undefined, tags: bug.tags, fields: bug.fields });
                setEditing(true);
                setTab('detail');
              }}
              data-testid="btn-edit-bug"
            >
              {editing ? '取消编辑' : '编辑'}
            </Button>
          )}
        </div>
      </div>
      <p className="text-xs text-[#A8ABB0] mt-1.5 mb-4">
        创建人 {memberName(bug.createdBy) ?? bug.createdBy.slice(0, 8)} · {bug.createdAt.replace('T', ' ').slice(0, 16)} · 更新 {bug.updatedAt.replace('T', ' ').slice(0, 16)} · v{bug.version}
      </p>

      {/* Tab：详情 / 关联用例 / 评论 / 变更历史 */}
      <div className="flex items-center gap-5 text-[13px] border-b border-[#E5E6EB] mb-4">
        {tabs.map((t) => (
          <span
            key={t.key}
            data-testid={t.testid}
            className={`pb-2 -mb-px border-b-2 cursor-pointer transition-colors ${tab === t.key ? 'border-[#574BFF] text-[#574BFF] font-medium' : 'border-transparent text-[#646A73] hover:text-[#3D4350]'}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </span>
        ))}
      </div>

      {editing && tab === 'detail' && (
        <div className="rabbit-card p-6 space-y-5 mb-4" data-testid="bug-edit-form">
          <div className="grid grid-cols-[80px_1fr] items-center gap-3">
            <label className="text-[13px] text-[#3D4350]">标题 <span className="text-[#FF4D4F]">*</span></label>
            <Input value={form!.title} maxLength={512} onChange={(e) => setForm({ ...form!, title: e.target.value })} data-testid="input-edit-title" />
          </div>
          <div className="grid grid-cols-[80px_1fr] gap-3">
            <label className="text-[13px] text-[#3D4350]">描述</label>
            <Input.TextArea rows={5} maxLength={8000} value={form!.description} onChange={(e) => setForm({ ...form!, description: e.target.value })} data-testid="input-edit-description" />
          </div>
          <div className="grid grid-cols-[80px_1fr] items-center gap-3">
            <label className="text-[13px] text-[#3D4350]">处理人</label>
            <MemberSelect projectId={projectId!} value={form!.handleUserId} onChange={(v) => setForm({ ...form!, handleUserId: Array.isArray(v) ? v[0] : v })} />
          </div>
          <div className="grid grid-cols-[80px_1fr] items-center gap-3">
            <label className="text-[13px] text-[#3D4350]">标签</label>
            <Select mode="tags" className="w-full" value={form!.tags} placeholder="输入回车添加" onChange={(tags) => setForm({ ...form!, tags })} data-testid="input-edit-tags" />
          </div>
          <div>
            <p className="text-[13px] text-[#3D4350] mb-2">自定义字段</p>
            <DynamicFieldForm
              defs={defs}
              bindings={tplBindings}
              value={form!.fields}
              onChange={(fields) => setForm({ ...form!, fields })}
              members={(membersQ.data?.items ?? []).map((m) => ({ id: m.id, name: m.name }))}
            />
          </div>
          <div className="flex gap-2">
            <Button type="primary" loading={saveEdit.isPending} disabled={!form!.title.trim()} onClick={() => saveEdit.mutate()} data-testid="btn-save-edit">保存</Button>
            <Button onClick={() => setEditing(false)}>取消</Button>
          </div>
        </div>
      )}

      {tab === 'detail' && !editing && (
        <div className="rabbit-card p-5 max-w-4xl space-y-5" data-testid="bug-detail-panel">
          <div>
            <p className="text-sm font-medium mb-2">描述</p>
            <MarkdownView md={bug.description} className="bg-[#F7F8FA] rounded p-3 text-[#646A73]" />
          </div>
          {visibleDefs.length > 0 && (
            <div>
              <p className="text-sm font-medium mb-2">自定义字段</p>
              <div className="grid grid-cols-3 gap-x-6 gap-y-3 text-[13px]" data-testid="bug-dynamic-fields">
                {visibleDefs.map((d) => (
                  <p key={d.key} className="text-[#646A73] flex gap-2">
                    <span className="shrink-0">{d.name}</span>
                    <span className="font-medium text-[#1F2329] min-w-0"><DynamicFieldCell def={d} value={bug.fields[d.key]} /></span>
                  </p>
                ))}
              </div>
            </div>
          )}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <p className="text-sm font-medium m-0">附件（{attachQ.data?.length ?? 0}）</p>
              {canUpdate && (
                <Upload {...uploadProps}>
                  <Button size="small" icon={<UploadIcon size={13} />} data-testid="btn-upload-attachment">上传附件</Button>
                </Upload>
              )}
              <span className="text-xs text-[#A8ABB0]">单文件 ≤50MB；可执行文件拒收</span>
            </div>
            {(attachQ.data ?? []).length === 0 ? (
              <p className="text-[13px] text-[#A8ABB0]">暂无附件</p>
            ) : (
              <div className="divide-y divide-[#F0F1F3]" data-testid="attachment-list">
                {(attachQ.data ?? []).map((a) => (
                  <div key={a.id} className="flex items-center gap-3 py-2 text-[13px]">
                    <span className="truncate flex-1 min-w-0" data-testid={`attachment-name-${a.id}`}>{a.name}</span>
                    <span className="text-xs text-[#A8ABB0]">{fmtSize(a.size)}</span>
                    <a className="text-[#574BFF]" href={bugApi.downloadUrl(projectId!, a.id)} target="_blank" rel="noreferrer">下载</a>
                    {canUpdate && (
                      <Popconfirm title={`删除附件「${a.name}」？`} onConfirm={() => removeAttachment.mutate(a.id)}>
                        <Button type="text" size="small" danger icon={<X size={13} />} />
                      </Popconfirm>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'cases' && (
        <div className="rabbit-card">
          <div className="flex items-center gap-3 p-3 border-b border-[#F0F1F3]">
            <span className="font-medium text-sm">关联用例</span>
            {canUpdate && (
              <Button type="primary" size="small" className="ml-auto" onClick={() => { setLinkKeyword(''); setLinkCaseId(undefined); setLinkOpen(true); }} data-testid="btn-link-case">＋ 关联用例</Button>
            )}
          </div>
          <Table
            rowKey="caseId"
            dataSource={linkedCasesQ.data ?? []}
            loading={linkedCasesQ.isLoading}
            pagination={false}
            size="small"
            columns={[
              { title: '编号', dataIndex: 'num', width: 100, render: (n: number) => <span className="text-[#87888D]">C-{String(n).padStart(4, '0')}</span> },
              { title: '名称', dataIndex: 'name', render: (v: string, r) => <a className="text-[#574BFF]" href={`/cases/${r.caseId}`}>{v}</a> },
              { title: '等级', dataIndex: 'level', width: 80, render: (l: string) => <Tag bordered={false}>{l}</Tag> },
              {
                title: '操作', key: 'op', width: 80,
                render: (_, r) => canUpdate ? (
                  <Popconfirm title="解绑该用例？" onConfirm={() => unlinkCase.mutate(r.caseId)}>
                    <Button type="link" size="small" danger className="!px-0">解绑</Button>
                  </Popconfirm>
                ) : <span className="text-xs text-[#A8ABB0]">—</span>,
              },
            ]}
          />
        </div>
      )}

      {tab === 'comments' && (
        <div className="rabbit-card p-5">
          <CommentThread projectId={projectId!} entity={`bug:${id}`} canModeratePerm="PROJECT_BUG:UPDATE" currentUserId={meQ.data?.userId ?? ''} />
        </div>
      )}

      {tab === 'history' && (
        <div className="rabbit-card p-5 max-w-4xl">
          <p className="text-xs text-[#A8ABB0] mb-2">口径：流转与编辑历史；当前版本以流转记录为准（取流转时自动写入的评论，按时间倒序）。</p>
          <ChangeTimeline items={flowItems} />
        </div>
      )}

      {/* 流转确认弹窗 */}
      <Modal
        title={`流转为「${transitionTo ?? ''}」`}
        open={Boolean(transitionTo)}
        onCancel={() => setTransitionTo(null)}
        okText="确认流转"
        cancelText="取消"
        confirmLoading={doTransition.isPending}
        onOk={() => doTransition.mutate()}
      >
        <p className="text-[13px] mb-2">目标状态：<b>{transitionTo}</b></p>
        <Input.TextArea
          rows={3} maxLength={2000}
          placeholder="意见（可选，随流转写入评论）"
          value={transitionComment}
          onChange={(e) => setTransitionComment(e.target.value)}
          data-testid="input-transition-comment"
        />
      </Modal>

      {/* 关联用例弹窗 */}
      <Modal
        title="关联用例"
        open={linkOpen}
        onCancel={() => setLinkOpen(false)}
        okText="关联"
        cancelText="取消"
        okButtonProps={{ disabled: !linkCaseId }}
        confirmLoading={linkCase.isPending}
        onOk={() => linkCase.mutate()}
      >
        <Input.Search
          className="mb-3"
          placeholder="搜索用例编号 / 名称"
          allowClear
          onSearch={(v) => setLinkKeyword(v)}
          data-testid="input-link-case-search"
        />
        <Select
          className="w-full"
          placeholder="选择用例"
          showSearch optionFilterProp="label"
          value={linkCaseId}
          onChange={setLinkCaseId}
          options={(caseSearchQ.data?.items ?? []).map((c) => ({ value: c.id, label: `C-${String(c.num).padStart(4, '0')} ${c.name}` }))}
          loading={caseSearchQ.isLoading}
          data-testid="select-link-case"
        />
      </Modal>
    </div>
  );
}

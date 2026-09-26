'use client';

import { Button, Empty, Input, Modal, Popconfirm, Select, Tag } from 'antd';
import { Copy, Pencil, Share2, Star, X } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import {
  authApi, bugApi, caseAggApi, caseApiV2, commentApi, dependencyApi, fieldDefApi, memberApi, moduleApi, prefApi, templateApi,
} from '@rabbit/api-client';
import type { FieldDefInput, TemplateFieldBinding } from '@rabbit/shared';
import { ChangeTimeline, CommentThread, MarkdownView } from '@/components/crosscut';
import { DynamicFieldCell, type DynFieldDef } from '@/components/DynamicField';
import { CaseForm, flattenModules } from '@/components/CaseForm';
import { useApp } from '@/hooks/useApp';
import { usePermissions, useProjectInfo } from '@/hooks/usePermissions';
import { useProjectStore } from '@/stores/project';

/** CASE-003：用例详情 7 Tab（详情/依赖关系/用例评审/测试计划/缺陷/评论/变更历史）。 */

const levelColor: Record<string, string> = { P0: 'red', P1: 'orange', P2: 'blue', P3: 'default' };
const STATUS_TEXT: Record<string, string> = { PREPARING: '未开始', UNDERWAY: '进行中', COMPLETED: '已完成', FAILED: '失败' };
const STATUS_COLOR: Record<string, string> = { PREPARING: 'default', UNDERWAY: 'processing', COMPLETED: 'success', FAILED: 'error' };
const REVIEW_RESULT: Record<string, { label: string; color: string }> = {
  PASS: { label: '通过', color: 'success' },
  FAIL: { label: '不通过', color: 'error' },
  SUGGEST: { label: '有建议', color: 'warning' },
};
const REVIEW_STATUS: Record<string, string> = { UNDERWAY: '评审中', CLOSED: '已结束' };
const PLAN_STATUS: Record<string, string> = { NOT_STARTED: '未开始', UNDERWAY: '进行中', COMPLETED: '已完成', ARCHIVED: '已归档' };
const EXEC_RESULT: Record<string, { label: string; color: string }> = {
  NOT_RUN: { label: '未执行', color: 'default' },
  PASS: { label: '通过', color: 'success' },
  FAIL: { label: '失败', color: 'error' },
  BLOCKED: { label: '阻塞', color: 'warning' },
  SKIPPED: { label: '跳过', color: 'default' },
};
const TAB_KEYS = ['detail', 'dependencies', 'reviews', 'plans', 'bugs', 'comments', 'changes'] as const;
type TabKey = (typeof TAB_KEYS)[number];

function CaseDetailInner() {
  const { id } = useParams<{ id: string }>();
  const search = useSearchParams();
  const qc = useQueryClient();
  const { message } = useApp();
  const { can } = usePermissions();
  const { currentProjectId } = useProjectStore();
  const project = useProjectInfo();
  const orgId = project?.org.id ?? null;
  const projectId = currentProjectId;
  const canUpdate = can('PROJECT_CASE:UPDATE');

  const [tab, setTab] = useState<TabKey>('detail');
  const [editing, setEditing] = useState(search.get('edit') === '1');
  const [depOpen, setDepOpen] = useState(false);
  const [depKeyword, setDepKeyword] = useState('');
  const [depTarget, setDepTarget] = useState<string>();
  const [bugOpen, setBugOpen] = useState(false);
  const [bugKeyword, setBugKeyword] = useState('');
  const [bugTarget, setBugTarget] = useState<string>();

  const caseQ = useQuery({
    queryKey: ['case', 'detail', projectId, id],
    queryFn: () => caseApiV2.detail(projectId!, id),
    enabled: Boolean(projectId && id),
  });
  const modulesQ = useQuery({
    queryKey: ['modules', projectId, 'case'],
    queryFn: () => moduleApi.list(projectId!, 'case'),
    enabled: Boolean(projectId),
  });
  const defsQ = useQuery({
    queryKey: ['field-defs', orgId, 'case'],
    queryFn: () => fieldDefApi.list(orgId!, 'case'),
    enabled: Boolean(orgId),
  });
  const templatesQ = useQuery({
    queryKey: ['templates', orgId, projectId, 'case'],
    queryFn: () => templateApi.list(orgId!, projectId!, 'case'),
    enabled: Boolean(orgId && projectId),
  });
  const membersQ = useQuery({
    queryKey: ['members', projectId],
    queryFn: () => memberApi.projectMembers(projectId!),
    enabled: Boolean(projectId),
    staleTime: 60_000,
  });
  const meQ = useQuery({ queryKey: ['me'], queryFn: () => authApi.me(), staleTime: 5 * 60_000 });
  const followedQ = useQuery({
    queryKey: ['case', 'followed', projectId],
    queryFn: () => caseApiV2.list(projectId!, { page: 1, pageSize: 100, followedBy: meQ.data!.userId }),
    enabled: Boolean(projectId && id && meQ.data?.userId),
  });
  const depsQ = useQuery({
    queryKey: ['case', 'deps', projectId, id],
    queryFn: () => dependencyApi.list(projectId!, id),
    enabled: Boolean(projectId && id),
  });
  const reviewsQ = useQuery({
    queryKey: ['case', 'reviews', projectId, id],
    queryFn: () => caseAggApi.reviews(projectId!, id),
    enabled: Boolean(projectId && id),
  });
  const plansQ = useQuery({
    queryKey: ['case', 'plans', projectId, id],
    queryFn: () => caseAggApi.plans(projectId!, id),
    enabled: Boolean(projectId && id),
  });
  const bugsQ = useQuery({
    queryKey: ['case', 'bugs', projectId, id],
    queryFn: () => caseAggApi.bugs(projectId!, id),
    enabled: Boolean(projectId && id),
  });
  const changesQ = useQuery({
    queryKey: ['case', 'changes', projectId, id],
    queryFn: () => caseAggApi.changes(projectId!, id),
    enabled: Boolean(projectId && id),
  });
  const commentsQ = useQuery({
    queryKey: ['comments', projectId, `case:${id}`],
    queryFn: () => commentApi.list(projectId!, `case:${id}`),
    enabled: Boolean(projectId && id),
  });
  const depSearchQ = useQuery({
    queryKey: ['case', 'list-v2', projectId, depKeyword],
    queryFn: () => caseApiV2.list(projectId!, { page: 1, pageSize: 20, keyword: depKeyword || undefined }),
    enabled: Boolean(projectId && depOpen),
  });
  const bugSearchQ = useQuery({
    queryKey: ['bug', 'list', projectId, bugKeyword],
    queryFn: () => bugApi.list(projectId!, { page: 1, pageSize: 20, keyword: bugKeyword || undefined, recycled: false }),
    enabled: Boolean(projectId && bugOpen),
  });

  const kase = caseQ.data;
  const flatModules = flattenModules(modulesQ.data?.items ?? []);
  const modulePath = (() => {
    const segs: string[] = [];
    let cur = flatModules.find((m) => m.id === kase?.moduleId);
    while (cur) {
      segs.unshift(cur.name);
      cur = flatModules.find((m) => m.id === cur!.parentId);
    }
    return segs.join(' / ');
  })();
  const memberName = (uid: string | null) => membersQ.data?.items.find((m) => m.id === uid)?.name ?? '—';

  const defs: DynFieldDef[] = (defsQ.data ?? [])
    .filter((d) => d.enabled)
    .map((d) => ({ ...d, options: d.options as FieldDefInput['options'] }) as DynFieldDef);
  const bindings: TemplateFieldBinding[] | undefined = (() => {
    const list = templatesQ.data ?? [];
    const tpl = (kase?.templateId ? list.find((t) => t.id === kase.templateId) : null) ?? list.find((t) => t.isDefault);
    return tpl?.fields?.map((b) => ({ ...b, visibleInList: b.visibleInList ?? false }));
  })();
  const boundDefs = bindings ? defs.filter((d) => bindings.some((b) => b.fieldKey === d.key)) : defs;

  // 当前 Tab 记忆（case_tab）
  useEffect(() => {
    if (!projectId) return;
    prefApi.get('case_tab', projectId)
      .then((r) => { if (typeof r.value === 'string' && (TAB_KEYS as readonly string[]).includes(r.value)) setTab(r.value as TabKey); })
      .catch(() => undefined);
  }, [projectId]);
  const switchTab = (key: TabKey) => {
    setTab(key);
    if (projectId) void prefApi.put('case_tab', projectId, key).catch(() => undefined);
  };

  const following = followedQ.data ? (followedQ.data.items.some((c) => c.id === id)) : false;
  const invalidateFollow = () => void qc.invalidateQueries({ queryKey: ['case', 'followed', projectId] });

  const follow = useMutation({
    mutationFn: (on: boolean) => caseApiV2.follow(projectId!, id, on),
    onSuccess: (_r, on) => { invalidateFollow(); message.success(on ? '已关注，变更将提醒' : '已取消关注'); },
    onError: (e) => message.error(e instanceof Error ? e.message : '操作失败'),
  });
  const copyCase = useMutation({
    mutationFn: () => caseApiV2.copy(projectId!, id),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['case'] });
      message.success(`已复制为「${r.name}」（C-${String(r.num).padStart(4, '0')}，草稿）`);
    },
    onError: (e) => message.error(e instanceof Error ? e.message : '复制失败'),
  });
  const addDep = useMutation({
    mutationFn: () => dependencyApi.create(projectId!, id, depTarget!),
    onSuccess: () => {
      setDepOpen(false); setDepTarget(undefined); setDepKeyword('');
      void qc.invalidateQueries({ queryKey: ['case', 'deps', projectId, id] });
      message.success('已添加前置依赖');
    },
    onError: (e) => message.error(e instanceof Error ? e.message : '添加失败'),
  });
  const removeDep = useMutation({
    mutationFn: (depId: string) => dependencyApi.remove(projectId!, id, depId),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['case', 'deps', projectId, id] }); message.success('已解除依赖'); },
    onError: (e) => message.error(e instanceof Error ? e.message : '解除失败'),
  });
  const linkBug = useMutation({
    mutationFn: () => caseAggApi.linkBug(projectId!, id, bugTarget!),
    onSuccess: () => {
      setBugOpen(false); setBugTarget(undefined); setBugKeyword('');
      void qc.invalidateQueries({ queryKey: ['case', 'bugs', projectId, id] });
      message.success('已关联缺陷');
    },
    onError: (e) => message.error(e instanceof Error ? e.message : '关联失败'),
  });
  const unlinkBug = useMutation({
    mutationFn: (bugId: string) => caseAggApi.unlinkBug(projectId!, id, bugId),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['case', 'bugs', projectId, id] }); message.success('已解绑缺陷'); },
    onError: (e) => message.error(e instanceof Error ? e.message : '解绑失败'),
  });

  async function share() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      message.success('链接已复制');
    } catch {
      message.error('复制失败，请手动复制地址栏链接');
    }
  }

  if (!projectId) return <Empty description="请先选择项目" />;
  if (!kase) return <div className="rabbit-card p-6 text-[13px] text-[#A8ABB0]">{caseQ.isLoading ? '加载中…' : '用例不存在或已删除'}</div>;

  const deps = depsQ.data ?? { pre: [], post: [] };
  const reviews = reviewsQ.data ?? [];
  const plans = plansQ.data ?? [];
  const bugs = bugsQ.data ?? [];
  const comments = commentsQ.data?.items ?? [];
  const depCandidates = (depSearchQ.data?.items ?? []).filter((c) => c.id !== id);

  const tabs: { key: TabKey; label: string; testid: string; badge?: number }[] = [
    { key: 'detail', label: '详情', testid: 'tab-detail' },
    { key: 'dependencies', label: '依赖关系', testid: 'tab-dependencies' },
    { key: 'reviews', label: '用例评审', testid: 'tab-reviews' },
    { key: 'plans', label: '测试计划', testid: 'tab-plans' },
    { key: 'bugs', label: '缺陷', testid: 'tab-bugs', badge: bugs.length },
    { key: 'comments', label: '评论', testid: 'tab-comments', badge: comments.length },
    { key: 'changes', label: '变更历史', testid: 'tab-changes' },
  ];

  const depList = (list: typeof deps.pre, title: string) => (
    <div className="rabbit-card flex-1 min-w-0">
      <div className="flex items-center justify-between px-4 h-11 border-b border-[#F0F1F3]">
        <span className="text-sm font-medium">{title}（{list.length}）</span>
      </div>
      <div className="p-2">
        {list.length === 0 && <p className="text-[13px] text-[#A8ABB0] p-2">暂无{title}</p>}
        {list.map((d) => (
          <div key={d.id} className="flex items-center gap-2 px-2 py-2 border-b border-[#F7F8FA] last:border-0">
            <span className="text-xs text-[#87888D] shrink-0">C-{String(d.case.num).padStart(4, '0')}</span>
            <a className="text-[13px] text-[#574BFF] truncate flex-1" href={`/cases/${d.case.id}`}>{d.case.name}</a>
            <Tag bordered={false} color={levelColor[d.case.level]}>{d.case.level}</Tag>
            {canUpdate && (
              <Popconfirm title="解除该依赖？" onConfirm={() => removeDep.mutate(d.id)}>
                <Button type="text" size="small" danger icon={<X size={13} />} />
              </Popconfirm>
            )}
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="max-w-5xl">
      {/* 页头：面包屑 + 用例名 + 状态/等级/编号 + 关注/分享/复制/编辑 */}
      <p className="text-xs text-[#A8ABB0] mb-2" data-testid="case-breadcrumb">
        <a className="hover:text-[#574BFF]" href="/cases">测试用例</a>
        {modulePath && <> / {modulePath}</>}
      </p>
      <div className="flex items-center gap-3 flex-wrap mb-4">
        <h1 className="text-lg font-medium m-0" data-testid="case-title">{kase.name}</h1>
        <Tag color={STATUS_COLOR[kase.status] ?? 'default'}>{STATUS_TEXT[kase.status] ?? kase.status}</Tag>
        <Tag bordered={false} color={levelColor[kase.level]}>{kase.level}</Tag>
        <span className="text-xs text-[#A8ABB0]">C-{String(kase.num).padStart(4, '0')} · v{kase.version}</span>
        <div className="ml-auto flex gap-2 items-center">
          <Button
            icon={<Star size={14} className={following ? 'fill-[#FA8C16] text-[#FA8C16]' : ''} />}
            onClick={() => follow.mutate(!following)}
            data-testid="btn-follow-case"
          >
            {following ? '已关注' : '关注'}
          </Button>
          <Button icon={<Share2 size={14} />} onClick={() => void share()} data-testid="btn-share-case">分享</Button>
          <Button icon={<Copy size={14} />} onClick={() => copyCase.mutate()} data-testid="btn-copy-case" loading={copyCase.isPending}>复制</Button>
          {canUpdate && !editing && (
            <Button type="primary" icon={<Pencil size={14} />} onClick={() => setEditing(true)} data-testid="btn-edit-case">编辑</Button>
          )}
          {editing && (
            <Button onClick={() => setEditing(false)} data-testid="btn-cancel-edit">退出编辑</Button>
          )}
        </div>
      </div>

      {/* Tab 条（7 个；当前 Tab 记忆到用户偏好） */}
      <div className="bg-white border border-[#E5E6EB] rounded-md px-4 flex items-center gap-6 text-[13px] mb-4 h-11" data-testid="case-detail-tabs">
        {tabs.map((t) => (
          <span
            key={t.key}
            data-testid={t.testid}
            className={`h-full flex items-center border-b-2 -mb-px cursor-pointer transition-colors ${tab === t.key ? 'border-[#574BFF] text-[#574BFF] font-medium' : 'border-transparent text-[#646A73] hover:text-[#3D4350]'}`}
            onClick={() => switchTab(t.key)}
          >
            {t.label}
            {t.badge !== undefined && <span className="ml-1 text-xs bg-[#F2F3F5] rounded px-1">{t.badge}</span>}
          </span>
        ))}
      </div>

      {/* Tab1 详情：编辑态=CaseForm 内嵌；查看态=基本信息/前置与步骤/自定义字段三卡 */}
      {tab === 'detail' && (
        editing ? (
          <div className="rabbit-card p-6" data-testid="case-edit-panel">
            <CaseForm caseId={id} embedded onSaved={() => setEditing(false)} onCancel={() => setEditing(false)} />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rabbit-card p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-medium text-sm m-0">基本信息</h2>
                {canUpdate && <Button type="link" size="small" className="!px-0" onClick={() => setEditing(true)} data-testid="btn-edit-basic">编辑</Button>}
              </div>
              <div className="grid grid-cols-3 gap-y-3 gap-x-8 text-sm">
                <div><p className="text-xs text-[#A8ABB0] mb-0.5">所属模块</p><p>{modulePath || '—'}</p></div>
                <div><p className="text-xs text-[#A8ABB0] mb-0.5">等级</p><p><span className={kase.level === 'P0' ? 'text-[#FF4D4F] font-medium' : ''}>{kase.level}</span></p></div>
                <div><p className="text-xs text-[#A8ABB0] mb-0.5">状态</p><p>{STATUS_TEXT[kase.status] ?? kase.status}</p></div>
                <div>
                  <p className="text-xs text-[#A8ABB0] mb-0.5">标签</p>
                  <p className="flex gap-1.5 flex-wrap">
                    {kase.tags.length ? kase.tags.map((t) => <Tag key={t} bordered={false}>{t}</Tag>) : <span className="text-[#A8ABB0]">—</span>}
                  </p>
                </div>
                <div><p className="text-xs text-[#A8ABB0] mb-0.5">创建人 / 时间</p><p>{memberName(kase.createdBy)} · {kase.createdAt.replace('T', ' ').slice(0, 16)}</p></div>
                <div><p className="text-xs text-[#A8ABB0] mb-0.5">最后更新</p><p>{kase.updatedAt.replace('T', ' ').slice(0, 16)}</p></div>
              </div>
            </div>

            <div className="rabbit-card p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-medium text-sm m-0">前置与步骤</h2>
                <span className="text-xs border border-[#E5E6EB] rounded px-2 py-0.5 text-[#87888D]">支持受限 Markdown（粗体/列表/链接/代码块/表格）</span>
              </div>
              <p className="text-xs text-[#A8ABB0] mb-1">前置条件</p>
              <MarkdownView md={kase.precondition} className="mb-4" />
              <table className="w-full text-sm" data-testid="case-steps-view">
                <thead className="text-[#87888D] text-xs">
                  <tr className="border-b border-[#F0F1F3]">
                    <th className="text-left py-2 w-12">步骤</th>
                    <th className="text-left py-2">操作</th>
                    <th className="text-left py-2">预期结果</th>
                  </tr>
                </thead>
                <tbody>
                  {kase.steps.length === 0 && (
                    <tr><td colSpan={3} className="py-3 text-[#A8ABB0] text-center">暂无步骤</td></tr>
                  )}
                  {kase.steps.map((s, i) => (
                    <tr key={i} className="border-b border-[#F7F8FA] last:border-0">
                      <td className="py-2 text-[#87888D] align-top">{i + 1}</td>
                      <td className="py-2 align-top"><MarkdownView md={s.desc} /></td>
                      <td className="py-2 align-top"><MarkdownView md={s.expect} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {boundDefs.length > 0 && (
              <div className="rabbit-card p-5" data-testid="case-dynamic-fields">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="font-medium text-sm m-0">自定义字段</h2>
                  {canUpdate && <Button type="link" size="small" className="!px-0" onClick={() => setEditing(true)}>编辑</Button>}
                </div>
                <div className="grid grid-cols-4 gap-y-3 gap-x-6 text-sm">
                  {boundDefs.map((d) => (
                    <div key={d.key}>
                      <p className="text-xs text-[#A8ABB0] mb-0.5">{d.name}</p>
                      <p><DynamicFieldCell def={d} value={kase.fields?.[d.key]} /></p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )
      )}

      {/* Tab2 依赖关系：前置/后置两列 + 添加前置依赖 */}
      {tab === 'dependencies' && (
        <div>
          {canUpdate && (
            <div className="mb-3 flex justify-end">
              <Button type="primary" size="small" onClick={() => { setDepKeyword(''); setDepTarget(undefined); setDepOpen(true); }} data-testid="btn-add-dependency">＋ 添加前置依赖</Button>
            </div>
          )}
          <div className="flex gap-4">
            {depList(deps.pre, '前置依赖（本用例依赖的用例）')}
            {depList(deps.post, '后置依赖（依赖本用例的用例）')}
          </div>
          <p className="text-xs text-[#A8ABB0] mt-2">依赖关系双向同步：B 依赖 A 时，A 的后置列表自动出现 B；删除任一侧即解除。</p>
        </div>
      )}

      {/* Tab3 用例评审 */}
      {tab === 'reviews' && (
        <div className="rabbit-card">
          {reviews.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} className="py-10" description={<span>暂未参与用例评审，可从<a className="text-[#574BFF]" href="/reviews">用例评审</a>页发起并将本用例加入范围</span>} />
          ) : (
            <table className="w-full text-sm" data-testid="case-review-table">
              <thead className="text-[#87888D] text-xs bg-[#F7F8FA]">
                <tr><th className="text-left p-3">评审名称</th><th className="text-left p-3 w-24">我的评审结果</th><th className="text-left p-3 w-20">重新提审</th><th className="text-left p-3 w-24">评审状态</th><th className="text-left p-3 w-40">时间</th></tr>
              </thead>
              <tbody>
                {reviews.map((r) => (
                  <tr key={r.reviewId} className="border-t border-[#F0F1F3]">
                    <td className="p-3"><a className="text-[#574BFF]" href={`/reviews/${r.reviewId}`}>{r.name}</a></td>
                    <td className="p-3">{r.result ? <Tag bordered={false} color={REVIEW_RESULT[r.result]?.color ?? 'default'}>{REVIEW_RESULT[r.result]?.label ?? r.result}</Tag> : <span className="text-[#A8ABB0] text-xs">待评审</span>}</td>
                    <td className="p-3">{r.reSubmit && <Tag color="warning" bordered={false}>重新提审</Tag>}</td>
                    <td className="p-3 text-xs">{REVIEW_STATUS[r.status] ?? r.status}</td>
                    <td className="p-3 text-xs text-[#87888D]">{(r.endAt ?? r.startAt ?? '').replace('T', ' ').slice(0, 16) || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Tab4 测试计划 */}
      {tab === 'plans' && (
        <div className="rabbit-card">
          {plans.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} className="py-10" description={<span>暂未关联测试计划，可从<a className="text-[#574BFF]" href="/plans">测试计划</a>页关联本用例</span>} />
          ) : (
            <table className="w-full text-sm" data-testid="case-plan-table">
              <thead className="text-[#87888D] text-xs bg-[#F7F8FA]">
                <tr><th className="text-left p-3">计划名称</th><th className="text-left p-3 w-24">计划状态</th><th className="text-left p-3 w-28">我的执行结果</th></tr>
              </thead>
              <tbody>
                {plans.map((p) => (
                  <tr key={p.planId} className="border-t border-[#F0F1F3]">
                    <td className="p-3"><a className="text-[#574BFF]" href={`/plans/${p.planId}`}>{p.name}</a></td>
                    <td className="p-3 text-xs">{PLAN_STATUS[p.planStatus] ?? p.planStatus}{p.archived && <Tag className="ml-1" bordered={false}>已归档</Tag>}</td>
                    <td className="p-3">
                      {p.myExecStatus
                        ? <Tag bordered={false} color={EXEC_RESULT[p.myExecStatus]?.color ?? 'default'}>{EXEC_RESULT[p.myExecStatus]?.label ?? p.myExecStatus}</Tag>
                        : <span className="text-[#A8ABB0] text-xs">未分配给我 / 未执行</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Tab5 缺陷 */}
      {tab === 'bugs' && (
        <div className="rabbit-card">
          <div className="flex items-center gap-2 p-3 border-b border-[#F0F1F3]">
            <span className="font-medium text-sm">关联缺陷</span>
            <div className="ml-auto flex gap-2">
              {canUpdate && <Button size="small" onClick={() => { setBugKeyword(''); setBugTarget(undefined); setBugOpen(true); }} data-testid="btn-link-bug">关联已有缺陷</Button>}
              <Button size="small" href="/bugs/new" data-testid="btn-new-bug-link">新建缺陷</Button>
            </div>
          </div>
          {bugs.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} className="py-8" description="暂未关联缺陷；执行失败时可将缺陷关联到本用例" />
          ) : (
            <table className="w-full text-sm" data-testid="case-bug-table">
              <thead className="text-[#87888D] text-xs bg-[#F7F8FA]">
                <tr><th className="text-left p-3 w-24">编号</th><th className="text-left p-3">标题</th><th className="text-left p-3 w-28">状态</th><th className="text-left p-3 w-20">操作</th></tr>
              </thead>
              <tbody>
                {bugs.map((b) => (
                  <tr key={b.bugId} className="border-t border-[#F0F1F3]">
                    <td className="p-3 text-[#87888D]">B-{String(b.num).padStart(4, '0')}</td>
                    <td className="p-3"><a className="text-[#574BFF]" href={`/bugs/${b.bugId}`}>{b.title}</a></td>
                    <td className="p-3 text-xs">{b.status}</td>
                    <td className="p-3">
                      {canUpdate ? (
                        <Popconfirm title="解绑该缺陷？" onConfirm={() => unlinkBug.mutate(b.bugId)}>
                          <Button type="link" size="small" danger className="!px-0">解绑</Button>
                        </Popconfirm>
                      ) : <span className="text-xs text-[#A8ABB0]">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Tab6 评论 */}
      {tab === 'comments' && (
        <div className="rabbit-card p-5">
          <CommentThread projectId={projectId} entity={`case:${id}`} canModeratePerm="PROJECT_CASE:UPDATE" currentUserId={meQ.data?.userId ?? ''} />
        </div>
      )}

      {/* Tab7 变更历史 */}
      {tab === 'changes' && (
        <div className="rabbit-card p-5">
          <ChangeTimeline items={changesQ.data?.items ?? []} />
        </div>
      )}

      {/* 添加前置依赖弹窗（搜索选择用例，排除自身） */}
      <Modal
        title="添加前置依赖"
        open={depOpen}
        onCancel={() => setDepOpen(false)}
        okText="添加"
        cancelText="取消"
        okButtonProps={{ disabled: !depTarget }}
        confirmLoading={addDep.isPending}
        onOk={() => addDep.mutate()}
      >
        <Input.Search
          className="mb-3"
          placeholder="搜索用例名称"
          allowClear
          value={depKeyword}
          onChange={(e) => setDepKeyword(e.target.value)}
          data-testid="input-dep-search"
        />
        <Select
          className="w-full"
          placeholder="选择前置用例（本用例将依赖它执行）"
          showSearch
          optionFilterProp="label"
          virtual={false}
          value={depTarget}
          onChange={setDepTarget}
          options={depCandidates.map((c) => ({ value: c.id, label: `C-${String(c.num).padStart(4, '0')} ${c.name}` }))}
          loading={depSearchQ.isLoading}
          data-testid="select-dep-target"
        />
        <p className="text-xs text-[#A8ABB0] mt-2">已排除本用例；建立后对方用例的后置列表将同步出现本用例。</p>
      </Modal>

      {/* 关联已有缺陷弹窗 */}
      <Modal
        title="关联已有缺陷"
        open={bugOpen}
        onCancel={() => setBugOpen(false)}
        okText="关联"
        cancelText="取消"
        okButtonProps={{ disabled: !bugTarget }}
        confirmLoading={linkBug.isPending}
        onOk={() => linkBug.mutate()}
      >
        <Input.Search
          className="mb-3"
          placeholder="搜索缺陷标题"
          allowClear
          value={bugKeyword}
          onChange={(e) => setBugKeyword(e.target.value)}
          data-testid="input-bug-search"
        />
        <Select
          className="w-full"
          placeholder="选择缺陷"
          showSearch
          optionFilterProp="label"
          value={bugTarget}
          onChange={setBugTarget}
          options={(bugSearchQ.data?.items ?? []).map((b) => ({ value: b.id, label: `B-${String(b.num).padStart(4, '0')} ${b.title}` }))}
          loading={bugSearchQ.isLoading}
          data-testid="select-bug-target"
        />
      </Modal>
    </div>
  );
}

/** 编辑态由内嵌 CaseForm 承载（保存/取消退出编辑回到查看态）。 */
export default function CaseDetailPage() {
  return (
    <Suspense fallback={null}>
      <CaseDetailInner />
    </Suspense>
  );
}

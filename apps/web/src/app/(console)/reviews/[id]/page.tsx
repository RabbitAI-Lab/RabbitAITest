'use client';

import { Button, Collapse, Empty, Input, Modal, Popconfirm, Progress, Select, Switch, Table, Tag, Tooltip, Tree } from 'antd';
import { Plus } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { use, useEffect, useMemo, useState } from 'react';
import type { DataNode } from 'antd/es/tree';
import { caseApiV2, memberApi, moduleApi, reviewApi, type ReviewCaseRow } from '@rabbit/api-client';
import { useApp } from '@/hooks/useApp';
import { usePermissions } from '@/hooks/usePermissions';
import { useProjectStore } from '@/stores/project';

const MODE_TIP: Record<string, string> = {
  SINGLE: '单人评审：最后评审结果生效',
  MULTI: '多人评审：全员通过才通过，任一失败即失败，建议不否决',
};
const RESULT_META: Record<string, { label: string; color: string; tag: string }> = {
  PASS: { label: '通过', color: '#52C41A', tag: 'success' },
  FAIL: { label: '失败', color: '#FF4D4F', tag: 'error' },
  SUGGEST: { label: '建议', color: '#FA8C16', tag: 'warning' },
  PENDING: { label: '未评审', color: '#C9CDD4', tag: 'default' },
};
const levelColor: Record<string, string> = { P0: 'red', P1: 'orange', P2: 'blue', P3: 'default' };
const padNum = (n: number) => `C-${String(n).padStart(4, '0')}`;
const resultMeta = (v: string | null | undefined) =>
  RESULT_META[v ?? 'PENDING'] ?? { label: v ?? '未评审', color: '#C9CDD4', tag: 'default' };

/** CASE-005：评审详情——逐条评审工作台（左清单 + 右速览 + 底部标记操作条）。 */
export default function ReviewDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const qc = useQueryClient();
  const { message } = useApp();
  const { can } = usePermissions();
  const { currentProjectId: projectId } = useProjectStore();
  const [filter, setFilter] = useState<string>('ALL');
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [autoNext, setAutoNext] = useState(true);
  const [judgeResult, setJudgeResult] = useState<'PASS' | 'FAIL' | 'SUGGEST' | null>(null);
  const [comment, setComment] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);

  const { data: review, isLoading } = useQuery({
    queryKey: ['review', projectId, id],
    queryFn: () => reviewApi.detail(projectId!, id),
    enabled: Boolean(projectId),
  });
  const { data: members } = useQuery({
    queryKey: ['members', projectId],
    queryFn: () => memberApi.projectMembers(projectId!),
    enabled: Boolean(projectId),
    staleTime: 60_000,
  });
  const nameOf = (uid: string) => members?.items.find((m) => m.id === uid)?.name ?? '成员';

  const cases = review?.cases ?? [];
  const filtered = useMemo(
    () => (filter === 'ALL' ? cases : cases.filter((c) => (filter === 'PENDING' ? !c.result : c.result === filter))),
    [cases, filter],
  );
  const selected = cases.find((c) => c.caseId === selectedCaseId) ?? filtered[0] ?? cases[0] ?? null;

  useEffect(() => {
    if (!selectedCaseId && cases.length) setSelectedCaseId(cases[0]?.caseId ?? null);
  }, [cases, selectedCaseId]);

  const stats = useMemo(() => {
    const total = cases.length;
    const pass = cases.filter((c) => c.result === 'PASS').length;
    const fail = cases.filter((c) => c.result === 'FAIL').length;
    const suggest = cases.filter((c) => c.result === 'SUGGEST').length;
    return { total, pass, fail, suggest, judged: pass + fail + suggest, passRate: total === 0 ? 0 : Math.round((pass / total) * 100) };
  }, [cases]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['review', projectId, id] });
  const ended = review?.status === 'ENDED';
  const judgeable = Boolean(review?.isReviewer) && !ended;

  const judge = useMutation({
    mutationFn: (p: { caseId: string; result: 'PASS' | 'FAIL' | 'SUGGEST'; comment: string }) =>
      reviewApi.judge(projectId!, id, p.caseId, { result: p.result, comment: p.comment }),
    onSuccess: (_r, p) => {
      invalidate();
      message.success(`已标记「${resultMeta(p.result).label}」`);
      setJudgeResult(null);
      setComment('');
      if (autoNext) {
        const idx = cases.findIndex((c) => c.caseId === p.caseId);
        const next = [...cases.slice(idx + 1), ...cases.slice(0, idx + 1)].find((c) => !c.result && c.caseId !== p.caseId);
        if (next) setSelectedCaseId(next.caseId);
        else message.info('全部用例已评审');
      }
    },
    onError: (e) => message.error(e instanceof Error ? e.message : '标记失败'),
  });
  const close = useMutation({
    mutationFn: () => reviewApi.close(projectId!, id),
    onSuccess: () => { invalidate(); message.success('评审已结束'); },
    onError: (e) => message.error(e instanceof Error ? e.message : '操作失败'),
  });

  if (!projectId) return <div className="rabbit-card p-16 flex justify-center"><Empty description="请先选择项目" /></div>;
  if (isLoading || !review) return <div className="rabbit-card p-16 flex justify-center"><Empty description="加载中…" /></div>;

  const commentRequired = judgeResult === 'FAIL' || judgeResult === 'SUGGEST';
  const submitDisabled = !judgeable || !selected || !judgeResult || (commentRequired && !comment.trim());
  const lastJudgeText = (c: ReviewCaseRow) => {
    const last = c.results[c.results.length - 1];
    return last ? `${nameOf(last.userId)} · ${last.ts.slice(5, 10)} ${RESULT_META[last.result]?.label ?? last.result}` : '待评审';
  };

  return (
    <div>
      {/* 头部：名称 + 模式（tooltip）+ 状态 + 统计 + 通过率环形 + 结束按钮 */}
      <div className="rabbit-card p-4 flex items-center gap-6 mb-4">
        <div className="flex-1 min-w-0">
          <p className="text-xs text-[#A8ABB0] mb-1"><a href="/reviews" className="text-[#87888D] hover:text-[#574BFF] no-underline">用例评审</a> / {review.name}</p>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-lg font-medium m-0">{review.name}</h1>
            <Tooltip title={MODE_TIP[review.reviewMode]}>
              <Tag color={review.reviewMode === 'MULTI' ? 'blue' : 'default'} className="cursor-help">{review.reviewMode === 'MULTI' ? '多人评审' : '单人评审'} ⓘ</Tag>
            </Tooltip>
            <Tag color={ended ? 'default' : 'processing'}>{ended ? '已结束' : '进行中'}</Tag>
          </div>
          <p className="text-xs text-[#87888D] mt-2 mb-0">
            {review.startAt ? review.startAt.slice(0, 10) : '—'} ~ {review.endAt ? review.endAt.slice(0, 10) : '—'}
            {review.endAt && !ended && new Date(review.endAt).getTime() < Date.now() && <Tag color="warning" className="!ml-2">已逾期</Tag>}
            <span className="ml-3">已评 {stats.judged} / {stats.total} · 通过 {stats.pass} · 失败 {stats.fail} · 建议 {stats.suggest} · 未评审 {stats.total - stats.judged}</span>
          </p>
        </div>
        <Progress
          type="circle"
          size={80}
          percent={stats.passRate}
          strokeColor="#52C41A"
          data-testid="review-circle"
        />
        {can('PROJECT_CASE_REVIEW:UPDATE') && !ended && (
          <Popconfirm title="结束后不可再标记，确认结束？" okText="确认结束" onConfirm={() => close.mutate()}>
            <Button danger data-testid="btn-close-review-detail">结束评审</Button>
          </Popconfirm>
        )}
      </div>

      <div className="flex items-stretch gap-4">
        {/* 左：用例清单 */}
        <div className="w-80 shrink-0 rabbit-card !rounded-[10px] flex flex-col" data-testid="review-case-list">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-[#F0F1F3] flex-wrap">
            <Select
              size="small"
              className="w-24"
              value={filter}
              onChange={(v) => setFilter(v)}
              options={[
                { value: 'ALL', label: '全部状态' },
                { value: 'PASS', label: '通过' },
                { value: 'FAIL', label: '失败' },
                { value: 'SUGGEST', label: '建议' },
                { value: 'PENDING', label: '未评审' },
              ]}
              data-testid="review-filter-result"
            />
            <label className="flex items-center gap-1 text-xs text-[#646A73] cursor-pointer">
              <Switch size="small" checked={autoNext} onChange={setAutoNext} data-testid="switch-auto-next" />
              自动下一条
            </label>
            <Button
              size="small"
              type="primary"
              ghost
              icon={<Plus size={12} />}
              className="!ml-auto"
              disabled={ended || !can('PROJECT_CASE_REVIEW:UPDATE')}
              onClick={() => setLinkOpen(true)}
              data-testid="btn-add-review-cases"
            >
              关联用例
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto max-h-[calc(100vh-320px)] text-[13px]">
            {filtered.length === 0 && <Empty className="my-10" description={cases.length === 0 ? '暂未关联用例，点击右上「关联用例」' : '无该状态用例'} />}
            {filtered.map((c) => {
              const active = selected?.caseId === c.caseId;
              return (
                <div
                  key={c.refId}
                  data-testid={`review-case-item-${c.num}`}
                  className={`flex items-start gap-2 px-3 py-2.5 border-b border-l-2 border-b-[#F0F1F3] cursor-pointer transition-colors ${active ? 'border-l-[#574BFF] bg-[#574BFF]/[.05]' : 'border-l-transparent hover:bg-[#F7F8FA]'}`}
                  onClick={() => setSelectedCaseId(c.caseId)}
                >
                  <span className="w-2 h-2 rounded-full mt-1.5 shrink-0" style={{ background: resultMeta(c.result).color }} />
                  <span className="flex-1 min-w-0">
                    <span className="block truncate text-[#3D4350]">{padNum(c.num)} {c.name}</span>
                    <span className="block text-xs text-[#A8ABB0] mt-0.5">{lastJudgeText(c)}</span>
                  </span>
                  {c.reSubmit && (
                    <Tooltip title="用例在评审后被编辑（步骤/名称/等级/动态字段），已重置为未评审待重评">
                      <Tag color="warning" className="!mr-0 !text-[10px]">重新提审</Tag>
                    </Tooltip>
                  )}
                </div>
              );
            })}
          </div>
          <div className="border-t border-[#F0F1F3] px-3 py-2 text-xs text-[#87888D]">
            {filtered.length} / {cases.length} 条
          </div>
        </div>

        {/* 右：当前用例速览 */}
        <div className="flex-1 min-w-0 rabbit-card !rounded-[10px] p-4 flex flex-col">
          {!selected ? (
            <Empty className="my-16" description="选择左侧用例查看详情" />
          ) : (
            <>
              <div className="flex items-center gap-2 flex-wrap">
                <a className="text-[#574BFF] font-medium" href={`/cases/${selected.caseId}`}>{padNum(selected.num)} {selected.name}</a>
                <Tag color={levelColor[selected.level] ?? 'default'}>{selected.level}</Tag>
                <Tag bordered={false} color={resultMeta(selected.result).tag}>
                  {resultMeta(selected.result).label}
                </Tag>
                <Button type="link" size="small" className="!px-0 !ml-auto" onClick={() => setHistoryOpen(true)} data-testid="btn-review-history">评审历史</Button>
              </div>
              <div className="mt-3 text-[13px]">
                <p className="text-xs text-[#A8ABB0] mb-1">前置条件</p>
                <p className="whitespace-pre-wrap m-0">{selected.precondition || '—'}</p>
              </div>
              <div className="mt-3 flex-1">
                <Collapse
                  size="small"
                  defaultActiveKey={['steps']}
                  items={[{
                    key: 'steps',
                    label: <span className="text-[13px]">步骤（{selected.steps.length}）</span>,
                    children: selected.steps.length === 0 ? (
                      <p className="text-[#A8ABB0] text-[13px] m-0">无步骤</p>
                    ) : (
                      <table className="w-full text-[13px]">
                        <thead className="text-[#A8ABB0] text-xs">
                          <tr className="border-b border-[#F0F1F3]">
                            <th className="text-left py-1.5 w-10">步骤</th>
                            <th className="text-left py-1.5">操作</th>
                            <th className="text-left py-1.5">预期结果</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selected.steps.map((s, i) => (
                            <tr key={i} className="border-b border-[#F0F1F3] last:border-0">
                              <td className="py-2 text-[#A8ABB0]">{i + 1}</td>
                              <td className="py-2">{s.desc}</td>
                              <td className="py-2">{s.expect}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ),
                  }]}
                />
                {selected.reSubmit && (
                  <p className="mt-2 text-xs text-[#FA8C16] m-0">该用例评审后被编辑过，已重置为未评审，待重新评审。</p>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* 底部操作条：仅评审人且未结束显示（isReviewer） */}
      {review.isReviewer && !ended && (
        <div className="rabbit-card !rounded-[10px] p-3 mt-4 flex items-center gap-3 flex-wrap">
          {(['PASS', 'FAIL', 'SUGGEST'] as const).map((r) => {
            const meta = resultMeta(r);
            const icons = { PASS: '✓', FAIL: '✗', SUGGEST: '💬' } as const;
            const active = judgeResult === r;
            return (
              <Button
                key={r}
                data-testid={`judge-btn-${r}`}
                style={{ borderColor: meta.color, color: active ? '#fff' : meta.color, background: active ? meta.color : 'transparent' }}
                onClick={() => setJudgeResult(r)}
              >
                {icons[r]} {meta.label}
              </Button>
            );
          })}
          <Input
            className="flex-1 min-w-56"
            value={comment}
            maxLength={4000}
            placeholder="评审意见（失败 / 建议时必填，≤ 4000 字）"
            onChange={(e) => setComment(e.target.value)}
            data-testid="judge-comment-input"
          />
          <Button
            type="primary"
            loading={judge.isPending}
            disabled={submitDisabled}
            onClick={() => selected && judgeResult && judge.mutate({ caseId: selected.caseId, result: judgeResult, comment: comment.trim() })}
            data-testid="btn-submit-judge"
          >
            提交并下一条
          </Button>
          <Button type="link" size="small" onClick={() => setHistoryOpen(true)}>评审历史</Button>
          {commentRequired && comment.trim() === '' && <span className="text-xs text-[#FF4D4F]">选择失败 / 建议时必须填写评审意见</span>}
        </div>
      )}
      {!review.isReviewer && !ended && (
        <p className="mt-3 text-xs text-[#A8ABB0]">你不是本评审的评审人，页面只读。</p>
      )}

      {/* 评审历史弹窗：当前用例标记时间线 */}
      <Modal
        title={`评审历史 · ${selected ? `${padNum(selected.num)} ${selected.name}` : ''}`}
        open={historyOpen}
        footer={null}
        onCancel={() => setHistoryOpen(false)}
        width={560}
      >
        {!selected || selected.results.length === 0 ? (
          <Empty className="my-8" description="暂无标记记录" />
        ) : (
          <div className="relative pl-4 max-h-96 overflow-y-auto" data-testid="review-history">
            <span className="absolute left-[5px] top-1 bottom-1 w-px bg-[#E5E6EB]" />
            {[...selected.results].reverse().map((r, i) => (
              <div key={i} className="relative py-2 border-b border-[#F0F1F3] last:border-0">
                <span className="absolute -left-4 top-4 w-[7px] h-[7px] rounded-full" style={{ background: RESULT_META[r.result]?.color ?? '#574BFF' }} />
                <p className="text-[13px] m-0">
                  <span className="font-medium mr-2">{nameOf(r.userId)}</span>
                  <Tag color={RESULT_META[r.result]?.tag ?? 'default'} className="!mr-2">{RESULT_META[r.result]?.label ?? r.result}</Tag>
                  <span className="text-[#A8ABB0] text-xs">{r.ts.replace('T', ' ').slice(0, 16)}</span>
                </p>
                {r.comment && <p className="text-[13px] text-[#3D4350] whitespace-pre-wrap mt-1 mb-0">{r.comment}</p>}
              </div>
            ))}
          </div>
        )}
      </Modal>

      <LinkCasesModal
        projectId={projectId}
        open={linkOpen}
        onClose={() => setLinkOpen(false)}
        onConfirm={async (caseIds) => {
          const r = await reviewApi.addCases(projectId, id, caseIds);
          invalidate();
          message.success(`已关联 ${r.added} 条用例${r.skipped ? `，跳过 ${r.skipped} 条` : ''}`);
        }}
      />
    </div>
  );
}

/** 关联用例弹窗：模块树（scene=case）+ 用例多选（CASE-002 选择器复用）。 */
function LinkCasesModal({ projectId, open, onClose, onConfirm }: {
  projectId: string;
  open: boolean;
  onClose: () => void;
  onConfirm: (caseIds: string[]) => Promise<void>;
}) {
  const { message } = useApp();
  const [keyword, setKeyword] = useState('');
  const [moduleId, setModuleId] = useState<string | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [page, setPage] = useState(1);

  useEffect(() => {
    if (open) { setSelectedKeys([]); setKeyword(''); setModuleId(null); setPage(1); }
  }, [open]);

  const { data: mods } = useQuery({
    queryKey: ['modules', projectId, 'case'],
    queryFn: () => moduleApi.list(projectId, 'case'),
    enabled: open,
  });
  const { data: cases, isLoading } = useQuery({
    queryKey: ['link-cases', projectId, keyword, moduleId, page, open],
    queryFn: () => caseApiV2.list(projectId, {
      keyword: keyword || undefined,
      moduleId: moduleId ?? undefined,
      includeChildren: moduleId ? '1' : undefined,
      page,
      pageSize: 10,
    }),
    enabled: open,
  });

  const toTree = (nodes: { id: string; name: string; subtreeCount: number; children: unknown[] }[]): DataNode[] =>
    nodes.map((n) => ({
      key: n.id,
      title: <span className="flex items-center gap-1.5"><span className="truncate max-w-32">{n.name}</span><span className="text-[10px] text-[#A8ABB0]">{n.subtreeCount}</span></span>,
      children: (n.children as Parameters<typeof toTree>[0]).length ? toTree(n.children as Parameters<typeof toTree>[0]) : undefined,
    }));
  const findNode = (nodes: { id: string; children: unknown[] }[] | undefined, mid: string | null): { children?: unknown[] } | null => {
    if (!mid) return null;
    for (const n of nodes ?? []) {
      if (n.id === mid) return n;
      const hit = findNode(n.children as { id: string; children: unknown[] }[] | undefined, mid);
      if (hit) return hit;
    }
    return null;
  };
  const selectedNode = findNode(mods?.items as { id: string; children: unknown[] }[] | undefined, moduleId);
  const isParent = Boolean(selectedNode && (selectedNode.children as unknown[] | undefined)?.length);

  const submit = useMutation({
    mutationFn: () => onConfirm(selectedKeys),
    onSuccess: () => onClose(),
    onError: (e) => message.error(e instanceof Error ? e.message : '关联失败'),
  });

  return (
    <Modal
      title="关联用例"
      open={open}
      onCancel={onClose}
      footer={null}
      width={760}
      destroyOnHidden
    >
      <div className="flex gap-3 mt-1" data-testid="link-cases-modal">
        <div className="w-52 shrink-0 border border-[#F0F1F3] rounded-md p-2 max-h-96 overflow-y-auto">
          <p className="text-xs text-[#87888D] px-1 pb-1">模块（scene=case）</p>
          <Tree
            blockNode
            defaultExpandAll
            selectedKeys={moduleId ? [moduleId] : []}
            treeData={toTree((mods?.items ?? []) as Parameters<typeof toTree>[0])}
            onSelect={(keys) => { setModuleId(keys[0] ? String(keys[0]) : null); setPage(1); }}
          />
        </div>
        <div className="flex-1 min-w-0">
          <Input.Search
            className="mb-2"
            allowClear
            placeholder="搜索用例名称"
            value={keyword}
            onChange={(e) => { setKeyword(e.target.value); setPage(1); }}
            data-testid="link-cases-keyword"
          />
          {isParent && (
            <p className="text-xs text-[#FA8C16] mb-2">已选择父模块：按当前筛选列出其与全部子模块用例（含子级）。</p>
          )}
          <Table
            rowKey="id"
            size="small"
            loading={isLoading}
            dataSource={cases?.items ?? []}
            pagination={{ current: page, pageSize: 10, total: cases?.total ?? 0, onChange: setPage, size: 'small', showTotal: (t) => `共 ${t} 条` }}
            rowSelection={{ selectedRowKeys: selectedKeys, onChange: (keys) => setSelectedKeys(keys.map(String)), preserveSelectedRowKeys: true }}
            columns={[
              { title: '编号', dataIndex: 'num', width: 84, render: (n: number) => <span className="text-[#87888D]">{padNum(n)}</span> },
              { title: '用例名称', dataIndex: 'name', ellipsis: true },
              { title: '等级', dataIndex: 'level', width: 60, render: (l: string) => <Tag color={levelColor[l] ?? 'default'}>{l}</Tag> },
            ]}
          />
          <div className="flex justify-end items-center gap-2 mt-3">
            <span className="text-xs text-[#87888D] mr-auto">已选 {selectedKeys.length} 项</span>
            <Button onClick={onClose}>取消</Button>
            <Button type="primary" loading={submit.isPending} disabled={selectedKeys.length === 0} onClick={() => submit.mutate()} data-testid="btn-confirm-link-cases">
              关联 {selectedKeys.length} 条
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

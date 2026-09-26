'use client';

import { Button, Table, Tag } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { reportApi, streamExecFrames } from '@rabbit/api-client';
import type { EventFrame } from '@rabbit/shared';
import { useProjectStore } from '@/stores/project';

export default function ReportPage({ params }: { params: Promise<{ taskId: string }> }) {
  const { currentProjectId } = useProjectStore();
  const [taskId, setTaskId] = useState<string | null>(null);
  const [frames, setFrames] = useState<EventFrame[]>([]);

  useEffect(() => {
    void params.then((p) => setTaskId(p.taskId));
  }, [params]);

  const { data, refetch } = useQuery({
    queryKey: ['report', currentProjectId, taskId],
    queryFn: () => reportApi.detail(currentProjectId!, taskId!),
    enabled: Boolean(currentProjectId && taskId),
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      return s === 'SUCCESS' || s === 'FAILED' ? false : 2000; // RUNNING 轮询兜底（SSE 断开时仍能收敛）
    },
  });

  // SSE 实时流：收到帧即累积，终态后再拉一次详情
  useEffect(() => {
    if (!currentProjectId || !taskId) return;
    const ac = new AbortController();
    void streamExecFrames(taskId, (frame) => {
      setFrames((fs) => [...fs, frame]);
      if (frame.type === 'task-final') void refetch();
    }, ac.signal);
    return () => ac.abort();
  }, [currentProjectId, taskId, refetch]);

  const status = data?.status ?? 'PENDING';
  const badge = { SUCCESS: { color: '#52c41a', text: 'SUCCESS' }, FAILED: { color: '#ff4d4f', text: 'FAILED' }, RUNNING: { color: '#1677ff', text: 'RUNNING' }, PENDING: { color: '#999', text: 'PENDING' } }[status] ?? { color: '#999', text: status };

  const logs = useMemo(() => {
    const fromFrames = frames
      .filter((f): f is Extract<EventFrame, { type: 'log' }> => f.type === 'log')
      .map((f) => ({ ts: f.ts, level: f.level, message: f.message }));
    const merged = [...(data?.logs ?? []), ...fromFrames];
    return merged.filter((l, i, arr) => arr.findIndex((x) => x.ts === l.ts && x.message === l.message) === i);
  }, [frames, data]);

  return (
    <div className="max-w-5xl">
      <div className="rabbit-page-header">
        <div className="flex-1 min-w-0">
          <a className="text-[13px] text-[#87888D] hover:text-[#574BFF] no-underline" href="/debug">‹ 返回调试</a>
          <h1 className="mt-1 flex items-center gap-2.5">
            执行报告
            <span className="text-xs font-normal text-[#A8ABB0]">T-{taskId?.slice(0, 8)}</span>
          </h1>
        </div>
        <span className="rounded-full px-2 py-0.5 text-xs font-medium" data-testid="report-status" style={{ background: `${badge.color}18`, color: badge.color }}>
          {badge.text}
        </span>
        {data?.durationMs != null && <span className="text-xs text-gray-400">{data.durationMs}ms</span>}
        <Button className="ml-auto" disabled>重跑（S2）</Button>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="rabbit-card" data-testid="report-request">
          <p className="rabbit-card-title">请求</p>
          <div className="p-3 text-sm font-mono space-y-1 break-all">
            {data?.request && (
              <>
                <p><Tag color="green" style={{ marginInlineEnd: 0 }}>{data.request.method}</Tag> {data.request.url}</p>
                {data.request.headers.map((h) => (
                  <p key={h.key} className="text-gray-500 text-xs">{h.key}: {h.value}</p>
                ))}
                <p className="text-gray-500 text-xs">{data.request.body ? data.request.body : '— 无 Body —'}</p>
              </>
            )}
          </div>
        </div>
        <div className="rabbit-card" data-testid="report-response">
          <p className="rabbit-card-title flex justify-between">
            响应
            {data?.response && (
              <span className="text-xs">
                <span className={data.response.status < 400 ? 'text-green-600 font-semibold' : 'text-red-500 font-semibold'}>{data.response.status}</span>
                {' · '}{data.response.durationMs}ms
              </span>
            )}
          </p>
          <pre className="p-3 text-xs bg-gray-50 overflow-auto max-h-64 m-0 font-mono whitespace-pre-wrap break-all" data-testid="report-response-body">
            {data?.response?.bodyText || (status === 'RUNNING' || status === 'PENDING' ? '执行中…' : '（无响应）')}
          </pre>
          {data?.response?.truncated && <p className="px-3 pb-2 text-[10px] text-amber-500">响应体已截断至 256KB</p>}
        </div>
      </div>

      <div className="rabbit-card mt-4" data-testid="report-asserts">
        <p className="rabbit-card-title">
          断言 <span className="text-xs text-gray-400">{data?.asserts.length ?? 0} 条{data?.asserts.some((a) => !a.passed) ? ` · ${data.asserts.filter((a) => !a.passed).length} 失败` : ''}</span>
        </p>
        <Table
          rowKey={(_, i) => String(i)}
          size="small"
          pagination={false}
          dataSource={data?.asserts ?? []}
          columns={[
            { title: '类型', dataIndex: 'kind', width: 140, render: (k: string) => (k === 'status_code' ? '状态码' : '响应体 JSONPath') },
            { title: '表达式', dataIndex: 'path', width: 160, render: (p: string) => <span className="font-mono text-xs">{p || '—'}</span> },
            { title: '期望', dataIndex: 'expected', render: (e: string, r) => <span className="font-mono text-xs">{r.op === 'contains' ? `包含 ${e}` : e}</span> },
            { title: '实际', dataIndex: 'actual', render: (a: string) => <span className="font-mono text-xs">{a}</span> },
            {
              title: '结果',
              dataIndex: 'passed',
              width: 90,
              render: (p: boolean) => p
                ? <span className="text-green-600" data-testid="assert-pass">✓ 通过</span>
                : <span className="text-red-500 font-medium" data-testid="assert-fail">✗ 失败</span>,
            },
          ]}
        />
      </div>

      <div className="rabbit-card mt-4" data-testid="report-logs">
        <p className="rabbit-card-title flex items-center gap-2">执行日志 <span className="text-[11px] font-normal text-[#A8ABB0]">SSE 实时</span></p>
        <div className="p-3 font-mono text-xs space-y-1">
          {logs.length === 0 && <p className="text-gray-400">等待事件…</p>}
          {logs.map((l, i) => (
            <p key={i} className={l.level === 'error' ? 'text-red-400' : 'text-gray-500'}>
              {new Date(l.ts).toLocaleTimeString('zh-CN', { hour12: false })} [{l.level}] {l.message}
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}

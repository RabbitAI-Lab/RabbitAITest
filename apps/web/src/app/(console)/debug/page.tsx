'use client';

import { App, Button, Input, Select, Space, Tabs } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { execApi, ApiError } from '@rabbit/api-client';
import type { AssertSpec, HttpMethod } from '@rabbit/shared';
import { MethodTag, StatusDot } from '@rabbit/ui';
import { useProjectStore } from '@/stores/project';

const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD', 'CONNECT'];

export default function DebugPage() {
  const router = useRouter();
  const { message } = App.useApp();
  const { currentProjectId } = useProjectStore();
  const [method, setMethod] = useState<HttpMethod>('GET');
  const [url, setUrl] = useState('https://httpbin.org/get');
  const [headers, setHeaders] = useState<{ key: string; value: string }[]>([{ key: 'Accept', value: 'application/json' }]);
  const [bodyKind, setBodyKind] = useState<'none' | 'raw_json'>('none');
  const [bodyText, setBodyText] = useState('');
  const [asserts, setAsserts] = useState<AssertSpec[]>([{ kind: 'status_code', path: '', op: 'eq', expected: '200' }]);
  const [executing, setExecuting] = useState(false);

  const { data: history, refetch } = useQuery({
    queryKey: ['debug-history', currentProjectId],
    queryFn: () => execApi.debugHistory(currentProjectId!),
    enabled: Boolean(currentProjectId),
  });

  async function execute() {
    if (!currentProjectId) return;
    if (!/^https?:\/\//.test(url)) {
      message.error('URL 必须以 http/https 开头');
      return;
    }
    setExecuting(true);
    try {
      const { taskId } = await execApi.createDebugTask(
        currentProjectId,
        {
          method, url,
          headers: headers.filter((h) => h.key),
          body: { kind: bodyKind, content: bodyKind === 'none' ? '' : bodyText },
          timeoutMs: 60000,
        },
        asserts.filter((a) => a.expected !== '' || a.kind === 'status_code'),
      );
      void refetch();
      router.push(`/reports/${taskId}`);
    } catch (e) {
      message.error(e instanceof ApiError ? e.message : '提交失败');
    } finally {
      setExecuting(false);
    }
  }

  return (
    <div className="flex gap-4">
      <div className="w-64 shrink-0 bg-white border rounded" data-testid="debug-history">
        <p className="p-3 border-b text-sm font-medium m-0">调试历史</p>
        <div className="p-2 space-y-1">
          {(history?.items ?? []).map((h) => (
            <a
              key={h.id}
              href={`/reports/${h.id}`}
              className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-gray-50"
            >
              <MethodTag method={h.method} />
              <span className="truncate flex-1 text-gray-600">{h.url.replace(/^https?:\/\//, '')}</span>
              <StatusDot outcome={h.status as 'SUCCESS' | 'FAILED' | 'RUNNING' | 'PENDING'} />
            </a>
          ))}
          {(history?.items ?? []).length === 0 && <p className="text-xs text-gray-400 p-2">最近 20 条 · 点击回看报告</p>}
        </div>
      </div>

      <div className="flex-1 space-y-4 min-w-0">
        <div className="bg-white border rounded p-4">
          <div className="flex gap-2">
            <Select className="w-28" value={method} onChange={setMethod} options={METHODS.map((m) => ({ value: m, label: m }))} data-testid="debug-method" />
            <Input className="flex-1 font-mono" value={url} onChange={(e) => setUrl(e.target.value)} data-testid="debug-url" placeholder="https://…" />
            <Button type="primary" loading={executing} onClick={execute} data-testid="btn-execute">执 行</Button>
          </div>
          <Tabs
            className="mt-3"
            items={[
              {
                key: 'headers',
                label: 'Headers',
                forceRender: true,
                children: (
                  <div className="space-y-2" data-testid="debug-headers">
                    {headers.map((h, i) => (
                      <div key={i} className="flex gap-2">
                        <Input className="w-44" placeholder="Key" value={h.key} onChange={(e) => setHeaders((hs) => hs.map((x, idx) => (idx === i ? { ...x, key: e.target.value } : x)))} />
                        <Input className="flex-1 font-mono" placeholder="Value" value={h.value} onChange={(e) => setHeaders((hs) => hs.map((x, idx) => (idx === i ? { ...x, value: e.target.value } : x)))} />
                        <Button type="text" className="text-gray-400" aria-label={`remove-header-${i + 1}`} onClick={() => setHeaders((hs) => hs.filter((_, idx) => idx !== i))}>✕</Button>
                      </div>
                    ))}
                    <Button type="link" className="px-0" onClick={() => setHeaders((hs) => [...hs, { key: '', value: '' }])}>＋ 添加 Header</Button>
                  </div>
                ),
              },
              {
                key: 'body',
                label: 'Body',
                forceRender: true,
                children: (
                  <Space direction="vertical" className="w-full" data-testid="debug-body">
                    <Select className="w-40" value={bodyKind} onChange={setBodyKind} options={[{ value: 'none', label: 'none' }, { value: 'raw_json', label: 'raw (JSON)' }]} />
                    {bodyKind === 'raw_json' && (
                      <Input.TextArea
                        rows={6}
                        className="font-mono"
                        placeholder='{"key": "value"}'
                        value={bodyText}
                        onChange={(e) => setBodyText(e.target.value)}
                      />
                    )}
                  </Space>
                ),
              },
              {
                key: 'asserts',
                label: '断言',
                forceRender: true,
                children: (
                  <div className="space-y-2" data-testid="debug-asserts">
                    {asserts.map((a, i) => (
                      <div key={i} className="flex gap-2">
                        <Select
                          className="w-36"
                          value={a.kind}
                          options={[{ value: 'status_code', label: '状态码' }, { value: 'body_jsonpath', label: '响应体 JSONPath' }]}
                          onChange={(kind) => setAsserts((as) => as.map((x, idx) => (idx === i ? { ...x, kind } : x)))}
                        />
                        <Input
                          className="w-44 font-mono"
                          placeholder="$.url"
                          disabled={a.kind === 'status_code'}
                          value={a.path}
                          onChange={(e) => setAsserts((as) => as.map((x, idx) => (idx === i ? { ...x, path: e.target.value } : x)))}
                        />
                        <Select
                          className="w-24"
                          value={a.op}
                          options={[{ value: 'eq', label: '等于' }, { value: 'contains', label: '包含' }]}
                          onChange={(op) => setAsserts((as) => as.map((x, idx) => (idx === i ? { ...x, op } : x)))}
                        />
                        <Input
                          className="flex-1 font-mono"
                          placeholder={a.kind === 'status_code' ? '200' : '期望值'}
                          value={a.expected}
                          onChange={(e) => setAsserts((as) => as.map((x, idx) => (idx === i ? { ...x, expected: e.target.value } : x)))}
                        />
                        <Button type="text" className="text-gray-400" aria-label={`remove-assert-${i + 1}`} onClick={() => setAsserts((as) => as.filter((_, idx) => idx !== i))}>✕</Button>
                      </div>
                    ))}
                    <Button type="link" className="px-0" data-testid="btn-add-assert" onClick={() => setAsserts((as) => [...as, { kind: 'status_code', path: '', op: 'eq', expected: '200' }])}>
                      ＋ 添加断言
                    </Button>
                  </div>
                ),
              },
            ]}
          />
        </div>
        <div className="bg-white border rounded p-4 text-sm text-gray-500">
          执行后跳转「执行报告」页实时查看（SSE）。示例：
          <Button type="link" className="px-1" onClick={() => { setMethod('GET'); setUrl('https://httpbin.org/get'); }}>
            GET https://httpbin.org/get
          </Button>
        </div>
      </div>
    </div>
  );
}

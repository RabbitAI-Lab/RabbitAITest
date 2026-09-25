'use client';

import { Tag } from 'antd';
import type { HttpMethod } from '@rabbit/shared';

const methodColor: Record<string, string> = {
  GET: 'green', POST: 'orange', PUT: 'blue', DELETE: 'red',
  PATCH: 'purple', OPTIONS: 'cyan', HEAD: 'default', CONNECT: 'default',
};

/** HTTP 方法徽标（调试历史/报告页共用）。 */
export function MethodTag({ method }: { method: HttpMethod | string }) {
  return <Tag color={methodColor[method] ?? 'default'} style={{ marginInlineEnd: 0 }}>{method}</Tag>;
}

export function StatusDot({ outcome }: { outcome: 'SUCCESS' | 'FAILED' | 'RUNNING' | 'PENDING' }) {
  const color = outcome === 'SUCCESS' ? '#52c41a' : outcome === 'FAILED' ? '#ff4d4f' : '#1677ff';
  return <span aria-label={`status-${outcome}`} style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: color }} />;
}

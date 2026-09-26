'use client';

import { Button, Input, List, Popconfirm, Tag } from 'antd';
import { Pencil, Trash2 } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { commentApi, type CommentDto } from '@rabbit/api-client';
import { renderMarkdown } from '@rabbit/shared';
import { useApp } from '@/hooks/useApp';
import { usePermissions } from '@/hooks/usePermissions';
import { useState } from 'react';

/** CASE-003/BUG-001：评论横切（两级楼中楼）。 */
export function CommentThread({ projectId, entity, canModeratePerm, currentUserId }: { projectId: string; entity: string; canModeratePerm: string; currentUserId: string }) {
  const qc = useQueryClient();
  const { message } = useApp();
  const { can } = usePermissions();
  const [content, setContent] = useState('');
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; content: string } | null>(null);
  const { data } = useQuery({
    queryKey: ['comments', projectId, entity],
    queryFn: () => commentApi.list(projectId, entity),
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['comments', projectId, entity] });
  const add = useMutation({
    mutationFn: () => commentApi.create(projectId, entity, content, replyTo ?? undefined),
    onSuccess: () => { setContent(''); setReplyTo(null); invalidate(); },
    onError: (e) => message.error(e instanceof Error ? e.message : '发表失败'),
  });
  const edit = useMutation({
    mutationFn: () => commentApi.update(projectId, editing!.id, editing!.content),
    onSuccess: () => { setEditing(null); invalidate(); },
    onError: (e) => message.error(e instanceof Error ? e.message : '更新失败'),
  });
  const remove = useMutation({
    mutationFn: (id: string) => commentApi.remove(projectId, id),
    onSuccess: invalidate,
    onError: (e) => message.error(e instanceof Error ? e.message : '删除失败'),
  });
  const items = data?.items ?? [];
  const mains = items.filter((c) => !c.parentId);
  const repliesOf = (id: string) => items.filter((c) => c.parentId === id);
  const render = (c: CommentDto, isReply = false) => (
    <div key={c.id} className={isReply ? 'ml-8 mt-2 border-l-2 border-[#F0F1F3] pl-3' : 'mt-3'}>
      {editing?.id === c.id ? (
        <div className="flex gap-2">
          <Input value={editing.content} onChange={(e) => setEditing({ ...editing, content: e.target.value })} />
          <Button size="small" type="primary" onClick={() => edit.mutate()} loading={edit.isPending}>保存</Button>
          <Button size="small" onClick={() => setEditing(null)}>取消</Button>
        </div>
      ) : (
        <div className="flex items-start gap-2">
          <span className="w-6 h-6 rounded-full bg-[#574BFF]/10 text-[#574BFF] text-xs flex items-center justify-center shrink-0">{c.userName.slice(0, 1)}</span>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] text-[#3D4350]">
              <span className="font-medium mr-2">{c.userName}</span>
              <span className="text-[#A8ABB0] text-xs">{c.createdAt.replace('T', ' ').slice(0, 16)}</span>
            </p>
            <p className="text-[13px] text-[#3D4350] whitespace-pre-wrap break-all" data-testid="comment-content">{c.content}</p>
            <div className="flex gap-2 mt-1">
              {!isReply && <Button type="link" size="small" className="!px-0 !h-auto" onClick={() => { setReplyTo(c.id); setContent(''); }}>回复</Button>}
              <Button type="link" size="small" className="!px-0 !h-auto" onClick={() => setEditing({ id: c.id, content: c.content })} icon={<Pencil size={12} />} />
              {(c.userId === currentUserId || can(canModeratePerm)) && (
                <Popconfirm title="删除该评论？" onConfirm={() => remove.mutate(c.id)}>
                  <Button type="link" size="small" danger className="!px-0 !h-auto" icon={<Trash2 size={12} />} />
                </Popconfirm>
              )}
            </div>
            {repliesOf(c.id).map((r) => render(r, true))}
          </div>
        </div>
      )}
    </div>
  );
  return (
    <div data-testid="comment-thread">
      <div className="flex gap-2 mb-2">
        <Input.TextArea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder={replyTo ? '回复…' : '发表评论…'}
          rows={2}
          maxLength={4000}
          data-testid="comment-input"
        />
        <Button type="primary" onClick={() => add.mutate()} loading={add.isPending} disabled={!content.trim()} data-testid="comment-submit">发表</Button>
      </div>
      {mains.length === 0 && <p className="text-[#A8ABB0] text-[13px]">暂无评论</p>}
      {mains.map((c) => render(c))}
    </div>
  );
}

/** CASE-003/BUG-001：变更历史时间线（diff 行内展示）。 */
export function ChangeTimeline({ items }: { items: { id: string; seq: number; action: string; diff: unknown; userName: string; createdAt: string }[] }) {
  const actionText: Record<string, string> = { create: '创建', update: '更新', delete: '删除', restore: '恢复', transition: '流转', import_overwrite: '导入覆盖' };
  const renderDiff = (diff: unknown) => {
    if (!diff || typeof diff !== 'object') return null;
    const rows: React.ReactNode[] = [];
    const walk = (obj: Record<string, unknown>, prefix = '') => {
      for (const [k, v] of Object.entries(obj)) {
        if (v && typeof v === 'object' && 'before' in (v as object) && 'after' in (v as object)) {
          const b = (v as { before: unknown }).before;
          const a = (v as { after: unknown }).after;
          const fmt = (x: unknown) => typeof x === 'object' ? JSON.stringify(x)?.slice(0, 120) : String(x ?? '空');
          rows.push(
            <div key={prefix + k} className="text-xs flex gap-1 flex-wrap">
              <span className="text-[#646A73]">{prefix}{k}：</span>
              <span className="text-[#FF4D4F] line-through opacity-70">{fmt(b)}</span>
              <span className="text-[#A8ABB0]">→</span>
              <span className="text-[#52C41A]">{fmt(a)}</span>
            </div>,
          );
        } else if (v && typeof v === 'object') {
          walk(v as Record<string, unknown>, `${prefix}${k}.`);
        }
      }
    };
    walk(diff as Record<string, unknown>);
    return rows.length ? <div className="mt-1 space-y-0.5">{rows}</div> : null;
  };
  if (items.length === 0) return <p className="text-[#A8ABB0] text-[13px]">暂无变更记录</p>;
  return (
    <div className="relative pl-4" data-testid="change-timeline">
      <span className="absolute left-[5px] top-1 bottom-1 w-px bg-[#E5E6EB]" />
      <List
        dataSource={items}
        renderItem={(it) => (
          <List.Item className="!px-0 relative">
            <span className="absolute -left-4 top-2 w-[7px] h-[7px] rounded-full bg-[#574BFF]" />
            <div className="w-full">
              <p className="text-[13px]">
                <span className="font-medium mr-2">{it.userName}</span>
                <Tag className="!mr-2" color={it.action === 'transition' ? 'blue' : it.action === 'create' ? 'green' : 'default'}>{actionText[it.action] ?? it.action}</Tag>
                <span className="text-[#A8ABB0] text-xs">#{it.seq} · {it.createdAt.replace('T', ' ').slice(0, 16)}</span>
              </p>
              {renderDiff(it.diff)}
            </div>
          </List.Item>
        )}
      />
    </div>
  );
}

/** 受限 Markdown 渲染（CASE-003 §4：白名单转义防 XSS）。 */
export function MarkdownView({ md, className }: { md: string; className?: string }) {
  if (!md) return <span className="text-[#A8ABB0]">—</span>;
  return (
    <div
      className={`md-view text-[13px] leading-6 [&_h2]:text-base [&_h2]:font-medium [&_h2]:mt-3 [&_h3]:font-medium [&_h3]:mt-2 [&_pre]:bg-[#F7F8FA] [&_pre]:p-3 [&_pre]:rounded [&_code]:bg-[#F7F8FA] [&_code]:px-1 [&_code]:rounded [&_table]:w-full [&_th]:border [&_th]:p-1.5 [&_th]:bg-[#F7F8FA] [&_td]:border [&_td]:p-1.5 [&_li]:ml-4 [&_li]:list-disc ${className ?? ''}`}
      dangerouslySetInnerHTML={{ __html: renderMarkdown(md) }}
    />
  );
}

/** 成员选择器（处理人/评审人/执行人）。 */
export function MemberSelect({ projectId, value, onChange, mode, placeholder }: {
  projectId: string; value?: string | string[]; onChange: (v: string | string[]) => void;
  mode?: 'multiple'; placeholder?: string;
}) {
  const { data } = useQuery({
    queryKey: ['members', projectId],
    queryFn: async () => {
      const { memberApi } = await import('@rabbit/api-client');
      return memberApi.projectMembers(projectId);
    },
    staleTime: 60_000,
  });
  return (
    <Select
      mode={mode}
      value={value}
      onChange={(v) => onChange(v)}
      placeholder={placeholder ?? '选择成员'}
      showSearch
      optionFilterProp="label"
      options={(data?.items ?? []).map((m) => ({ value: m.id, label: `${m.name}（${m.email}）` }))}
      className="min-w-40"
      allowClear
    />
  );
}

'use client';

import { Button, Input, Select, TreeSelect } from 'antd';
import type { TreeSelectProps } from 'antd';
import { Info } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ApiError, bugApi, fieldDefApi, memberApi, moduleApi, templateApi, type ModuleNodeDto } from '@rabbit/api-client';
import type { FieldDefInput, TemplateFieldBinding } from '@rabbit/shared';
import { DynamicFieldForm, type DynFieldDef } from '@/components/DynamicField';
import { MemberSelect } from '@/components/crosscut';
import { useApp } from '@/hooks/useApp';
import { useProjectInfo } from '@/hooks/usePermissions';
import { useProjectStore } from '@/stores/project';

/** BUG-001：新建缺陷（模板动态字段 + 处理人/标签/模块；附件在详情页上传）。 */

function toTreeData(nodes: ModuleNodeDto[]): NonNullable<TreeSelectProps['treeData']> {
  return nodes.map((n) => ({
    value: n.id,
    title: n.name,
    children: n.children.length ? toTreeData(n.children) : undefined,
  }));
}

export default function NewBugPage() {
  const router = useRouter();
  const { message } = useApp();
  const { currentProjectId } = useProjectStore();
  const project = useProjectInfo();
  const projectId = currentProjectId;
  const orgId = project?.org.id ?? null;

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [handleUserId, setHandleUserId] = useState<string>();
  const [tags, setTags] = useState<string[]>([]);
  const [moduleId, setModuleId] = useState<string>();
  const [fields, setFields] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);

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
  const modulesQ = useQuery({
    queryKey: ['modules', projectId, 'bug'],
    queryFn: () => moduleApi.list(projectId!, 'bug'),
    enabled: Boolean(projectId),
  });
  const membersQ = useQuery({
    queryKey: ['members', projectId],
    queryFn: () => memberApi.projectMembers(projectId!),
    enabled: Boolean(projectId),
    staleTime: 60_000,
  });

  const defaultTpl = (templatesQ.data ?? []).find((t) => t.isDefault) ?? null;
  const defs: DynFieldDef[] = (defsQ.data ?? [])
    .filter((d) => d.enabled)
    .map((d) => ({ ...d, options: d.options as FieldDefInput['options'] }) as DynFieldDef);
  const defaultBindings: TemplateFieldBinding[] | undefined = defaultTpl?.fields?.map((b) => ({ ...b, visibleInList: b.visibleInList ?? false }));

  async function save() {
    if (!projectId) return;
    if (!title.trim()) {
      message.error('标题不能为空');
      return;
    }
    setSaving(true);
    try {
      const r = await bugApi.create(projectId, {
        title: title.trim(),
        description,
        templateId: defaultTpl?.id,
        fields,
        handleUserId: handleUserId ?? null,
        moduleId: moduleId ?? undefined,
        tags,
      });
      message.success(`缺陷已创建 B-${String(r.num).padStart(4, '0')}`);
      router.push(`/bugs/${r.id}`);
    } catch (e) {
      message.error(e instanceof ApiError ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-3xl">
      <div className="rabbit-page-header">
        <div className="flex-1 min-w-0">
          <a className="text-[13px] text-[#87888D] hover:text-[#574BFF] no-underline" href="/bugs">‹ 返回缺陷列表</a>
          <h1>新建缺陷{defaultTpl && <span className="ml-2 text-xs font-normal text-[#A8ABB0]">模板：{defaultTpl.name}（默认）</span>}</h1>
        </div>
      </div>
      <div className="rabbit-card p-6 space-y-5" data-testid="bug-form">
        <div className="grid grid-cols-[80px_1fr] items-center gap-3">
          <label className="text-[13px] text-[#3D4350]">标题 <span className="text-[#FF4D4F]">*</span></label>
          <Input value={title} maxLength={512} placeholder="一句话描述缺陷" data-testid="input-bug-title" onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="grid grid-cols-[80px_1fr] gap-3">
          <label className="text-[13px] text-[#3D4350]">描述</label>
          <div>
            <Input.TextArea rows={5} maxLength={8000} value={description} placeholder="支持受限 Markdown（标题/列表/代码块/表格）" data-testid="input-bug-description" onChange={(e) => setDescription(e.target.value)} />
            <p className="text-xs text-[#A8ABB0] mt-1">支持 Markdown：## 标题、- 列表、``` 代码块、| 表格 |</p>
          </div>
        </div>
        <div className="grid grid-cols-[80px_1fr] items-center gap-3">
          <label className="text-[13px] text-[#3D4350]">处理人</label>
          <MemberSelect projectId={projectId!} value={handleUserId} onChange={(v) => setHandleUserId(Array.isArray(v) ? v[0] : v)} placeholder="选择处理人" />
        </div>
        <div className="grid grid-cols-[80px_1fr] items-center gap-3">
          <label className="text-[13px] text-[#3D4350]">标签</label>
          <Select mode="tags" className="w-full" value={tags} placeholder="输入回车添加（最多 10 个）" data-testid="input-bug-tags" onChange={setTags} />
        </div>
        <div className="grid grid-cols-[80px_1fr] items-center gap-3">
          <label className="text-[13px] text-[#3D4350]">所属模块</label>
          <TreeSelect
            className="w-full" allowClear treeDefaultExpandAll
            value={moduleId} placeholder="未指定模块"
            treeData={toTreeData(modulesQ.data?.items ?? [])}
            onChange={(v) => setModuleId(v)}
            data-testid="select-bug-module"
          />
        </div>
        <div>
          <p className="text-[13px] text-[#3D4350] mb-2">自定义字段（按默认缺陷模板）</p>
          <DynamicFieldForm
            defs={defs}
            bindings={defaultBindings}
            value={fields}
            onChange={setFields}
            members={(membersQ.data?.items ?? []).map((m) => ({ id: m.id, name: m.name }))}
          />
          {defs.length === 0 && <p className="text-[#A8ABB0] text-[13px]">当前无启用的缺陷自定义字段</p>}
        </div>
        <div className="border border-dashed border-[#E5E6EB] rounded-md p-4 flex items-center gap-2 text-[13px] text-[#A8ABB0]" data-testid="attachment-hint">
          <Info size={15} />
          附件请在保存后的详情页上传（多文件、单文件 ≤50MB，可执行文件拒收）
        </div>
        <div className="flex gap-2">
          <Button type="primary" loading={saving} onClick={save} disabled={!title.trim()} data-testid="btn-submit-bug">保存</Button>
          <Button onClick={() => router.push('/bugs')}>取消</Button>
        </div>
      </div>
    </div>
  );
}

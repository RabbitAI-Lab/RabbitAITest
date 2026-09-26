'use client';

import { Button, Drawer, Empty, Input, Popconfirm, Segmented, Select, Switch, Table, Tabs, Tag } from 'antd';
import { Plus } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fieldDefApi, templateApi, type FieldDefRow, type TemplateRow } from '@rabbit/api-client';
import { PageHeader } from '@/components/PageHeader';
import { usePermissions, useProjectInfo } from '@/hooks/usePermissions';
import { useApp } from '@/hooks/useApp';
import { useState } from 'react';

/**
 * PROJ-002：组织 › 模板管理（level=org 视图：字段 Tab + 模板 Tab；工作流在项目设置按生效模板编辑）。
 */
const FIELD_TYPES = ['input', 'textarea', 'number', 'date', 'single_select', 'multi_select', 'checkbox', 'radio', 'member', 'url'] as const;

export default function OrgTemplatesPage() {
  const project = useProjectInfo();
  const orgId = project?.org.id;
  const { canGlobal } = usePermissions();
  const editable = canGlobal('ORG_TEMPLATE:UPDATE');

  if (!project || !orgId) return <Empty description="请先选择项目（组织上下文取自当前项目）" />;

  return (
    <div>
      <PageHeader title="组织模板管理" sub="组织级字段定义与模板（项目启用项目模板前，全组织项目共用）" />
      <div className="rabbit-card p-4">
        <Tabs
          items={[
            { key: 'fields', label: <span data-testid="tab-fields">字段</span>, children: <FieldsTab orgId={orgId} editable={editable} /> },
            { key: 'templates', label: <span data-testid="tab-templates">模板</span>, children: <TemplatesTab orgId={orgId} editable={editable} /> },
          ]}
        />
      </div>
    </div>
  );
}

function FieldsTab({ orgId, editable }: { orgId: string; editable: boolean }) {
  const qc = useQueryClient();
  const { message } = useApp();
  const [scene, setScene] = useState<'case' | 'bug'>('case');
  const [drawer, setDrawer] = useState(false);
  const [form, setForm] = useState<{ name: string; key: string; type: string; required: boolean; options: string }>({ name: '', key: '', type: 'input', required: false, options: '' });
  const { data, isLoading } = useQuery({
    queryKey: ['org-field-defs', orgId, scene],
    queryFn: () => fieldDefApi.list(orgId, scene),
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['org-field-defs', orgId] });
  const create = useMutation({
    mutationFn: () => fieldDefApi.create(orgId, {
      scene, name: form.name.trim(), key: form.key.trim(), type: form.type, required: form.required,
      options: form.type === 'single_select' || form.type === 'multi_select' || form.type === 'radio'
        ? { options: form.options.split(/\r?\n/).map((s) => s.trim()).filter(Boolean) }
        : {},
    }),
    onSuccess: () => { invalidate(); setDrawer(false); message.success('字段已创建'); },
    onError: (e) => message.error(e instanceof Error ? e.message : '创建失败'),
  });
  const remove = useMutation({
    mutationFn: (id: string) => fieldDefApi.remove(orgId, id) as unknown as Promise<{ softDisabled: boolean; usedCount: number }>,
    onSuccess: (r) => {
      invalidate();
      if (r?.softDisabled) message.warning(`字段有 ${r.usedCount} 条存量值，已停用（数据保留）`);
      else message.success('字段已删除');
    },
    onError: (e) => message.error(e instanceof Error ? e.message : '删除失败'),
  });
  return (
    <div>
      <div className="flex gap-3 mb-3">
        <Segmented options={[{ label: '用例', value: 'case' }, { label: '缺陷', value: 'bug' }]} value={scene} onChange={(v) => setScene(v as 'case' | 'bug')} />
        {editable && <Button type="primary" size="small" icon={<Plus size={13} />} onClick={() => setDrawer(true)} data-testid="btn-new-field">新建字段</Button>}
      </div>
      <Table<FieldDefRow>
        rowKey="id" size="small" loading={isLoading} dataSource={data ?? []} pagination={false}
        columns={[
          { title: '名称', dataIndex: 'name' },
          { title: '标识', dataIndex: 'key', render: (v: string) => <code className="text-xs">{v}</code> },
          { title: '类型', dataIndex: 'type' },
          { title: '必填', dataIndex: 'required', render: (v: boolean) => (v ? '是' : '否') },
          { title: '状态', dataIndex: 'enabled', render: (v: boolean) => <Tag color={v ? 'green' : 'default'}>{v ? '启用' : '停用'}</Tag> },
          ...(editable ? [{
            title: '操作', key: 'op',
            render: (_: unknown, row: FieldDefRow) => (
              <Popconfirm title={row.enabled ? '删除字段？有存量值时将转为停用。' : '彻底删除该停用字段？'} onConfirm={() => remove.mutate(row.id)}>
                <Button type="link" size="small" danger className="!px-0">删除</Button>
              </Popconfirm>
            ),
          } as const] : []),
        ]}
      />
      <Drawer title="新建字段" open={drawer} onClose={() => setDrawer(false)} width={420}>
        <div className="space-y-4">
          <div><label className="block text-[13px] mb-1">名称 *</label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="input-field-name" /></div>
          <div><label className="block text-[13px] mb-1">标识（小写字母/数字/下划线）*</label><Input value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} data-testid="input-field-key" /></div>
          <div>
            <label className="block text-[13px] mb-1">类型 *</label>
            <Select value={form.type} onChange={(v) => setForm({ ...form, type: v })} options={FIELD_TYPES.map((t) => ({ value: t, label: t }))} className="w-full" />
          </div>
          {['single_select', 'multi_select', 'radio'].includes(form.type) && (
            <div><label className="block text-[13px] mb-1">选项（一行一个）</label><Input.TextArea rows={4} value={form.options} onChange={(e) => setForm({ ...form, options: e.target.value })} data-testid="input-field-options" /></div>
          )}
          <div className="flex items-center gap-2"><Switch checked={form.required} onChange={(v) => setForm({ ...form, required: v })} />必填</div>
          <Button type="primary" block loading={create.isPending} disabled={!form.name.trim() || !/^[a-z][a-z0-9_]{1,63}$/.test(form.key)} onClick={() => create.mutate()} data-testid="btn-submit-field">创建</Button>
        </div>
      </Drawer>
    </div>
  );
}

function TemplatesTab({ orgId, editable }: { orgId: string; editable: boolean }) {
  const qc = useQueryClient();
  const { message } = useApp();
  const [scene, setScene] = useState<'case' | 'bug'>('case');
  const { data, isLoading } = useQuery({
    queryKey: ['org-templates', orgId, scene],
    queryFn: () => templateApi.list(orgId, null, scene),
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['org-templates', orgId] });
  const setDefault = useMutation({
    mutationFn: (id: string) => templateApi.setDefault(orgId, null, id),
    onSuccess: () => { invalidate(); message.success('已设为默认模板'); },
    onError: (e) => message.error(e instanceof Error ? e.message : '操作失败'),
  });
  const copy = useMutation({
    mutationFn: (id: string) => templateApi.copy(orgId, null, id),
    onSuccess: () => { invalidate(); message.success('模板已复制（结果重置）'); },
    onError: (e) => message.error(e instanceof Error ? e.message : '复制失败'),
  });
  const create = useMutation({
    mutationFn: (name: string) => templateApi.create(orgId, null, { scene, name, fields: [] }),
    onSuccess: () => { invalidate(); message.success('模板已创建'); },
    onError: (e) => message.error(e instanceof Error ? e.message : '创建失败'),
  });
  const remove = useMutation({
    mutationFn: (id: string) => templateApi.remove(orgId, null, id),
    onSuccess: () => { invalidate(); message.success('模板已删除'); },
    onError: (e) => message.error(e instanceof Error ? e.message : '删除失败'),
  });
  return (
    <div>
      <div className="flex gap-3 mb-3">
        <Segmented options={[{ label: '用例', value: 'case' }, { label: '缺陷', value: 'bug' }]} value={scene} onChange={(v) => setScene(v as 'case' | 'bug')} />
        {editable && (
          <Button type="primary" size="small" icon={<Plus size={13} />} onClick={() => {
            const name = window.prompt('模板名称');
            if (name?.trim()) create.mutate(name.trim());
          }}>新建模板</Button>
        )}
      </div>
      <Table<TemplateRow>
        rowKey="id" size="small" loading={isLoading} dataSource={data ?? []} pagination={false}
        columns={[
          { title: '模板名', dataIndex: 'name', render: (v: string, row) => <span>{v}{row.isDefault && <Tag color="blue" className="ml-2">默认</Tag>}{row.isSystem && <Tag className="ml-1">系统</Tag>}</span> },
          { title: '绑定字段数', render: (_: unknown, row: TemplateRow) => row.fields.length },
          { title: '引用数', dataIndex: 'refCount' },
          ...(editable ? [{
            title: '操作', key: 'op',
            render: (_: unknown, row: TemplateRow) => (
              <span className="flex gap-2">
                {!row.isDefault && <Button type="link" size="small" className="!px-0" onClick={() => setDefault.mutate(row.id)}>设默认</Button>}
                <Button type="link" size="small" className="!px-0" onClick={() => copy.mutate(row.id)}>复制</Button>
                {!row.isDefault && !row.isSystem && (
                  <Popconfirm title="删除该模板？引用中不可删。" onConfirm={() => remove.mutate(row.id)}>
                    <Button type="link" size="small" danger className="!px-0">删除</Button>
                  </Popconfirm>
                )}
              </span>
            ),
          } as const] : []),
        ]}
      />
      <p className="text-xs text-[#A8ABB0] mt-3">字段绑定与覆写、缺陷工作流在「项目设置 › 模板管理」按项目上下文编辑。</p>
    </div>
  );
}

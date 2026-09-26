'use client';

import { Alert, Button, Checkbox, Drawer, Input, InputNumber, Modal, Popconfirm, Segmented, Select, Switch, Table, Tag } from 'antd';
import type { CheckboxChangeEvent } from 'antd/es/checkbox';
import { ArrowDown, ArrowUp, Plus } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { fieldDefApi, templateApi, workflowApi, type FieldDefRow, type TemplateRow } from '@rabbit/api-client';
import type { FieldType } from '@rabbit/shared';
import { PageHeader } from '@/components/PageHeader';
import { useApp } from '@/hooks/useApp';
import { usePermissions, useProjectInfo } from '@/hooks/usePermissions';
import { useProjectStore } from '@/stores/project';

/** PROJ-002：项目 › 设置 › 模板管理（字段 / 模板 / 工作流；工作流仅缺陷场景）。 */
const TYPE_LABELS: Record<FieldType, string> = {
  input: '单行文本', textarea: '多行文本', number: '数字', date: '日期',
  single_select: '单选', multi_select: '多选', checkbox: '复选', radio: '单选按钮',
  member: '成员', url: 'URL',
};
const TYPE_LIST = Object.keys(TYPE_LABELS) as FieldType[];

type FieldFormState = {
  name: string; key: string; type: FieldType; required: boolean;
  optionsText: string; min?: number; max?: number;
  minLength?: number; maxLength?: number; pattern: string; multiple: boolean;
};

const emptyFieldForm = (): FieldFormState => ({
  name: '', key: '', type: 'input', required: false,
  optionsText: '', min: undefined, max: undefined,
  minLength: undefined, maxLength: undefined, pattern: '', multiple: false,
});

export default function TemplateSettingsPage() {
  const qc = useQueryClient();
  const { message, modal } = useApp();
  const { can } = usePermissions();
  const { currentProjectId } = useProjectStore();
  const project = useProjectInfo();
  const orgId = project?.org.id ?? null;
  const projectId = currentProjectId;
  const canUpdate = can('PROJECT_TEMPLATE:UPDATE');

  const [scene, setScene] = useState<'case' | 'bug'>('case');
  const [tab, setTab] = useState<'fields' | 'templates' | 'workflow'>('fields');
  useEffect(() => { if (scene === 'case' && tab === 'workflow') setTab('fields'); }, [scene, tab]);

  // ── Tab1 字段 ──
  const fieldsQ = useQuery({
    queryKey: ['field-defs', orgId],
    queryFn: () => fieldDefApi.list(orgId!),
    enabled: Boolean(orgId),
  });
  const [fieldDrawerOpen, setFieldDrawerOpen] = useState(false);
  const [editingField, setEditingField] = useState<FieldDefRow | null>(null);
  const [fieldForm, setFieldForm] = useState<FieldFormState>(emptyFieldForm);

  const openFieldCreate = () => { setEditingField(null); setFieldForm(emptyFieldForm()); setFieldDrawerOpen(true); };
  const openFieldEdit = (row: FieldDefRow) => {
    const o = row.options ?? {};
    setEditingField(row);
    setFieldForm({
      name: row.name, key: row.key, type: row.type as FieldType, required: row.required,
      optionsText: ((o.options as string[] | undefined) ?? []).join('\n'),
      min: o.min as number | undefined, max: o.max as number | undefined,
      minLength: o.minLength as number | undefined, maxLength: o.maxLength as number | undefined,
      pattern: (o.pattern as string | undefined) ?? '', multiple: Boolean(o.multiple),
    });
    setFieldDrawerOpen(true);
  };
  const buildOptions = (): Record<string, unknown> => {
    const opts: Record<string, unknown> = {};
    if (['single_select', 'multi_select', 'radio'].includes(fieldForm.type)) {
      const list = fieldForm.optionsText.split('\n').map((s) => s.trim()).filter(Boolean);
      if (list.length) opts.options = list;
    }
    if (fieldForm.type === 'number') {
      if (fieldForm.min !== undefined && fieldForm.min !== null) opts.min = fieldForm.min;
      if (fieldForm.max !== undefined && fieldForm.max !== null) opts.max = fieldForm.max;
    }
    if (['input', 'textarea', 'url'].includes(fieldForm.type)) {
      if (fieldForm.minLength !== undefined && fieldForm.minLength !== null) opts.minLength = fieldForm.minLength;
      if (fieldForm.maxLength !== undefined && fieldForm.maxLength !== null) opts.maxLength = fieldForm.maxLength;
      if (fieldForm.pattern.trim()) opts.pattern = fieldForm.pattern.trim();
    }
    if (fieldForm.type === 'member' && fieldForm.multiple) opts.multiple = true;
    return opts;
  };
  const saveField = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {
        scene: editingField ? editingField.scene : scene, name: fieldForm.name.trim(),
        key: fieldForm.key.trim(), type: fieldForm.type, required: fieldForm.required, options: buildOptions(),
        // 编辑时保留启停状态与默认值（schema 缺省会回填 true/null 导致误启用/清空）
        enabled: editingField ? editingField.enabled : true,
      };
      if (editingField) {
        const dv = (editingField.options as { defaultValue?: string | number | string[] | boolean }).defaultValue;
        if (dv !== undefined) body.defaultValue = dv;
      }
      if (editingField) return fieldDefApi.update(orgId!, editingField.id, body);
      return fieldDefApi.create(orgId!, body);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['field-defs'] });
      setFieldDrawerOpen(false);
      message.success(editingField ? '字段已更新' : '字段已创建');
    },
    onError: (e) => message.error(e instanceof Error ? e.message : '保存失败'),
  });
  const removeField = useMutation({
    mutationFn: (id: string) => fieldDefApi.remove(orgId!, id),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['field-defs'] });
      if (r.softDisabled) message.info('字段已停用（存量数据保留）');
      else message.success('字段已删除');
    },
    onError: (e) => message.error(e instanceof Error ? e.message : '删除失败'),
  });

  // ── Tab2 模板 ──
  const modeQ = useQuery({
    queryKey: ['template-mode', projectId],
    queryFn: () => templateApi.mode(projectId!),
    enabled: Boolean(projectId),
  });
  const templatesQ = useQuery({
    queryKey: ['templates', orgId, projectId, scene],
    queryFn: () => templateApi.list(orgId!, projectId!, scene),
    enabled: Boolean(orgId && projectId),
  });
  const [enableOpen, setEnableOpen] = useState(false);
  const [enableName, setEnableName] = useState('');
  const enableMode = useMutation({
    mutationFn: () => templateApi.enableMode(projectId!),
    onSuccess: () => {
      setEnableOpen(false); setEnableName('');
      void qc.invalidateQueries({ queryKey: ['template-mode'] });
      void qc.invalidateQueries({ queryKey: ['templates'] });
      message.success('已启用项目模板（组织模板对本项目永久失效）');
    },
    onError: (e) => message.error(e instanceof Error ? e.message : '启用失败'),
  });
  const createTemplate = useMutation({
    mutationFn: (name: string) => templateApi.create(orgId!, projectId, { scene, name }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['templates'] });
      message.success('模板已创建，可继续编辑字段绑定');
    },
    onError: (e) => message.error(e instanceof Error ? e.message : '创建失败'),
  });
  const setDefault = useMutation({
    mutationFn: (id: string) => templateApi.setDefault(orgId!, projectId, id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['templates'] });
      message.success('已设为默认模板');
    },
    onError: (e) => message.error(e instanceof Error ? e.message : '操作失败'),
  });
  const copyTemplate = useMutation({
    mutationFn: (id: string) => templateApi.copy(orgId!, projectId, id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['templates'] });
      message.success('模板已复制');
    },
    onError: (e) => message.error(e instanceof Error ? e.message : '复制失败'),
  });
  const removeTemplate = useMutation({
    mutationFn: (id: string) => templateApi.remove(orgId!, projectId, id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['templates'] });
      message.success('模板已删除');
    },
    onError: (e) => message.error(e instanceof Error ? e.message : '删除失败'),
  });

  // 模板详情抽屉（字段绑定编辑）
  const [bindingTpl, setBindingTpl] = useState<TemplateRow | null>(null);
  const [bindings, setBindings] = useState<TemplateRow['fields']>([]);
  useEffect(() => { setBindings(bindingTpl?.fields ?? []); }, [bindingTpl]);
  const sceneDefs = (fieldsQ.data ?? []).filter((f) => f.scene === scene);
  const bindableDefs = sceneDefs.filter((d) => d.enabled && !bindings.some((b) => b.fieldKey === d.key));
  const saveBindings = useMutation({
    mutationFn: () => templateApi.updateFields(orgId!, projectId, bindingTpl!.id, bindings),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['templates'] });
      message.success('模板已更新');
      setBindingTpl(null);
    },
    onError: (e) => message.error(e instanceof Error ? e.message : '保存失败'),
  });
  const moveBinding = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= bindings.length) return;
    const next = [...bindings];
    const a = next[i]!;
    next[i] = next[j]!;
    next[j] = a;
    setBindings(next);
  };

  // ── Tab3 工作流（scene=bug）──
  const workflowQ = useQuery({
    queryKey: ['workflow', projectId],
    queryFn: () => workflowApi.get(projectId!),
    enabled: Boolean(projectId) && scene === 'bug' && tab === 'workflow',
  });
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const wf = workflowQ.data;
  useEffect(() => {
    setChecked(new Set((wf?.transitions ?? []).map((t) => `${t.from}→${t.to}`)));
  }, [wf]);
  const toggleCell = (from: string, to: string, on: boolean) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (on) next.add(`${from}→${to}`); else next.delete(`${from}→${to}`);
      return next;
    });
  };
  const saveTransitions = useMutation({
    mutationFn: () => workflowApi.updateTransitions(
      projectId!,
      [...checked].map((s) => { const [fromSerial = '', toSerial = ''] = s.split('→'); return { fromSerial, toSerial }; }),
    ),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['workflow'] });
      message.success(`流转矩阵已保存（${r.count} 条）`);
    },
    onError: (e) => message.error(e instanceof Error ? e.message : '保存失败'),
  });
  const createState = useMutation({
    mutationFn: (body: { serial: string; isEnd?: boolean }) => workflowApi.createState(projectId!, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['workflow'] });
      message.success('状态已创建');
    },
    onError: (e) => message.error(e instanceof Error ? e.message : '创建失败'),
  });
  const removeState = useMutation({
    mutationFn: (stateId: string) => workflowApi.removeState(projectId!, stateId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['workflow'] });
      message.success('状态已删除');
    },
    onError: (e) => message.error(e instanceof Error ? e.message : '删除失败'),
  });
  const promptCreateState = () => {
    let serial = '';
    let isEnd = false;
    modal.confirm({
      title: '新建工作流状态',
      content: (
        <div className="space-y-2 pt-2">
          <Input placeholder="状态名称（如：挂起）" onChange={(e) => { serial = e.target.value; }} />
          <Checkbox onChange={(e: CheckboxChangeEvent) => { isEnd = e.target.checked; }}>设为结束态（不计「待处理」统计）</Checkbox>
        </div>
      ),
      onOk: () => createState.mutateAsync({ serial: serial.trim(), isEnd }),
    });
  };
  const promptCreateTemplate = () => {
    let name = '';
    modal.confirm({
      title: '新建模板',
      content: <Input placeholder="模板名称" onChange={(e) => { name = e.target.value; }} />,
      onOk: () => createTemplate.mutateAsync(name.trim()),
    });
  };

  const sceneLabel = scene === 'case' ? '用例' : '缺陷';
  const tabs: { key: typeof tab; label: string; testid: string }[] = [
    { key: 'fields', label: '字段', testid: 'tab-fields' },
    { key: 'templates', label: '模板', testid: 'tab-templates' },
  ];
  if (scene === 'bug') tabs.push({ key: 'workflow', label: '工作流', testid: 'tab-workflow' });

  return (
    <div>
      <PageHeader
        title="模板管理"
        sub={`项目 › 设置 › 模板管理（当前场景：${sceneLabel}）`}
        extra={
          <Segmented
            value={scene}
            onChange={(v) => setScene(v as 'case' | 'bug')}
            options={[
              { value: 'case', label: <span data-testid="scene-case">用例</span> },
              { value: 'bug', label: <span data-testid="scene-bug">缺陷</span> },
            ]}
          />
        }
      />
      <div className="flex gap-4 border-b border-[#E5E6EB] mb-4 text-[13px]">
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

      {tab === 'fields' && (
        <div className="rabbit-card">
          <div className="flex items-center gap-3 p-3 border-b border-[#F0F1F3]">
            <span className="font-medium text-sm">自定义字段</span>
            <span className="text-xs text-[#A8ABB0]">类型与标识保存后不可修改</span>
            {canUpdate && (
              <Button type="primary" size="small" icon={<Plus size={14} />} className="ml-auto" onClick={openFieldCreate} data-testid="btn-new-field">新建字段</Button>
            )}
          </div>
          <Table<FieldDefRow>
            rowKey="id"
            loading={fieldsQ.isLoading}
            dataSource={fieldsQ.data ?? []}
            pagination={false}
            columns={[
              { title: '名称', dataIndex: 'name', render: (v: string, r) => <span className={r.enabled ? '' : 'text-[#A8ABB0]'}>{v}</span> },
              { title: '标识 key', dataIndex: 'key', render: (v: string, r) => <span className={`font-mono text-xs ${r.enabled ? 'text-[#646A73]' : 'text-[#A8ABB0]'}`}>{v}</span> },
              { title: '类型', dataIndex: 'type', width: 96, render: (v: string, r) => <span className={r.enabled ? '' : 'text-[#A8ABB0]'}>{TYPE_LABELS[v as FieldType] ?? v}</span> },
              { title: '场景', dataIndex: 'scene', width: 72, render: (v: string, r) => <span className={r.enabled ? '' : 'text-[#A8ABB0]'}>{v === 'case' ? '用例' : '缺陷'}</span> },
              { title: '必填', dataIndex: 'required', width: 64, render: (v: boolean) => <Checkbox checked={v} disabled /> },
              {
                title: '状态', dataIndex: 'enabled', width: 72,
                render: (v: boolean) => v ? <span className="text-xs text-[#52C41A]">启用</span> : <span className="text-xs text-[#A8ABB0]">停用</span>,
              },
              {
                title: '操作', key: 'op', width: 130,
                render: (_, row) => canUpdate ? (
                  <span className="flex gap-2">
                    <Button type="link" size="small" className="!px-0" onClick={() => openFieldEdit(row)}>编辑</Button>
                    <Popconfirm title={`删除字段「${row.name}」？`} description="若已有存量数据将转为停用（数据保留）" onConfirm={() => removeField.mutate(row.id)}>
                      <Button type="link" size="small" danger className="!px-0">删除</Button>
                    </Popconfirm>
                  </span>
                ) : <span className="text-xs text-[#A8ABB0]">—</span>,
              },
            ]}
          />
        </div>
      )}

      {tab === 'templates' && (
        <div className="space-y-4">
          {modeQ.data && !modeQ.data.enabled && (
            <div className="rabbit-card p-3 flex items-center gap-3">
              <span className="text-[13px] text-[#3D4350]">
                模板来源：<b>组织模板（继承）</b>
                <span className="text-xs text-[#A8ABB0] ml-2">组织模板对本项目生效</span>
              </span>
              {canUpdate && (
                <Button danger className="ml-auto" onClick={() => { setEnableName(''); setEnableOpen(true); }} data-testid="btn-enable-project-template">启用项目模板</Button>
              )}
            </div>
          )}
          <div className="rabbit-card">
            <div className="flex items-center gap-3 p-3 border-b border-[#F0F1F3]">
              <span className="font-medium text-sm">{sceneLabel}模板</span>
              <span className="text-xs text-[#A8ABB0]">{sceneLabel}模板上限 20 个；每个场景有且仅有一个默认模板</span>
              {canUpdate && (
                <Button type="primary" size="small" icon={<Plus size={14} />} className="ml-auto" onClick={promptCreateTemplate} data-testid="btn-new-template">新建模板</Button>
              )}
            </div>
            <Table<TemplateRow>
              rowKey="id"
              loading={templatesQ.isLoading}
              dataSource={templatesQ.data ?? []}
              pagination={false}
              columns={[
                {
                  title: '名称', dataIndex: 'name',
                  render: (v: string, r) => (
                    <span>
                      <a className="text-[#574BFF]" onClick={() => canUpdate && setBindingTpl(r)}>{v}</a>
                      {r.isDefault && <Tag color="purple" bordered={false} className="ml-2">默认</Tag>}
                      {r.isSystem && <Tag bordered={false} className="ml-1">系统</Tag>}
                    </span>
                  ),
                },
                { title: '字段数', dataIndex: 'fields', width: 80, render: (f: TemplateRow['fields']) => f.length },
                { title: '引用数', dataIndex: 'refCount', width: 80 },
                { title: '更新时间', dataIndex: 'createdAt', width: 120, render: (v: string) => <span className="text-[#87888D]">{v.slice(0, 10)}</span> },
                {
                  title: '操作', key: 'op', width: 260,
                  render: (_, r) => canUpdate ? (
                    <span className="flex gap-1">
                      <Button type="link" size="small" className="!px-0" disabled={r.isDefault} onClick={() => setDefault.mutate(r.id)}>设为默认</Button>
                      <Button type="link" size="small" className="!px-0" onClick={() => copyTemplate.mutate(r.id)}>复制</Button>
                      <Button type="link" size="small" className="!px-0" onClick={() => setBindingTpl(r)}>编辑字段</Button>
                      {!r.isSystem && (
                        <Popconfirm title={`删除模板「${r.name}」？`} description="存在实例引用时将被拒绝" onConfirm={() => removeTemplate.mutate(r.id)}>
                          <Button type="link" size="small" danger className="!px-0">删除</Button>
                        </Popconfirm>
                      )}
                    </span>
                  ) : <span className="text-xs text-[#A8ABB0]">—</span>,
                },
              ]}
            />
          </div>
        </div>
      )}

      {tab === 'workflow' && scene === 'bug' && wf && (
        <div className="flex gap-4 items-stretch">
          <div className="w-60 shrink-0 rabbit-card flex flex-col">
            <div className="flex items-center p-3 border-b border-[#F0F1F3]">
              <span className="font-medium text-sm">工作流状态</span>
              {canUpdate && <Button type="link" size="small" className="ml-auto !px-0" onClick={promptCreateState} data-testid="btn-new-state">＋ 新建状态</Button>}
            </div>
            <div className="p-2 space-y-1 flex-1">
              {wf.states.map((s, i) => (
                <div
                  key={s.id}
                  data-testid={`state-item-${s.serial}`}
                  className="px-2 py-2 rounded flex items-center gap-2 text-[13px] text-[#3D4350] hover:bg-[#F7F8FA]"
                >
                  <span className="truncate">{s.serial}</span>
                  {s.isStart && <span className="text-[10px] border border-[#574BFF] text-[#574BFF] rounded px-1">初始</span>}
                  {s.isEnd && <span className="text-[10px] border border-[#52C41A] text-[#52C41A] rounded px-1">结束</span>}
                  <span className="ml-auto text-xs text-[#A8ABB0]">#{i + 1}</span>
                  {canUpdate && !s.isStart && (
                    <Popconfirm title={`删除状态「${s.serial}」？`} description="需先清除矩阵中相关勾选" onConfirm={() => removeState.mutate(s.id)}>
                      <Button type="link" size="small" danger className="!px-0 !h-auto">删除</Button>
                    </Popconfirm>
                  )}
                </div>
              ))}
            </div>
          </div>
          <div className="flex-1 rabbit-card min-w-0">
            <div className="p-3 border-b border-[#F0F1F3] flex items-center gap-2">
              <span className="font-medium text-sm">流转矩阵</span>
              <span className="text-xs text-[#A8ABB0]">行=当前状态，列=目标状态；勾选=允许流转</span>
              {canUpdate && (
                <Button type="primary" size="small" className="ml-auto" loading={saveTransitions.isPending} onClick={() => saveTransitions.mutate()} data-testid="btn-save-transitions">保存矩阵</Button>
              )}
            </div>
            <div className="overflow-auto" data-testid="workflow-matrix">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-[#F0F1F3] text-xs text-[#A8ABB0]">
                    <th className="text-left p-2 font-normal">从 ＼ 至</th>
                    {wf.states.map((s) => <th key={s.id} className="p-2 font-normal whitespace-nowrap">{s.serial}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {wf.states.map((from) => (
                    <tr key={from.id} className="border-b border-[#F0F1F3]">
                      <td className="p-2 whitespace-nowrap">{from.serial}</td>
                      {wf.states.map((to) => {
                        const diagonal = from.id === to.id;
                        return (
                          <td key={to.id} className="p-2 text-center">
                            <Checkbox
                              checked={checked.has(`${from.serial}→${to.serial}`)}
                              disabled={diagonal || !canUpdate}
                              onChange={(e) => toggleCell(from.serial, to.serial, e.target.checked)}
                              data-testid={`cell-${from.serial}-${to.serial}`}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
      {tab === 'workflow' && scene === 'bug' && !wf && !workflowQ.isLoading && (
        <Alert type="warning" showIcon message="默认缺陷模板缺失，无法加载工作流（请重新初始化组织模板）" />
      )}

      {/* 新建/编辑字段抽屉 */}
      <Drawer title={editingField ? '编辑字段' : '新建字段'} open={fieldDrawerOpen} onClose={() => setFieldDrawerOpen(false)} width={480}>
        <div className="space-y-4">
          <div>
            <label className="block text-[13px] mb-1">名称 <span className="text-[#FF4D4F]">*</span></label>
            <Input value={fieldForm.name} onChange={(e) => setFieldForm({ ...fieldForm, name: e.target.value })} data-testid="input-field-name" />
          </div>
          <div>
            <label className="block text-[13px] mb-1">标识 key <span className="text-[#FF4D4F]">*</span></label>
            <Input
              value={fieldForm.key}
              disabled={Boolean(editingField)}
              placeholder="小写字母开头，仅小写字母/数字/下划线"
              onChange={(e) => setFieldForm({ ...fieldForm, key: e.target.value })}
              data-testid="input-field-key"
            />
            <p className="text-xs text-[#A8ABB0] mt-1">{editingField ? 'key 只读：保存后不可修改' : '保存后不可修改；模板与实例按 key 引用'}</p>
          </div>
          <div>
            <label className="block text-[13px] mb-1">类型 <span className="text-[#FF4D4F]">*</span></label>
            <div className="grid grid-cols-5 gap-1.5" data-testid="field-type-selector">
              {TYPE_LIST.map((t) => (
                <Button
                  key={t}
                  size="small"
                  type={fieldForm.type === t ? 'primary' : 'default'}
                  disabled={Boolean(editingField)}
                  onClick={() => setFieldForm({ ...fieldForm, type: t })}
                  data-testid={`field-type-${t}`}
                >
                  {TYPE_LABELS[t]}
                </Button>
              ))}
            </div>
            {editingField && <p className="text-xs text-[#A8ABB0] mt-1">类型保存后不可修改</p>}
          </div>
          {['single_select', 'multi_select', 'radio'].includes(fieldForm.type) && (
            <div>
              <label className="block text-[13px] mb-1">选项（一行一个）</label>
              <Input.TextArea
                rows={5}
                value={fieldForm.optionsText}
                placeholder={'致命\n严重\n一般\n轻微'}
                onChange={(e) => setFieldForm({ ...fieldForm, optionsText: e.target.value })}
                data-testid="input-field-options"
              />
            </div>
          )}
          {fieldForm.type === 'number' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[13px] mb-1">最小值</label>
                <InputNumber className="w-full" value={fieldForm.min} onChange={(v) => setFieldForm({ ...fieldForm, min: v ?? undefined })} />
              </div>
              <div>
                <label className="block text-[13px] mb-1">最大值</label>
                <InputNumber className="w-full" value={fieldForm.max} onChange={(v) => setFieldForm({ ...fieldForm, max: v ?? undefined })} />
              </div>
            </div>
          )}
          {['input', 'textarea', 'url'].includes(fieldForm.type) && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[13px] mb-1">最小长度</label>
                  <InputNumber className="w-full" min={0} value={fieldForm.minLength} onChange={(v) => setFieldForm({ ...fieldForm, minLength: v ?? undefined })} />
                </div>
                <div>
                  <label className="block text-[13px] mb-1">最大长度</label>
                  <InputNumber className="w-full" min={0} value={fieldForm.maxLength} onChange={(v) => setFieldForm({ ...fieldForm, maxLength: v ?? undefined })} />
                </div>
              </div>
              <div>
                <label className="block text-[13px] mb-1">正则校验（可选）</label>
                <Input value={fieldForm.pattern} placeholder="如 ^[A-Z]{2,10}$" onChange={(e) => setFieldForm({ ...fieldForm, pattern: e.target.value })} />
              </div>
            </>
          )}
          {fieldForm.type === 'member' && (
            <div className="flex items-center gap-2">
              <span className="text-[13px]">允许多选</span>
              <Switch checked={fieldForm.multiple} onChange={(v) => setFieldForm({ ...fieldForm, multiple: v })} />
            </div>
          )}
          <div className="flex items-center gap-2">
            <span className="text-[13px]">必填</span>
            <Switch checked={fieldForm.required} onChange={(v) => setFieldForm({ ...fieldForm, required: v })} data-testid="switch-field-required" />
          </div>
          {canUpdate && (
            <Button
              type="primary" block loading={saveField.isPending}
              disabled={!fieldForm.name.trim() || !/^[a-z][a-z0-9_]{1,63}$/.test(fieldForm.key.trim())}
              onClick={() => saveField.mutate()}
              data-testid="btn-submit-field"
            >
              保存
            </Button>
          )}
        </div>
      </Drawer>

      {/* 启用项目模板（不可逆）双确认 */}
      <Modal
        title={<span className="text-[#FF4D4F]">启用项目模板（不可恢复）</span>}
        open={enableOpen}
        onCancel={() => setEnableOpen(false)}
        okText="确认启用"
        okButtonProps={{ danger: true, disabled: enableName.trim() !== (project?.name ?? ''), loading: enableMode.isPending }}
        onOk={() => enableMode.mutate()}
      >
        <Alert
          type="error" showIcon className="!mb-3"
          message="该操作不可逆"
          description="启用后组织模板对本项目永久失效且不可恢复；项目内已引用组织模板的实例将按字段交集继续有效。"
        />
        <p className="text-[13px] mb-1">输入项目名称 <b>{project?.name}</b> 以确认：</p>
        <Input value={enableName} onChange={(e) => setEnableName(e.target.value)} placeholder="项目名称" data-testid="input-enable-template-name" />
      </Modal>

      {/* 模板详情：字段绑定抽屉 */}
      <Drawer
        title={<span>「{bindingTpl?.name}」· 字段绑定</span>}
        open={Boolean(bindingTpl)}
        onClose={() => setBindingTpl(null)}
        width={640}
      >
        <p className="text-xs text-[#A8ABB0] mb-3">必填 / 列表显示为模板级覆写；上下移调整字段顺序</p>
        <Table
          rowKey="fieldKey"
          dataSource={bindings}
          pagination={false}
          size="small"
          columns={[
            {
              title: '排序', width: 90,
              render: (_, _b, i) => (
                <span className="flex gap-1">
                  <Button type="text" size="small" icon={<ArrowUp size={12} />} disabled={i === 0} onClick={() => moveBinding(i, -1)} />
                  <Button type="text" size="small" icon={<ArrowDown size={12} />} disabled={i === bindings.length - 1} onClick={() => moveBinding(i, 1)} />
                </span>
              ),
            },
            {
              title: '字段', dataIndex: 'fieldKey',
              render: (k: string) => {
                const def = sceneDefs.find((d) => d.key === k);
                return def ? def.name : <span className="text-[#A8ABB0]">{k}（字段已停用）</span>;
              },
            },
            {
              title: '类型', width: 90,
              render: (_, b) => {
                const def = sceneDefs.find((d) => d.key === b.fieldKey);
                return <span className="text-[#646A73]">{def ? TYPE_LABELS[def.type as FieldType] : '—'}</span>;
              },
            },
            {
              title: '必填（覆写）', width: 100,
              render: (_, b, i) => (
                <Checkbox
                  checked={b.required ?? sceneDefs.find((d) => d.key === b.fieldKey)?.required ?? false}
                  onChange={(e) => setBindings(bindings.map((x, j) => (j === i ? { ...x, required: e.target.checked } : x)))}
                />
              ),
            },
            {
              title: '列表显示（覆写）', width: 110,
              render: (_, b, i) => (
                <Checkbox
                  checked={Boolean(b.visibleInList)}
                  onChange={(e) => setBindings(bindings.map((x, j) => (j === i ? { ...x, visibleInList: e.target.checked } : x)))}
                />
              ),
            },
            {
              title: '', width: 60,
              render: (_, _b, i) => (
                <Button type="link" size="small" danger className="!px-0" onClick={() => setBindings(bindings.filter((_, j) => j !== i))}>移除</Button>
              ),
            },
          ]}
        />
        {bindableDefs.length > 0 && (
          <div className="flex items-center gap-2 mt-3">
            <span className="text-[13px]">添加字段：</span>
            <Select
              className="w-56" placeholder="选择字段" showSearch optionFilterProp="label" virtual={false}
              value={undefined}
              options={bindableDefs.map((d) => ({ value: d.key, label: `${d.name}（${d.key}）` }))}
              onChange={(key) => { if (typeof key === 'string') setBindings([...bindings, { fieldKey: key }]); }}
              data-testid="select-bind-field"
            />
          </div>
        )}
        <Button type="primary" className="mt-4" loading={saveBindings.isPending} onClick={() => saveBindings.mutate()} data-testid="btn-save-bindings">保存绑定</Button>
      </Drawer>
    </div>
  );
}

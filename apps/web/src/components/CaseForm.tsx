'use client';

import { App, Button, Input, Radio, Select, Space } from 'antd';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { caseApi, ApiError } from '@rabbit/api-client';
import type { CaseCreateInput, CaseStep } from '@rabbit/shared';
import { useProjectStore } from '@/stores/project';

interface Props { caseId?: string }

export function CaseForm({ caseId }: Props) {
  const router = useRouter();
  const { message } = App.useApp();
  const { currentProjectId } = useProjectStore();
  const [form, setForm] = useState<CaseCreateInput>({ name: '', precondition: '', steps: [], level: 'P2', tags: [] });
  const [version, setVersion] = useState(1);
  const [num, setNum] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(!caseId);

  useEffect(() => {
    if (!caseId || !currentProjectId) return;
    void caseApi.detail(currentProjectId, caseId).then((d) => {
      setForm({ name: d.name, precondition: d.precondition, steps: d.steps, level: d.level, tags: d.tags });
      setVersion(d.version);
      setNum(d.num);
      setLoaded(true);
    }).catch((e) => message.error(e instanceof ApiError ? e.message : '加载失败'));
  }, [caseId, currentProjectId, message]);

  function setStep(i: number, patch: Partial<CaseStep>) {
    setForm((f) => ({ ...f, steps: f.steps.map((s, idx) => (idx === i ? { ...s, ...patch } : s)) }));
  }

  async function save(continu = false) {
    if (!currentProjectId) return;
    if (!form.name.trim()) {
      message.error('名称不能为空');
      return;
    }
    setSaving(true);
    try {
      if (caseId) {
        const updated = await caseApi.update(currentProjectId, caseId, { ...form, version });
        setVersion(updated.version);
        message.success('已保存');
      } else {
        const created = await caseApi.create(currentProjectId, form);
        message.success(`已创建 C-${String(created.num).padStart(4, '0')}`);
        if (!continu) {
          router.push('/cases');
          return;
        }
        setForm({ name: '', precondition: '', steps: [], level: 'P2', tags: [] });
      }
    } catch (e) {
      message.error(e instanceof ApiError ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }

  if (!loaded) return null;

  return (
    <div className="max-w-3xl">
      <div className="flex items-center gap-2 mb-4">
        <a className="text-gray-400 text-sm" href="/cases">‹ 用例列表</a>
        <h1 className="text-lg font-medium m-0">{caseId ? `编辑用例${num ? ` C-${String(num).padStart(4, '0')}` : ''}` : '新建用例'}</h1>
        <span className="text-xs text-gray-400">v{version}</span>
      </div>
      <div className="bg-white border rounded p-6 space-y-5" data-testid="case-form">
        <div className="grid grid-cols-[80px_1fr] items-center gap-3">
          <label className="text-sm text-gray-600">名称 <span className="text-red-500">*</span></label>
          <Input
            value={form.name}
            maxLength={512}
            placeholder="用例名称"
            data-testid="case-name"
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
        </div>
        <div className="grid grid-cols-[80px_1fr] gap-3">
          <label className="text-sm text-gray-600">前置条件</label>
          <Input.TextArea
            rows={2}
            value={form.precondition}
            placeholder="前置条件"
            data-testid="case-precondition"
            onChange={(e) => setForm((f) => ({ ...f, precondition: e.target.value }))}
          />
        </div>
        <div className="grid grid-cols-[80px_1fr] gap-3">
          <label className="text-sm text-gray-600">步骤</label>
          <div className="space-y-2" data-testid="case-steps">
            {form.steps.map((s, i) => (
              <div key={i} className="flex gap-2">
                <span className="w-6 h-6 rounded bg-gray-100 grid place-items-center text-xs shrink-0">{i + 1}</span>
                <Input
                  placeholder="步骤描述"
                  value={s.desc}
                  data-testid={`step-desc-${i + 1}`}
                  onChange={(e) => setStep(i, { desc: e.target.value })}
                />
                <Input
                  placeholder="预期结果"
                  value={s.expect}
                  data-testid={`step-expect-${i + 1}`}
                  onChange={(e) => setStep(i, { expect: e.target.value })}
                />
                <Button
                  type="text"
                  className="text-gray-400"
                  aria-label={`remove-step-${i + 1}`}
                  onClick={() => setForm((f) => ({ ...f, steps: f.steps.filter((_, idx) => idx !== i) }))}
                >
                  ✕
                </Button>
              </div>
            ))}
            <Button type="link" className="px-0" data-testid="btn-add-step" onClick={() => setForm((f) => ({ ...f, steps: [...f.steps, { desc: '', expect: '' }] }))}>
              ＋ 添加步骤
            </Button>
          </div>
        </div>
        <div className="grid grid-cols-[80px_1fr] items-center gap-3">
          <label className="text-sm text-gray-600">等级</label>
          <Radio.Group
            value={form.level}
            data-testid="case-level"
            onChange={(e) => setForm((f) => ({ ...f, level: e.target.value }))}
            options={['P0', 'P1', 'P2', 'P3'].map((l) => ({ value: l, label: <span className={l === 'P0' ? 'text-red-500 font-medium' : ''}>{l}</span> }))}
          />
        </div>
        <div className="grid grid-cols-[80px_1fr] items-center gap-3">
          <label className="text-sm text-gray-600">标签</label>
          <Select
            mode="tags"
            className="w-full"
            value={form.tags}
            placeholder="输入回车添加"
            data-testid="case-tags"
            onChange={(tags) => setForm((f) => ({ ...f, tags }))}
          />
        </div>
        <Space>
          <Button type="primary" loading={saving} data-testid="btn-save-case" onClick={() => save(false)}>保存</Button>
          {!caseId && <Button onClick={() => save(true)} data-testid="btn-save-continue">保存并继续</Button>}
          <Button onClick={() => router.push('/cases')}>取消</Button>
        </Space>
      </div>
    </div>
  );
}

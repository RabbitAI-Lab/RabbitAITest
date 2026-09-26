'use client';

import { Checkbox, DatePicker, Input, InputNumber, Radio, Select } from 'antd';
import type { FieldDefInput, TemplateFieldBinding } from '@rabbit/shared';
import { renderKind } from '@rabbit/shared';
import dayjs, { type Dayjs } from 'dayjs';

/** PROJ-002：动态字段渲染（表单控件 ×10 类型；只读态/列表单元格导出）。 */

export interface DynFieldDef extends FieldDefInput { id?: string }

function optionsOf(def: DynFieldDef): string[] {
  const opts = (def.options ?? {}) as { options?: string[] };
  return opts.options ?? [];
}

export function DynamicFieldInput({
  def, value, onChange, disabled,
}: {
  def: DynFieldDef;
  value: unknown;
  onChange: (v: unknown) => void;
  disabled?: boolean;
}) {
  const kind = renderKind(def.type);
  switch (kind) {
    case 'InputNumber':
      return <InputNumber value={value === undefined || value === null ? null : Number(value)} disabled={disabled} onChange={(v) => onChange(v ?? undefined)} className="w-full" data-testid={`dyn-${def.key}`} />;
    case 'DatePicker':
      return <DatePicker value={value ? dayjs(String(value)) : null} disabled={disabled} onChange={(d: Dayjs | null) => onChange(d ? d.format('YYYY-MM-DD') : undefined)} className="w-full" data-testid={`dyn-${def.key}`} />;
    case 'Select':
      return <Select value={value as string} disabled={disabled} allowClear virtual={false} options={optionsOf(def).map((o) => ({ value: o, label: o }))} onChange={(v) => onChange(v)} className="w-full" data-testid={`dyn-${def.key}`} />;
    case 'SelectMultiple':
      return <Select mode="multiple" virtual={false} value={(value as string[]) ?? []} disabled={disabled} allowClear options={optionsOf(def).map((o) => ({ value: o, label: o }))} onChange={(v) => onChange(v)} className="w-full" data-testid={`dyn-${def.key}`} />;
    case 'Checkbox':
      return <Checkbox checked={Boolean(value)} disabled={disabled} onChange={(e) => onChange(e.target.checked)} data-testid={`dyn-${def.key}`}>{def.name}</Checkbox>;
    case 'RadioGroup':
      return <Radio.Group value={value as string} disabled={disabled} onChange={(e) => onChange(e.target.value)} data-testid={`dyn-${def.key}`}>
        {optionsOf(def).map((o) => <Radio.Button key={o} value={o}>{o}</Radio.Button>)}
      </Radio.Group>;
    case 'Input.URL':
      return <Input value={(value as string) ?? ''} disabled={disabled} placeholder="https://" onChange={(e) => onChange(e.target.value)} data-testid={`dyn-${def.key}`} />;
    case 'TextArea':
      return <Input.TextArea value={(value as string) ?? ''} disabled={disabled} rows={3} onChange={(e) => onChange(e.target.value)} data-testid={`dyn-${def.key}`} />;
    default:
      return <Input value={(value as string) ?? ''} disabled={disabled} onChange={(e) => onChange(e.target.value)} data-testid={`dyn-${def.key}`} />;
  }
}

/** 动态字段区（按模板绑定渲染；required 覆写生效）。 */
export function DynamicFieldForm({
  defs, bindings, value, onChange, disabled, members,
}: {
  defs: DynFieldDef[];
  bindings?: TemplateFieldBinding[];
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  disabled?: boolean;
  members?: { id: string; name: string }[];
}) {
  const bound = bindings && bindings.length > 0 ? bindings : undefined;
  const visible = defs.filter((d) => d.enabled !== false && (!bound || bound.some((b) => b.fieldKey === d.key)));
  if (visible.length === 0) return null;
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-4" data-testid="dynamic-fields">
      {visible.map((def) => {
        const b = bound?.find((x) => x.fieldKey === def.key);
        const required = b?.required ?? def.required;
        return (
          <div key={def.key} className={renderKind(def.type) === 'TextArea' ? 'col-span-2' : ''}>
            <label className="block text-[13px] text-[#3D4350] mb-1">
              {def.name}
              {required && <span className="text-[#FF4D4F] ml-0.5">*</span>}
            </label>
            {renderKind(def.type) === 'MemberSelect' ? (
              <Select
                value={value[def.key] as string}
                disabled={disabled}
                allowClear
                virtual={false}
                mode={(def.options as { multiple?: boolean } | undefined)?.multiple ? 'multiple' : undefined}
                showSearch
                optionFilterProp="label"
                options={(members ?? []).map((m) => ({ value: m.id, label: m.name }))}
                onChange={(v) => onChange({ ...value, [def.key]: v })}
                className="w-full"
                data-testid={`dyn-${def.key}`}
              />
            ) : (
              <DynamicFieldInput def={def} value={value[def.key]} disabled={disabled} onChange={(v) => onChange({ ...value, [def.key]: v })} />
            )}
          </div>
        );
      })}
    </div>
  );
}

/** 列表单元格/详情只读展示。 */
export function DynamicFieldCell({ def, value }: { def: DynFieldDef; value: unknown }) {
  if (value === undefined || value === null || value === '') return <span className="text-[#A8ABB0]">—</span>;
  if (Array.isArray(value)) return <span>{value.join('、')}</span>;
  if (typeof value === 'boolean') return <span>{value ? '是' : '否'}</span>;
  return <span>{String(value)}</span>;
}

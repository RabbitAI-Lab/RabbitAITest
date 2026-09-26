/**
 * 动态自定义字段引擎（dynamic-template-fields.md §2 + PROJ-002）：
 * 字段定义 → zod 动态校验器（服务端单一来源）→ 前端控件映射元数据（renderKind）。
 * 10 类字段：input/textarea/number/date/single_select/multi_select/checkbox/radio/member/url
 */
import { z } from 'zod';

export const FIELD_TYPES = [
  'input', 'textarea', 'number', 'date', 'single_select',
  'multi_select', 'checkbox', 'radio', 'member', 'url',
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

/** options 按 type 判别：select/radio 带 options 列表；input/textarea/url 带长度与正则；number 带范围 */
export const fieldOptionsSchema = z.object({
  options: z.array(z.string().min(1).max(64)).max(50).optional(), // single_select/multi_select/radio
  min: z.number().optional(), // number 范围
  max: z.number().optional(),
  minLength: z.number().int().min(0).max(4000).optional(), // input/textarea/url 长度
  maxLength: z.number().int().min(0).max(8000).optional(),
  pattern: z.string().max(256).optional(), // input/url 正则（RE2 安全子集，服务端 new RegExp 编译失败即 422）
  multiple: z.boolean().optional(), // member 是否多选
});

/** FieldDef（持久化形态：scene/name/key/type/required/default/options） */
export const fieldDefSchema = z.object({
  scene: z.enum(['case', 'bug']),
  name: z.string().min(1).max(128),
  key: z.string().regex(/^[a-z][a-z0-9_]{1,63}$/), // 小写标识，模板/实例按 key 引用
  type: z.enum(FIELD_TYPES),
  required: z.boolean().default(false),
  defaultValue: z.union([z.string(), z.number(), z.array(z.string()), z.boolean()]).optional(),
  options: fieldOptionsSchema.default({}),
  enabled: z.boolean().default(true),
});
export type FieldDefInput = z.infer<typeof fieldDefSchema>;
export type FieldDefLike = FieldDefInput;

/** 模板字段绑定（Template.fields 数组元素；required/visibleInList 为模板级覆写） */
export const templateFieldBindingSchema = z.object({
  fieldKey: z.string(),
  required: z.boolean().optional(),
  visibleInList: z.boolean().default(false),
});
export type TemplateFieldBinding = z.infer<typeof templateFieldBindingSchema>;

function buildOne(def: FieldDefLike, required: boolean): z.ZodTypeAny {
  let inner: z.ZodTypeAny;
  switch (def.type) {
    case 'number': {
      let n = z.number();
      const o = def.options ?? {};
      if (o.min !== undefined) n = n.min(o.min);
      if (o.max !== undefined) n = n.max(o.max);
      inner = n;
      break;
    }
    case 'checkbox':
      inner = z.boolean();
      break;
    case 'multi_select': {
      const opts = def.options?.options ?? [];
      inner = z.array(z.string()).max(50)
        .refine((arr) => opts.length === 0 || arr.every((v) => opts.includes(v)), { message: `${def.name} 含非法选项` });
      break;
    }
    case 'date':
      inner = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: `${def.name} 需为 YYYY-MM-DD` });
      break;
    case 'url': {
      const o = def.options ?? {};
      let u = z.string().url({ message: `${def.name} 需为合法 URL` });
      if (o.minLength !== undefined) u = u.min(o.minLength);
      if (o.maxLength !== undefined) u = u.max(o.maxLength);
      inner = u;
      break;
    }
    case 'member': {
      const m = z.string().uuid({ message: `${def.name} 需选择成员` });
      inner = def.options?.multiple ? z.array(m) : m;
      break;
    }
    case 'single_select':
    case 'radio': {
      const opts = def.options?.options ?? [];
      inner = z.string()
        .refine((v) => opts.length === 0 || opts.includes(v), { message: `${def.name} 含非法选项` });
      break;
    }
    case 'input':
    case 'textarea':
    default: {
      let t = def.type === 'input' ? z.string().max(4000) : z.string().max(8000);
      const o = def.options ?? {};
      if (o.minLength !== undefined) t = t.min(o.minLength);
      if (o.maxLength !== undefined) t = t.max(o.maxLength);
      inner = t;
      if (o.pattern) {
        const re = safeCompile(o.pattern);
        if (re) inner = t.refine((v) => re.test(v), { message: `${def.name} 格式不符` });
      }
      break;
    }
  }
  if (def.defaultValue !== undefined && !required) {
    // 有默认值且非必填：缺省时由服务端填入默认值后再校验
    return z.union([inner, z.literal(undefined)]).transform((v) => v ?? def.defaultValue);
  }
  return required ? inner : inner.optional().nullable();
}

function safeCompile(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern);
  } catch {
    return null;
  }
}

/**
 * buildValidator：字段定义集合 → 实例值（JSONB）的 zod schema。
 * bind 为模板绑定（覆写 required）；未绑定的字段定义不参与校验。
 */
export function buildValidator(
  defs: FieldDefLike[],
  bind?: TemplateFieldBinding[],
): z.ZodType<Record<string, unknown>> {
  const shape: Record<string, z.ZodTypeAny> = {};
  const bindMap = new Map((bind ?? []).map((b) => [b.fieldKey, b]));
  for (const def of defs) {
    if (def.enabled === false) continue; // 停用字段不再校验（存量数据保留）
    const b = bindMap.get(def.key);
    if (bind && !b) continue; // 传了绑定清单则只认绑定字段
    shape[def.key] = buildOne(def, b?.required ?? def.required);
  }
  return z.object(shape).passthrough().strip().or(z.record(z.unknown()));
}

/** 前端控件映射元数据（renderKind：AntD 控件族） */
export function renderKind(type: FieldType): string {
  switch (type) {
    case 'number': return 'InputNumber';
    case 'date': return 'DatePicker';
    case 'single_select': return 'Select';
    case 'multi_select': return 'SelectMultiple';
    case 'checkbox': return 'Checkbox';
    case 'radio': return 'RadioGroup';
    case 'member': return 'MemberSelect';
    case 'url': return 'Input.URL';
    case 'textarea': return 'TextArea';
    default: return 'Input';
  }
}

/** 工作流流转矩阵（PROJ-002/BUG-001）：from→to 白名单 */
export const workflowStateSchema = z.object({
  serial: z.string().min(1).max(64),
  isStart: z.boolean().default(false),
  isEnd: z.boolean().default(false),
});
export const workflowTransitionsSchema = z.object({
  transitions: z.array(z.object({ fromSerial: z.string(), toSerial: z.string() })).max(400),
});

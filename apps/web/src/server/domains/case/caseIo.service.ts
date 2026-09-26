/** CASE-004：用例 Excel/Xmind 导入导出（模板下载、覆盖/跳过、校验报告、MeterSphere 模板兼容）。 */
import { DomainError, ErrCode } from '@rabbit/shared';
import { prisma } from '@rabbit/db';

export const IMPORT_ROW_LIMIT = 5000;

type XlsxLoad = Parameters<import('exceljs').Workbook['xlsx']['load']>[0];
const asXlsx = (b: Buffer): XlsxLoad => b as unknown as XlsxLoad;
type PrismaJson = import('@rabbit/db').Prisma.InputJsonValue;
const toJson = (v: unknown): PrismaJson => JSON.parse(JSON.stringify(v ?? {})) as PrismaJson;

// 固定列别名（MeterSphere 官方模板列识别映射）
const COLUMN_ALIASES: Record<string, string[]> = {
  num: ['ID', '用例编号', 'num'],
  name: ['用例名称', '名称', 'name'],
  precondition: ['前置条件', '前置'],
  stepDesc: ['步骤描述', '步骤'],
  expect: ['预期结果', '预期'],
  level: ['用例等级', '等级', 'priority'],
  tags: ['标签', 'tags'],
  module: ['所属模块', '模块'],
};

const STATIC_HEADERS = ['ID', '所属模块', '用例名称', '前置条件', '步骤描述', '预期结果', '用例等级', '标签'];

function matchColumn(header: string): string | null {
  const h = header.trim();
  for (const [key, aliases] of Object.entries(COLUMN_ALIASES)) {
    if (aliases.some((a) => a.toLowerCase() === h.toLowerCase())) return key;
  }
  return null;
}

interface DynField { key: string; name: string; type: string }

async function dynFields(orgId: string, projectId: string): Promise<DynField[]> {
  const { fieldDefsForTemplate, effectiveTemplate } = await import('../project/template.service');
  const defs = await fieldDefsForTemplate(orgId, 'case');
  const template = await effectiveTemplate(orgId, projectId, 'case');
  const bound = new Set((template?.fields ?? []).map((f) => f.fieldKey));
  return defs.filter((d) => bound.size === 0 || bound.has(d.key));
}

function levelOf(raw: string | undefined): string | null {
  const v = (raw ?? '').trim().toUpperCase();
  if (['P0', 'P1', 'P2', 'P3'].includes(v)) return v;
  if (['0', '1', '2', '3'].includes(v)) return `P${v}`;
  if (v === '') return null;
  return 'INVALID';
}

export interface ImportRow {
  num?: number;
  modulePath?: string;
  name: string;
  precondition: string;
  steps: { desc: string; expect: string }[];
  level: string;
  tags: string[];
  fields: Record<string, unknown>;
  rowNo: number;
}

export interface ImportReport {
  mode: 'overwrite' | 'skip';
  total: number;
  created: number;
  overwritten: number;
  skipped: number;
  failed: number;
  errors: { row: number; reason: string }[];
  ignoredColumns: string[];
}

// ── Excel 导入 ──

export async function parseExcel(buffer: Buffer): Promise<{ rows: ImportRow[]; ignoredColumns: string[] }> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(asXlsx(buffer));
  const ws = wb.worksheets[0];
  if (!ws) throw new DomainError(ErrCode.VALIDATION_FAILED, 'Excel 无工作表');
  const headerRow = ws.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell({ includeEmpty: false }, (cell, col) => {
    headers[col] = String(cell.value ?? '');
  });
  const colMap = new Map<number, string>(); // col → logical key or dyn field key
  const dynByKey = new Map<string, string>(); // dyn key → header
  const ignored: string[] = [];
  for (let col = 1; col <= ws.columnCount; col++) {
    const h = headers[col] ?? '';
    if (!h.trim()) continue;
    const logical = matchColumn(h);
    if (logical) {
      colMap.set(col, logical);
    } else {
      ignored.push(h.trim());
    }
  }
  const rows: ImportRow[] = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    if (row.cellCount === 0) continue;
    const get = (logical: string): string => {
      for (const [col, key] of colMap) {
        if (key === logical) return String(row.getCell(col).value ?? '').trim();
      }
      return '';
    };
    // dyn 字段列按表头名匹配（二次扫描：未匹配的表头里找动态字段名/标识）
    const fields: Record<string, unknown> = {};
    void dynByKey;
    const name = get('name');
    const stepLines = get('stepDesc').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    const expectLines = get('expect').split(/\r?\n/).map((s) => s.trim());
    const steps = stepLines.map((desc, i) => ({ desc, expect: expectLines[i] ?? '' }));
    const numRaw = get('num');
    const level = levelOf(get('level')) ?? 'P2';
    rows.push({
      num: numRaw && /^\d+$/.test(numRaw) ? Number(numRaw) : undefined,
      modulePath: get('module') || undefined,
      name,
      precondition: get('precondition'),
      steps,
      level: level === 'INVALID' ? 'INVALID' : level,
      tags: get('tags') ? get('tags').split(/[,，;；]/).map((t) => t.trim()).filter(Boolean) : [],
      fields,
      rowNo: r,
    });
  }
  return { rows, ignoredColumns: ignored };
}

/** 动态字段值解析（列头=字段名或 key；number/date/multi/checkbox 宽松解析）。 */
function coerceDyn(field: DynField, raw: string): unknown {
  const v = raw.trim();
  if (v === '') return undefined;
  switch (field.type) {
    case 'number': return Number(v);
    case 'checkbox': return ['是', 'true', '1', 'yes'].includes(v.toLowerCase());
    case 'multi_select': return v.split(/[,，;；]/).map((s) => s.trim()).filter(Boolean);
    default: return v;
  }
}

/** 全量预检 → 原子落库（fail-fast：任一行非法即整体不导入，报告行号）。 */
export async function importCases(
  projectId: string, orgId: string, userId: string,
  opts: { buffer: Buffer; filename: string; mode: 'overwrite' | 'skip'; moduleId?: string },
): Promise<ImportReport> {
  const isXmind = /\.xmind$/i.test(opts.filename);
  const parsed = isXmind
    ? await parseXmind(opts.buffer)
    : await parseExcel(opts.buffer);
  const rows = parsed.rows;
  if (rows.length === 0) throw new DomainError(ErrCode.VALIDATION_FAILED, '未解析到任何数据行');
  if (rows.length > IMPORT_ROW_LIMIT) throw new DomainError(ErrCode.VALIDATION_FAILED, `导入上限 ${IMPORT_ROW_LIMIT} 行，请等待异步任务能力（后续迭代）`);

  const defs = await dynFields(orgId, projectId);
  const report: ImportReport = { mode: opts.mode, total: rows.length, created: 0, overwritten: 0, skipped: 0, failed: 0, errors: [], ignoredColumns: parsed.ignoredColumns };
  // Excel 动态字段列二次绑定：ignoredColumns 中匹配字段名/key 的按动态字段解析
  if (!isXmind) {
    for (const f of defs) {
      const hit = report.ignoredColumns.find((h) => h === f.name || h === f.key);
      if (hit) {
        report.ignoredColumns = report.ignoredColumns.filter((h) => h !== hit);
        // 重新扫描原始列（简化：按表头名定位列号）
        const ExcelJS = (await import('exceljs')).default;
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(asXlsx(opts.buffer));
        const ws = wb.worksheets[0]!;
        const headerRow = ws.getRow(1);
        let colIdx = -1;
        headerRow.eachCell({ includeEmpty: false }, (cell, col) => {
          if (String(cell.value ?? '').trim() === hit) colIdx = col;
        });
        if (colIdx > 0) {
          for (const row of rows) {
            const raw = String(ws.getRow(row.rowNo).getCell(colIdx).value ?? '');
            const v = coerceDyn(f, raw);
            if (v !== undefined) row.fields[f.key] = v;
          }
        }
      }
    }
  }
  // 预检
  const existing = await prisma.functionalCase.findMany({
    where: { projectId, deletedAt: null, ...(rows.some((r) => r.num) ? { num: { in: rows.map((r) => r.num).filter((n): n is number => Boolean(n)) } } : {}) },
    select: { id: true, num: true },
  });
  const byNum = new Map(existing.map((e) => [e.num, e.id]));
  for (const row of rows) {
    if (!row.name) report.errors.push({ row: row.rowNo, reason: '用例名称为空' });
    else if (row.level === 'INVALID') report.errors.push({ row: row.rowNo, reason: `非法等级：${row.level}` });
    else if (row.num !== undefined && !byNum.has(row.num) && row.num < 1) report.errors.push({ row: row.rowNo, reason: `非法编号：${row.num}` });
  }
  if (report.errors.length > 0) {
    report.failed = report.errors.length;
    return report; // 原子：不落库
  }
  // 模块路径解析（Excel：'/'分隔路径；Xmind：树路径）
  const moduleCache = new Map<string, string>();
  const resolveModule = async (path?: string): Promise<string> => {
    if (!path) return opts.moduleId ?? (await defaultModuleId(projectId));
    const cached = moduleCache.get(path);
    if (cached) return cached;
    const segs = path.split('/').map((s) => s.trim()).filter(Boolean);
    let parent: string | null = null;
    let last = '';
    for (const seg of segs) {
      const key = `${parent ?? ''}/${seg}`;
      let node: { id: string } | null = await prisma.moduleNode.findFirst({ where: { projectId, scene: 'case', name: seg, parentId: parent }, select: { id: true } });
      if (!node) {
        node = await prisma.moduleNode.create({ data: { projectId, scene: 'case', name: seg, parentId: parent } });
      }
      parent = node.id;
      last = node.id;
      moduleCache.set(key, node.id);
    }
    return last || (await defaultModuleId(projectId));
  };
  // 字段校验器
  const { buildValidator } = await import('@rabbit/shared');
  const { effectiveTemplate } = await import('../project/template.service');
  const template = await effectiveTemplate(orgId, projectId, 'case');
  const validator = buildValidator(defs as unknown as import('@rabbit/shared').FieldDefInput[], (template?.fields as import('@rabbit/shared').TemplateFieldBinding[] | undefined) ?? undefined);
  for (const row of rows) {
    const parsedFields = validator.safeParse(row.fields);
    if (!parsedFields.success) {
      report.errors.push({ row: row.rowNo, reason: `动态字段校验失败：${parsedFields.error.issues[0]?.message ?? ''}` });
    }
  }
  if (report.errors.length > 0) {
    report.failed = report.errors.length;
    return report;
  }
  // 原子落库
  await prisma.$transaction(async (tx) => {
    const { nextNum } = await import('@rabbit/db');
    for (const row of rows) {
      const moduleId = await resolveModule(row.modulePath);
      const existId = row.num !== undefined ? byNum.get(row.num) : undefined;
      if (existId && opts.mode === 'skip') {
        report.skipped += 1;
        continue;
      }
      if (existId) {
        await tx.functionalCase.update({
          where: { id: existId },
          data: {
            name: row.name, precondition: row.precondition, steps: toJson(row.steps), level: row.level,
            tags: toJson(row.tags), moduleId, fields: toJson(row.fields),
            version: { increment: 1 },
          },
        });
        await tx.changeLog.create({
          data: { entityType: 'functional_case', entityId: existId, seq: (await tx.functionalCase.findUnique({ where: { id: existId }, select: { version: true } }))!.version, action: 'import_overwrite', userId, diff: toJson({ source: 'excel' }) },
        });
        report.overwritten += 1;
      } else {
        const num = await nextNum(tx, 'functional_cases', projectId);
        const created = await tx.functionalCase.create({
          data: { projectId, moduleId, num, name: row.name, precondition: row.precondition, steps: toJson(row.steps), level: row.level, tags: toJson(row.tags), fields: toJson(row.fields), createdBy: userId },
          select: { id: true, version: true },
        });
        await tx.changeLog.create({ data: { entityType: 'functional_case', entityId: created.id, seq: created.version, action: 'create', userId, diff: toJson({ source: 'import' }) } });
        report.created += 1;
      }
    }
  });
  return report;
}

async function defaultModuleId(projectId: string): Promise<string> {
  const def = await prisma.moduleNode.findFirst({ where: { projectId, scene: 'case', isDefault: true }, select: { id: true } });
  if (!def) throw new DomainError(ErrCode.MODULE_NOT_FOUND, '默认模块缺失');
  return def.id;
}

// ── Xmind（v2.x zip + content.json）──

interface XmindTopic { title?: string; notes?: { plain?: { content?: string } } | string; labels?: string[]; markers?: { markerId?: string }[]; children?: { attached?: XmindTopic[] } }

export async function parseXmind(buffer: Buffer): Promise<{ rows: ImportRow[]; ignoredColumns: string[] }> {
  const { unzipSync, strFromU8 } = await import('fflate');
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(new Uint8Array(buffer));
  } catch {
    throw new DomainError(ErrCode.VALIDATION_FAILED, '无法解析 Xmind 文件（zip 结构损坏）');
  }
  const contentKey = Object.keys(files).find((k) => k === 'content.json');
  if (!contentKey) throw new DomainError(ErrCode.VALIDATION_FAILED, '仅支持 Xmind v2.x（content.json）；旧版 XML 格式请先升级导出');
  let sheets: { rootTopic?: XmindTopic }[];
  try {
    sheets = JSON.parse(strFromU8(files[contentKey]!)) as { rootTopic?: XmindTopic }[];
  } catch {
    throw new DomainError(ErrCode.VALIDATION_FAILED, 'content.json 解析失败');
  }
  const rows: ImportRow[] = [];
  let rowNo = 1;
  const noteOf = (t: XmindTopic): string => {
    const n = t.notes;
    if (!n) return '';
    if (typeof n === 'string') return n;
    return n.plain?.content ?? '';
  };
  const walkModule = (topic: XmindTopic, path: string) => {
    const children = topic.children?.attached ?? [];
    for (const child of children) {
      const title = (child.title ?? '').trim();
      const grand = child.children?.attached ?? [];
      if (grand.length > 0) {
        // 有子节点 → 模块分支
        walkModule(child, path ? `${path}/${title}` : title);
      } else if (title) {
        // 叶子 → 用例（备注=预期，标签=前置优先：标签→tags；备注=预期）
        const marker = child.markers?.find((m) => m.markerId?.startsWith('priority-'))?.markerId;
        const pri = marker ? Number(marker.replace('priority-', '')) : NaN;
        rows.push({
          rowNo: rowNo++,
          modulePath: path || undefined,
          name: title,
          precondition: '',
          steps: [{ desc: title, expect: noteOf(child) }],
          level: Number.isFinite(pri) && pri >= 1 && pri <= 4 ? `P${pri - 1}` : 'P2',
          tags: (child.labels ?? []).map(String),
          fields: {},
        });
      }
    }
  };
  for (const sheet of sheets) {
    const root = sheet.rootTopic;
    if (root) walkModule(root, ''); // 根主题=项目名，忽略
  }
  return { rows, ignoredColumns: [] };
}

// ── 模板下载 ──

export async function buildTemplate(projectId: string, orgId: string): Promise<{ buffer: Buffer; filename: string; contentType: string }> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('用例');
  const defs = await dynFields(orgId, projectId);
  const headers = [...STATIC_HEADERS, ...defs.map((d) => d.name)];
  ws.addRow(headers);
  ws.addRow([
    '（留空=新增；填已有编号可覆盖）', '模块A/子模块B', '登录成功场景', '账号已注册',
    '输入邮箱密码\n点击登录', '跳转到工作台', 'P0', '冒烟,登录',
    ...defs.map((d) => (d.type === 'single_select' || d.type === 'radio' ? (d as unknown as { options?: { options?: string[] } }).options?.options?.join('/') ?? '' : '')),
  ]);
  const project = await prisma.project.findFirst({ where: { id: projectId }, select: { name: true } });
  const buf = await wb.xlsx.writeBuffer();
  return { buffer: Buffer.from(buf as ArrayBuffer), contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", filename: `${project?.name ?? '项目'}-用例导入模板.xlsx` };
}

// ── 导出 ──

export async function exportCases(
  projectId: string, orgId: string,
  opts: { format: 'excel' | 'excel_split' | 'xmind'; fields: string[]; caseIds?: string[] },
): Promise<{ buffer: Buffer; filename: string; contentType: string }> {
  const { listCasesV2 } = await import('./caseV2.service');
  const cases = await listCasesV2(projectId, { page: 1, pageSize: 100, orderBy: 'num', order: 'asc', recycled: false, includeChildren: false, createdByMe: false }, 'system');
  // 全量导出（当前实现取全量分页拼接；CASE-002 列表筛选导出由前端透传 query）
  const all = [...cases.items];
  for (let p = 2; (p - 1) * 100 < cases.total; p++) {
    const next = await listCasesV2(projectId, { page: p, pageSize: 100, orderBy: 'num', order: 'asc', recycled: false, includeChildren: false, createdByMe: false }, 'system');
    all.push(...next.items);
  }
  const selected = opts.caseIds?.length ? all.filter((c) => opts.caseIds!.includes(c.id)) : all;
  const project = await prisma.project.findFirst({ where: { id: projectId }, select: { name: true } });
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
  const want = (f: string) => opts.fields.length === 0 || opts.fields.includes(f);
  const defs = await dynFields(orgId, projectId);
  const modules = await prisma.moduleNode.findMany({ where: { projectId, scene: 'case' }, select: { id: true, name: true, parentId: true } });
  const nameOf = new Map(modules.map((m) => [m.id, m.name]));
  const parentOf = new Map(modules.map((m) => [m.id, m.parentId]));
  const pathOf = (id: string): string => {
    const segs: string[] = [];
    let cur: string | null = id;
    while (cur) {
      segs.unshift(nameOf.get(cur) ?? '');
      cur = parentOf.get(cur) ?? null;
    }
    return segs.join('/');
  };
  if (opts.format === 'xmind') {
    const { zipSync, strToU8 } = await import('fflate');
    // 按模块树组装
    const byModule = new Map<string, typeof selected>();
    for (const c of selected) {
      const list = byModule.get(c.moduleId) ?? [];
      list.push(c);
      byModule.set(c.moduleId, list);
    }
    const caseTopic = (c: (typeof selected)[number]): XmindTopic => ({
      title: c.name,
      labels: want('tags') ? c.tags : undefined,
      markers: [{ markerId: `priority-${Number(c.level.replace('P', '')) + 1}` }],
      notes: c.precondition ? { plain: { content: c.precondition } } : undefined,
      children: { attached: (want('steps') ? c.steps : []).map((s) => ({
        title: s.desc,
        notes: s.expect ? { plain: { content: s.expect } } : undefined,
      })) },
    });
    const moduleTopic = (moduleId: string): XmindTopic => {
      const node = modules.find((m) => m.id === moduleId);
      const children = modules.filter((m) => m.parentId === moduleId).map((m) => moduleTopic(m.id));
      const leafCases = (byModule.get(moduleId) ?? []).map(caseTopic);
      return { title: node?.name ?? '', children: { attached: [...children, ...leafCases] } };
    };
    const roots = modules.filter((m) => !m.parentId).map((m) => moduleTopic(m.id));
    const content = [{ id: 'sheet1', class: 'sheet', title: '画布', rootTopic: { id: 'root', title: project?.name ?? '用例', children: { attached: roots } } }];
    const zip = zipSync({ 'content.json': strToU8(JSON.stringify(content)), 'metadata.json': strToU8(JSON.stringify({ creator: { name: 'RabbitAITest', version: '1.0' } })) });
    return { buffer: Buffer.from(zip), filename: `${project?.name ?? '项目'}-用例-${stamp}.xmind`, contentType: 'application/octet-stream' };
  }
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('用例');
  const dynSel = defs.filter((d) => want(d.key));
  const headers: string[] = [];
  if (want('num')) headers.push('ID');
  if (want('module')) headers.push('所属模块');
  if (want('name')) headers.push('用例名称');
  if (want('precondition')) headers.push('前置条件');
  if (want('level')) headers.push('用例等级');
  if (want('tags')) headers.push('标签');
  headers.push(...dynSel.map((d) => d.name));
  if (want('steps')) {
    if (opts.format === 'excel_split') {
      headers.push('步骤序号', '步骤描述', '预期结果');
    } else {
      headers.push('步骤描述', '预期结果');
    }
  }
  ws.addRow(headers);
  for (const c of selected) {
    const base = [
      ...(want('num') ? [c.num] : []),
      ...(want('module') ? [pathOf(c.moduleId)] : []),
      ...(want('name') ? [c.name] : []),
      ...(want('precondition') ? [c.precondition] : []),
      ...(want('level') ? [c.level] : []),
      ...(want('tags') ? [c.tags.join(',')] : []),
      ...dynSel.map((d) => {
        const v = (c.fields as Record<string, unknown>)[d.key];
        return Array.isArray(v) ? v.join(',') : v === undefined || v === null ? '' : String(v);
      }),
    ];
    if (want('steps')) {
      if (opts.format === 'excel_split') {
        if (c.steps.length === 0) ws.addRow([...base, 1, '', '']);
        c.steps.forEach((s, i) => ws.addRow([...base, i + 1, s.desc, s.expect]));
      } else {
        ws.addRow([...base, c.steps.map((s) => s.desc).join('\n'), c.steps.map((s) => s.expect).join('\n')]);
      }
    } else {
      ws.addRow(base);
    }
  }
  const buf = await wb.xlsx.writeBuffer();
  return { buffer: Buffer.from(buf), filename: `${project?.name ?? '项目'}-用例-${stamp}.xlsx`, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
}

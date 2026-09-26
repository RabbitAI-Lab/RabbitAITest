#!/usr/bin/env node
/**
 * OpenAPI 快照生成（INFRA-001 勘误 1：api-client 手工类型化 → 生成管线）。
 * 单一事实来源 = apps/web/src/app/api/v1 下全部 route.ts（路径/方法/权限点）。
 * 产物：packages/api-client/src/generated/openapi.json（提交入库；CI --check 校验 diff）。
 * 附加审计：packages/api-client/src/s1.ts 中手写路径必须存在于注册表（门禁 4 反漂移）。
 * 用法：node scripts/gen-openapi.mjs [--check]
 */
import { readdirSync, readFileSync, writeFileSync, existsSync, statSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API_ROOT = path.join(ROOT, 'apps/web/src/app/api/v1');
const SNAPSHOT = path.join(ROOT, 'packages/api-client/src/generated/openapi.json');
const CHECK = process.argv.includes('--check');

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const abs = path.join(dir, name);
    if (statSync(abs).isDirectory()) out.push(...walk(abs));
    else if (name === 'route.ts') out.push(abs);
  }
  return out;
}

function toOpenApiPath(rel) {
  const segments = rel.split(path.sep).slice(0, -1); // 去 route.ts
  return '/api/v1/' + segments.map((s) => (s.startsWith('[') && s.endsWith(']') ? `{${s.slice(1, -1)}}` : s)).join('/');
}

const TAG_NAMES = {
  auth: '认证', personal: '个人中心', system: '系统设置', orgs: '组织', projects: '项目',
  stream: '实时通道', internal: '内部（引擎）', share: '免登录分享',
};

function tagOf(openApiPath) {
  const seg = openApiPath.replace('/api/v1/', '').split('/');
  if (seg[0] === 'orgs') return '组织';
  if (seg[0] === 'projects' && seg.length > 2) return `项目·${seg[2]}`;
  return TAG_NAMES[seg[0]] ?? seg[0];
}

const METHOD_ORDER = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];
const paths = {};
const tags = new Set();

for (const file of walk(API_ROOT)) {
  const rel = path.relative(API_ROOT, file);
  const openApiPath = toOpenApiPath(rel);
  const src = readFileSync(file, 'utf8');
  const entry = {};
  for (const method of METHOD_ORDER) {
    if (!new RegExp(`export const ${method} ?=`).test(src)) continue;
    const permMatch = src.match(new RegExp(`(?:withSystemPerm\\('|requirePerm\\(')([A-Z_]+:[A-Z_]+)`));
    entry[method.toLowerCase()] = {
      summary: `${method} ${openApiPath}`,
      tags: [tagOf(openApiPath)],
      ...(permMatch ? { 'x-permission': permMatch[1] } : {}),
      security: [{ cookieAuth: [] }],
      responses: {
        200: {
          description: '统一信封 {code:0, message, data}',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Envelope' } } },
        },
      },
    };
  }
  if (Object.keys(entry).length === 0) continue;
  paths[openApiPath] = entry;
  tags.add(tagOf(openApiPath));
}

const doc = {
  openapi: '3.1.0',
  info: {
    title: 'RabbitAITest API',
    version: '0.2.0',
    description: '由 scripts/gen-openapi.mjs 从 Route Handlers 生成（路径/方法/权限点单一来源）；请求/响应契约见 packages/shared zod schema。',
  },
  servers: [{ url: '/', description: '当前部署' }],
  tags: [...tags].sort().map((t) => ({ name: t })),
  paths,
  components: {
    securitySchemes: { cookieAuth: { type: 'apiKey', in: 'cookie', name: 'ras' } },
    schemas: {
      Envelope: {
        type: 'object',
        required: ['code', 'message', 'data'],
        properties: {
          code: { type: 'integer', description: '0=成功；错误码分段见 api-conventions §3' },
          message: { type: 'string' },
          data: { description: '业务数据；列表为 {total, items}' },
        },
      },
    },
  },
};

const json = JSON.stringify(doc, null, 2) + '\n';

// ── 手写路径审计（门禁 4）：s1.ts 的路径必须都在注册表 ──
const s1 = readFileSync(path.join(ROOT, 'packages/api-client/src/s1.ts'), 'utf8');
const handPaths = new Set();
for (const m of s1.matchAll(/'(\/api\/v1\/[^']*)'/g)) handPaths.add(m[1]);
for (const m of s1.matchAll(/`(\/api\/v1\/[^`]*)`/g)) handPaths.add(m[1]);
// 归一化：简单插值 ${id} → {param}；复杂表达式（qs()/三元拼接）视作查询后缀整段剔除
function normalizeTemplate(t) {
  return t
    .replace(/\${[A-Za-z_$][A-Za-z0-9_$]*}/g, '{param}')
    .replace(/\${[\s\S]*$/, '')
    .split('?')[0]
    .replace(/\/$/, '');
}
const registrySkel = new Set(Object.keys(paths).map((p) => p.replace(/\{[^}]+\}/g, '')));
const skelOf = (p) => p.replace(/\{param\}/g, '');
const offenders = [...handPaths]
  .map(normalizeTemplate)
  .filter((p) => p.startsWith('/api/v1/') && p !== '/api/v1/')
  .filter((p) => {
    const sk = skelOf(p);
    // 通过条件：任一注册表骨架与手写骨架互为前缀（含 batch- 动作尾段）
    for (const r of registrySkel) {
      if (r === sk || r.startsWith(sk) || sk.startsWith(r + '-') || sk.startsWith(r + '/')) return false;
    }
    return true;
  });

if (offenders.length > 0) {
  console.error('[gen-openapi] api-client 手写路径不在路由注册表（可能漂移）：');
  for (const o of offenders) console.error('  -', o);
  process.exit(1);
}

if (CHECK) {
  if (!existsSync(SNAPSHOT)) {
    console.error('[gen-openapi] 快照缺失，请运行 node scripts/gen-openapi.mjs 生成并提交');
    process.exit(1);
  }
  const current = readFileSync(SNAPSHOT, 'utf8');
  if (current !== json) {
    console.error('[gen-openapi] 快照过期：路由与 openapi.json 不一致。请运行 node scripts/gen-openapi.mjs 并提交。');
    process.exit(1);
  }
  console.log(`[gen-openapi] check ok：${Object.keys(paths).length} paths 快照一致；s1.ts 手写路径 ${handPaths.size} 条全部在册`);
} else {
  mkdirSync(path.dirname(SNAPSHOT), { recursive: true });
  writeFileSync(SNAPSHOT, json);
  console.log(`[gen-openapi] 生成 ${Object.keys(paths).length} paths → ${path.relative(ROOT, SNAPSHOT)}；s1.ts 手写路径 ${handPaths.size} 条审计通过`);
}


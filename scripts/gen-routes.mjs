#!/usr/bin/env node
/**
 * 一次性路由生成器（Sprint 1）：从声明式表生成 Next.js Route Handler 样板。
 * 生成物提交入库；本脚本保留为 API 面清单的可读来源（重跑需 --force 才覆盖已有文件）。
 * 用法：node scripts/gen-routes.mjs [--force]
 */
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FORCE = process.argv.includes('--force');

/**
 * h(guard, opts)：
 *  guard: 'system'|'project'|'org'|'auth'
 *  perm: 权限点（system/org/project 用）
 *  svc: 服务模块（相对 @/server/domains）；fn: 函数名
 *  argExprs: 传参表达式数组（如 ["ctx.projectId","ctx.userId","caseId","body"]）
 *  params: 路径段参数名数组；body/query: zod schema 名（含 import）
 *  writable: 项目守卫是否追加 requireWritable()
 *  status: 成功响应码（默认 200）
 */
function h(guard, opts) {
  return { guard, ...opts };
}

/** GET 类需要原始 req（读 query）时的条件包装代码生成 */
function wrapOpen(guard, perm, body) {
  if (guard === 'system') return `withSystemPerm('${perm}')(async (_ctx, req) => {
  try {
${body}  } catch (err) { return toResponse(err); }
})`;
  const w = guard === 'org' ? 'withOrgScope' : 'withProjectScope';
  return `${w}(async (ctx, req) => {
  try {
    ctx.requirePerm('${perm}');
${body}  } catch (err) { return toResponse(err); }
})`;
}

function methodDef(method, spec) {
  const {
    guard, perm, svc, fn, argExprs = [], params = [], body, query, writable, status,
    extraImports = [], custom,
  } = spec;
  if (custom) return custom;
  const imports = [
    "import { toResponse, okResponse } from '@/server/guard';",
    "import * as svc from '@/server/domains/" + svc + "';",
  ];
  if (guard === 'system') imports.unshift("import { withSystemPerm } from '@/server/guard';");
  if (guard === 'project') imports.unshift("import { withProjectScope } from '@/server/guard';");
  if (guard === 'org') imports.unshift("import { withOrgScope } from '@/server/guard';");
  if (guard === 'auth') imports.unshift("import { withAuth } from '@/server/guard';");
  const schemas = [body, query].filter(Boolean);
  if (schemas.length) imports.splice(2, 0, `import { ${schemas.join(', ')} } from '@rabbit/shared';`);
  imports.push(...extraImports);

  const wrap = guard === 'system' ? `withSystemPerm('${perm}')`
    : guard === 'project' ? 'withProjectScope'
      : guard === 'org' ? 'withOrgScope' : 'withAuth';
  const permLine = guard === 'project' || guard === 'org' ? `    ctx.requirePerm('${perm}');\n` : '';
  const writableLine = writable && guard === 'project' ? '    ctx.requireWritable();\n' : '';
  const paramDestruct = params.length
    ? `    const { ${params.join(', ')} } = await (seg as { params: Promise<{ ${params.map((pp) => pp + ': string').join('; ')} }> }).params;\n`
    : '';
  const queryParse = query
    ? `    const q = ${query}.parse(Object.fromEntries(new URL(req.url).searchParams));\n`
    : '';
  const bodyParse = body ? `    const body = ${body}.parse(await req.json());\n` : '';
  const args = argExprs.join(', ');
  const hasReq = Boolean(query) || Boolean(body);
  const reqParam = hasReq || params.length ? 'req, ' : '_req, ';
  const segParam = params.length ? 'seg' : '_seg';
  return `${imports.join('\n')}

export const ${method} = ${wrap}(async (ctx, ${reqParam}${segParam}) => {
  try {
${permLine}${writableLine}${paramDestruct}${queryParse}${bodyParse}    return okResponse(await svc.${fn}(${args})${status ? `, ${status}` : ''});
  } catch (err) { return toResponse(err); }
});
`;
}

const files = new Map();

function route(relPath, methods) {
  const parts = Object.entries(methods).map(([m, spec]) => methodDef(m, spec));
  // 合并去重各方法的 import：命名导入按模块聚合 specifier，其余按行去重
  const namedByModule = new Map();
  const otherImports = new Set();
  for (const p of parts) {
    for (const line of p.split('\n')) {
      const m = line.match(/^import \{(.+)\} from '([^']+)';$/);
      if (m) {
        const specSet = namedByModule.get(m[2]) ?? new Set();
        for (const sp of m[1].split(',').map((x) => x.trim()).filter(Boolean)) specSet.add(sp);
        namedByModule.set(m[2], specSet);
      } else if (line.startsWith('import ')) {
        otherImports.add(line);
      }
    }
  }
  const importLines = [
    ...[...namedByModule.entries()].map(([mod, specs]) => `import { ${[...specs].join(', ')} } from '${mod}';`),
    ...otherImports,
  ];
  const bodies = parts.map((p) => p.split('\n').filter((l) => !l.startsWith('import ')).join('\n').trimStart());
  files.set(relPath, `${importLines.join('\n')}\n\n${bodies.join('\n')}`);
}

// ═══════════════ SYS-004 用户管理 ═══════════════
route('api/v1/system/users/route.ts', {
  GET: h('system', { perm: 'SYSTEM_USER:READ', svc: 'system/user.service', fn: 'listUsers', query: 'userListQuerySchema', argExprs: ['q'] }),
  POST: h('system', { perm: 'SYSTEM_USER:CREATE', svc: 'system/user.service', fn: 'createUser', body: 'userCreateSchema', argExprs: ['ctx.userId', 'body'], status: 201 }),
});
route('api/v1/system/users/[id]/route.ts', {
  PUT: h('system', { perm: 'SYSTEM_USER:UPDATE', svc: 'system/user.service', fn: 'updateUser', body: 'userUpdateSchema', params: ['id'], argExprs: ['ctx.userId', 'id', 'body'] }),
  DELETE: h('system', { perm: 'SYSTEM_USER:DELETE', svc: 'system/user.service', fn: 'deleteUser', params: ['id'], argExprs: ['ctx.userId', 'id'] }),
});
route('api/v1/system/users/[id]/reset-password/route.ts', {
  POST: h('system', { perm: 'SYSTEM_USER:UPDATE', svc: 'system/user.service', fn: 'resetPassword', params: ['id'], argExprs: ['ctx.userId', 'id'] }),
});
route('api/v1/system/users/[id]/status/route.ts', {
  POST: h('system', { perm: 'SYSTEM_USER:UPDATE', svc: 'system/user.service', fn: 'setUserStatus', body: 'userStatusSchema', params: ['id'], argExprs: ['ctx.userId', 'id', 'body.status'] }),
});

// ═══════════════ SYS-004 用户组（三作用域同构） ═══════════════
const groupRoutes = [
  { base: 'api/v1/system/groups', scope: 'system', guard: 'system', perm: 'SYSTEM_GROUP', ref: "{ scope: 'system' }" },
  { base: 'api/v1/orgs/[orgId]/groups', scope: 'org', guard: 'org', perm: 'ORG_GROUP', ref: "{ scope: 'org', orgId: ctx.orgId }" },
  { base: 'api/v1/projects/[projectId]/groups', scope: 'project', guard: 'project', perm: 'PROJECT_GROUP', ref: "{ scope: 'project', projectId: ctx.projectId }" },
];
for (const g of groupRoutes) {
  const R = g.perm;
  route(`${g.base}/route.ts`, {
    GET: h(g.guard, {
      perm: `${R}:READ`, svc: 'system/group.service', fn: 'listGroups', argExprs: [],
      custom: `import { toResponse, okResponse, ${g.guard === 'system' ? 'withSystemPerm' : g.guard === 'org' ? 'withOrgScope' : 'withProjectScope'} } from '@/server/guard';
import * as svc from '@/server/domains/system/group.service';

export const GET = ${wrapOpen(g.guard, R + ':READ', `    return okResponse(await svc.listGroups(${g.ref}, new URL(req.url).searchParams.get('withMembers') === '1' ? { withMembers: '1' } : undefined));\n`)};
`,
    }),
    POST: h(g.guard, { perm: `${R}:CREATE`, svc: 'system/group.service', fn: 'createGroup', body: 'groupUpsertSchema', argExprs: ['ctx.userId', g.ref, 'body'], status: 201 }),
  });
  route(`${g.base}/[id]/route.ts`, {
    PUT: h(g.guard, { perm: `${R}:UPDATE`, svc: 'system/group.service', fn: 'updateGroup', body: 'groupUpsertSchema', params: ['id'], argExprs: ['ctx.userId', 'id', 'body'] }),
    DELETE: h(g.guard, { perm: `${R}:DELETE`, svc: 'system/group.service', fn: 'deleteGroup', params: ['id'], argExprs: ['id'] }),
  });
  route(`${g.base}/[id]/members/route.ts`, {
    POST: h(g.guard, { perm: `${R}:UPDATE`, svc: 'system/group.service', fn: 'addMembers', body: 'groupMembersSchema', params: ['id'], argExprs: ['id', 'body.userIds'] }),
  });
  route(`${g.base}/[id]/members/[userId]/route.ts`, {
    DELETE: h(g.guard, { perm: `${R}:UPDATE`, svc: 'system/group.service', fn: 'removeMember', params: ['id', 'userId'], argExprs: ['id', 'userId'] }),
  });
  route(`${g.base}/[id]/restore-default/route.ts`, {
    POST: h(g.guard, { perm: `${R}:UPDATE`, svc: 'system/group.service', fn: 'restoreGroupDefault', params: ['id'], argExprs: ['id'] }),
  });
}

// ═══════════════ SYS-005 系统参数 ═══════════════
route('api/v1/system/params/route.ts', {
  GET: h('system', { perm: 'SYSTEM_PARAM:READ', svc: 'system/param.service', fn: 'getParams', argExprs: [] }),
});
route('api/v1/system/params/[group]/route.ts', {
  PUT: h('system', {
    perm: 'SYSTEM_PARAM:UPDATE', svc: 'system/param.service', fn: 'updateParam', params: ['group'],
    argExprs: ["(group === 'basic' ? 'basic' : group) as 'basic'|'smtp'|'file'|'cleanup'", 'body'],
    custom: `import { toResponse, okResponse, withSystemPerm } from '@/server/guard';
import { paramGroupSchema } from '@rabbit/shared';
import * as svc from '@/server/domains/system/param.service';

export const PUT = withSystemPerm('SYSTEM_PARAM:UPDATE')(async (_ctx, req, seg) => {
  try {
    const { group } = await (seg as { params: Promise<{ group: string }> }).params;
    const parsed = paramGroupSchema.parse(await req.json());
    if (parsed.group !== group) {
      return okResponse({ ok: false, message: '参数组不匹配' }, 422);
    }
    await svc.updateParam(parsed.group, parsed.value);
    return okResponse({ ok: true });
  } catch (err) { return toResponse(err); }
});
`,
  }),
});
route('api/v1/system/params/smtp/test/route.ts', {
  POST: h('system', { perm: 'SYSTEM_PARAM:UPDATE', svc: 'system/param.service', fn: 'testSmtp', body: 'smtpParamSchema', argExprs: ['body'] }),
});

// ═══════════════ PROJ-001 组织成员（成员搜索添加数据源） ═══════════════
route('api/v1/orgs/[orgId]/members/route.ts', {
  GET: h('org', {
    perm: 'ORG_MEMBER:READ', svc: 'project/project.service', fn: 'listOrgMembers', query: 'orgMemberQuerySchema',
    argExprs: ['ctx.orgId', 'q'],
  }),
});

// ═══════════════ PROJ-001 组织项目 / 项目生命周期 / 成员 ═══════════════
route('api/v1/orgs/[orgId]/projects/route.ts', {
  GET: h('org', {
    perm: 'ORG_PROJECT:READ', svc: 'project/project.service', fn: 'listOrgProjects', argExprs: [],
    custom: `import { toResponse, okResponse, withOrgScope } from '@/server/guard';
import * as svc from '@/server/domains/project/project.service';

export const GET = withOrgScope(async (ctx, req) => {
  try {
    ctx.requirePerm('ORG_PROJECT:READ');
    const url = new URL(req.url);
    return okResponse(await svc.listOrgProjects(ctx.orgId, { deleted: url.searchParams.get('deleted') ?? undefined, keyword: url.searchParams.get('keyword') ?? undefined }));
  } catch (err) { return toResponse(err); }
});
`,
  }),
  POST: h('org', { perm: 'ORG_PROJECT:CREATE', svc: 'project/project.service', fn: 'createOrgProject', body: 'projectUpsertSchema', argExprs: ['ctx.orgId', 'ctx.userId', 'body'], status: 201 }),
});
route('api/v1/projects/[projectId]/info/route.ts', {
  GET: h('project', { perm: 'PROJECT_MEMBER:READ', svc: 'project/project.service', fn: 'getProjectInfo', argExprs: ['ctx.projectId'] }),
});
route('api/v1/projects/[projectId]/route.ts', {
  PUT: h('project', { perm: 'ORG_PROJECT:UPDATE', writable: true, svc: 'project/project.service', fn: 'updateProject', body: 'projectUpdateSchema', argExprs: ['ctx.projectId', 'ctx.userId', 'body'] }),
  DELETE: h('project', { perm: 'ORG_PROJECT:DELETE', svc: 'project/project.service', fn: 'softDeleteProject', argExprs: ['ctx.projectId', 'ctx.userId'] }),
});
route('api/v1/projects/[projectId]/close/route.ts', {
  POST: h('project', { perm: 'ORG_PROJECT:UPDATE', svc: 'project/project.service', fn: 'setProjectEnded', argExprs: ['ctx.projectId', 'ctx.userId', 'true'] }),
});
route('api/v1/projects/[projectId]/reopen/route.ts', {
  POST: h('project', { perm: 'ORG_PROJECT:UPDATE', svc: 'project/project.service', fn: 'setProjectEnded', argExprs: ['ctx.projectId', 'ctx.userId', 'false'] }),
});
route('api/v1/projects/[projectId]/restore/route.ts', {
  POST: h('project', { perm: 'ORG_PROJECT:DELETE', svc: 'project/project.service', fn: 'restoreProject', argExprs: ['ctx.projectId', 'ctx.userId'] }),
});
route('api/v1/projects/[projectId]/members/route.ts', {
  GET: h('project', { perm: 'PROJECT_MEMBER:READ', svc: 'project/project.service', fn: 'listProjectMembers', query: 'orgMemberQuerySchema', argExprs: ['ctx.projectId', 'q'] }),
  POST: h('project', { perm: 'PROJECT_MEMBER:UPDATE', writable: true, svc: 'project/project.service', fn: 'addProjectMembers', body: 'projectMembersAddSchema', argExprs: ['ctx.projectId', 'ctx.userId', 'body.userIds'], status: 201 }),
});
route('api/v1/projects/[projectId]/members/[userId]/route.ts', {
  DELETE: h('project', { perm: 'PROJECT_MEMBER:UPDATE', writable: true, svc: 'project/project.service', fn: 'removeProjectMember', params: ['userId'], argExprs: ['ctx.projectId', 'ctx.userId', 'userId'] }),
});

// ═══════════════ PROJ-002 字段定义 / 模板 / 工作流 ═══════════════
route('api/v1/orgs/[orgId]/field-defs/route.ts', {
  GET: h('org', {
    perm: 'ORG_TEMPLATE:READ', svc: 'project/template.service', fn: 'listFieldDefs', argExprs: [],
    custom: `import { toResponse, okResponse, withOrgScope } from '@/server/guard';
import * as svc from '@/server/domains/project/template.service';

export const GET = withOrgScope(async (ctx, req) => {
  try {
    ctx.requirePerm('ORG_TEMPLATE:READ');
    return okResponse(await svc.listFieldDefs(ctx.orgId, new URL(req.url).searchParams.get('scene') ?? undefined));
  } catch (err) { return toResponse(err); }
});
`,
  }),
  POST: h('org', { perm: 'ORG_TEMPLATE:UPDATE', svc: 'project/template.service', fn: 'createFieldDef', body: 'fieldDefUpsertSchema', argExprs: ['ctx.orgId', 'body'], status: 201 }),
});
route('api/v1/orgs/[orgId]/field-defs/[id]/route.ts', {
  PUT: h('org', { perm: 'ORG_TEMPLATE:UPDATE', svc: 'project/template.service', fn: 'updateFieldDef', body: 'fieldDefUpsertSchema', params: ['id'], argExprs: ['ctx.orgId', 'id', 'body'] }),
  DELETE: h('org', { perm: 'ORG_TEMPLATE:UPDATE', svc: 'project/template.service', fn: 'deleteFieldDef', params: ['id'], argExprs: ['ctx.orgId', 'id'] }),
});
route('api/v1/orgs/[orgId]/templates/route.ts', {
  GET: h('org', {
    perm: 'ORG_TEMPLATE:READ', svc: 'project/template.service', fn: 'listTemplates', argExprs: [],
    custom: `import { toResponse, okResponse, withOrgScope } from '@/server/guard';
import * as svc from '@/server/domains/project/template.service';

export const GET = withOrgScope(async (ctx, req) => {
  try {
    ctx.requirePerm('ORG_TEMPLATE:READ');
    return okResponse(await svc.listTemplates(ctx.orgId, null, new URL(req.url).searchParams.get('scene') ?? undefined));
  } catch (err) { return toResponse(err); }
});
`,
  }),
  POST: h('org', { perm: 'ORG_TEMPLATE:UPDATE', svc: 'project/template.service', fn: 'createTemplate', body: 'templateUpsertSchema', argExprs: ['ctx.orgId', 'null', 'ctx.userId', 'body'], status: 201 }),
});
route('api/v1/orgs/[orgId]/templates/[id]/route.ts', {
  PUT: h('org', { perm: 'ORG_TEMPLATE:UPDATE', svc: 'project/template.service', fn: 'updateTemplate', body: 'templateUpsertSchema', params: ['id'], argExprs: ['ctx.orgId', 'id', 'body'] }),
  DELETE: h('org', { perm: 'ORG_TEMPLATE:UPDATE', svc: 'project/template.service', fn: 'deleteTemplate', params: ['id'], argExprs: ['ctx.orgId', 'null', 'id'] }),
});
route('api/v1/orgs/[orgId]/templates/[id]/fields/route.ts', {
  PUT: h('org', {
    perm: 'ORG_TEMPLATE:UPDATE', svc: 'project/template.service', fn: 'updateTemplateFields', params: ['id'],
    argExprs: ['ctx.orgId', 'id', 'body.fields'], custom: `import { toResponse, okResponse, withOrgScope } from '@/server/guard';
import { templateUpsertSchema } from '@rabbit/shared';
import * as svc from '@/server/domains/project/template.service';

export const PUT = withOrgScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm('ORG_TEMPLATE:UPDATE');
    const { id } = await (seg as { params: Promise<{ id: string }> }).params;
    const body = templateUpsertSchema.parse(await req.json());
    return okResponse(await svc.updateTemplateFields(ctx.orgId, id, body.fields));
  } catch (err) { return toResponse(err); }
});
`,
  }),
});
route('api/v1/orgs/[orgId]/templates/[id]/default/route.ts', {
  POST: h('org', { perm: 'ORG_TEMPLATE:UPDATE', svc: 'project/template.service', fn: 'setDefaultTemplate', params: ['id'], argExprs: ['ctx.orgId', 'null', 'id'] }),
});
route('api/v1/orgs/[orgId]/templates/[id]/copy/route.ts', {
  POST: h('org', { perm: 'ORG_TEMPLATE:UPDATE', svc: 'project/template.service', fn: 'copyTemplate', params: ['id'], argExprs: ['ctx.orgId', 'null', 'id'], status: 201 }),
});
route('api/v1/projects/[projectId]/templates/route.ts', {
  GET: h('project', {
    perm: 'PROJECT_TEMPLATE:READ', svc: 'project/template.service', fn: 'listTemplates', argExprs: [],
    custom: `import { toResponse, okResponse, withProjectScope } from '@/server/guard';
import * as svc from '@/server/domains/project/template.service';

export const GET = withProjectScope(async (ctx, req) => {
  try {
    ctx.requirePerm('PROJECT_TEMPLATE:READ');
    return okResponse(await svc.listTemplates(ctx.orgId, ctx.projectId, new URL(req.url).searchParams.get('scene') ?? undefined));
  } catch (err) { return toResponse(err); }
});
`,
  }),
  POST: h('project', { perm: 'PROJECT_TEMPLATE:UPDATE', writable: true, svc: 'project/template.service', fn: 'createTemplate', body: 'templateUpsertSchema', argExprs: ['ctx.orgId', 'ctx.projectId', 'ctx.userId', 'body'], status: 201 }),
});
route('api/v1/projects/[projectId]/templates/[id]/route.ts', {
  PUT: h('project', { perm: 'PROJECT_TEMPLATE:UPDATE', writable: true, svc: 'project/template.service', fn: 'updateTemplate', body: 'templateUpsertSchema', params: ['id'], argExprs: ['ctx.orgId', 'id', 'body'] }),
  DELETE: h('project', { perm: 'PROJECT_TEMPLATE:UPDATE', writable: true, svc: 'project/template.service', fn: 'deleteTemplate', params: ['id'], argExprs: ['ctx.orgId', 'ctx.projectId', 'id'] }),
});
route('api/v1/projects/[projectId]/templates/[id]/fields/route.ts', {
  PUT: h('project', {
    perm: 'PROJECT_TEMPLATE:UPDATE', writable: true, svc: 'project/template.service', fn: 'updateTemplateFields', params: ['id'],
    argExprs: ['ctx.orgId', 'id', 'body.fields'], custom: `import { toResponse, okResponse, withProjectScope } from '@/server/guard';
import { templateUpsertSchema } from '@rabbit/shared';
import * as svc from '@/server/domains/project/template.service';

export const PUT = withProjectScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm('PROJECT_TEMPLATE:UPDATE');
    ctx.requireWritable();
    const { id } = await (seg as { params: Promise<{ id: string }> }).params;
    const body = templateUpsertSchema.parse(await req.json());
    return okResponse(await svc.updateTemplateFields(ctx.orgId, id, body.fields));
  } catch (err) { return toResponse(err); }
});
`,
  }),
});
route('api/v1/projects/[projectId]/templates/[id]/default/route.ts', {
  POST: h('project', { perm: 'PROJECT_TEMPLATE:UPDATE', writable: true, svc: 'project/template.service', fn: 'setDefaultTemplate', params: ['id'], argExprs: ['ctx.orgId', 'ctx.projectId', 'id'] }),
});
route('api/v1/projects/[projectId]/templates/[id]/copy/route.ts', {
  POST: h('project', { perm: 'PROJECT_TEMPLATE:UPDATE', writable: true, svc: 'project/template.service', fn: 'copyTemplate', params: ['id'], argExprs: ['ctx.orgId', 'ctx.projectId', 'id'], status: 201 }),
});
route('api/v1/projects/[projectId]/template-mode/route.ts', {
  GET: h('project', { perm: 'PROJECT_TEMPLATE:READ', svc: 'project/template.service', fn: 'getTemplateMode', argExprs: ['ctx.projectId'] }),
});
route('api/v1/projects/[projectId]/template-mode/enable/route.ts', {
  POST: h('project', { perm: 'PROJECT_TEMPLATE:UPDATE', writable: true, svc: 'project/template.service', fn: 'enableProjectTemplateMode', argExprs: ['ctx.orgId', 'ctx.projectId', 'ctx.userId'] }),
});
route('api/v1/projects/[projectId]/workflows/route.ts', {
  GET: h('project', {
    perm: 'PROJECT_TEMPLATE:READ', svc: 'project/template.service', fn: 'getWorkflow', argExprs: [],
    custom: `import { toResponse, okResponse, withProjectScope } from '@/server/guard';
import * as svc from '@/server/domains/project/template.service';

export const GET = withProjectScope(async (ctx, req) => {
  try {
    ctx.requirePerm('PROJECT_TEMPLATE:READ');
    const templateId = new URL(req.url).searchParams.get('templateId') ?? undefined;
    return okResponse(await svc.getWorkflow(ctx.orgId, ctx.projectId, templateId));
  } catch (err) { return toResponse(err); }
});
`,
  }),
});
route('api/v1/projects/[projectId]/workflows/states/route.ts', {
  POST: h('project', { perm: 'PROJECT_TEMPLATE:UPDATE', writable: true, svc: 'project/template.service', fn: 'createWorkflowState', body: 'workflowStateUpsertSchema', argExprs: ['ctx.orgId', 'ctx.projectId', 'body'], status: 201 }),
});
route('api/v1/projects/[projectId]/workflows/states/[stateId]/route.ts', {
  PUT: h('project', { perm: 'PROJECT_TEMPLATE:UPDATE', writable: true, svc: 'project/template.service', fn: 'updateWorkflowState', body: 'workflowStateUpsertSchema', params: ['stateId'], argExprs: ['ctx.orgId', 'ctx.projectId', 'stateId', 'body'] }),
  DELETE: h('project', { perm: 'PROJECT_TEMPLATE:UPDATE', writable: true, svc: 'project/template.service', fn: 'deleteWorkflowState', params: ['stateId'], argExprs: ['ctx.orgId', 'ctx.projectId', 'stateId'] }),
});
route('api/v1/projects/[projectId]/workflows/transitions/route.ts', {
  PUT: h('project', { perm: 'PROJECT_TEMPLATE:UPDATE', writable: true, svc: 'project/template.service', fn: 'updateWorkflowTransitions', body: 'workflowTransitionsUpsertSchema', argExprs: ['ctx.orgId', 'ctx.projectId', 'body.transitions'] }),
});

// ═══════════════ CASE-002/003：模块/列表v2/视图/批量/关注/复制/详情关联/评论/历史 ═══════════════
route('api/v1/projects/[projectId]/modules/route.ts', {
  GET: h('project', {
    perm: 'PROJECT_CASE:READ', svc: 'case/module.service', fn: 'listModules', argExprs: [],
    custom: `import { toResponse, okResponse, withProjectScope } from '@/server/guard';
import * as svc from '@/server/domains/case/module.service';

export const GET = withProjectScope(async (ctx, req) => {
  try {
    ctx.requirePerm('PROJECT_CASE:READ');
    const scene = new URL(req.url).searchParams.get('scene') ?? 'case';
    return okResponse({ items: await svc.listModules(ctx.projectId, scene) });
  } catch (err) { return toResponse(err); }
});
`,
  }),
  POST: h('project', {
    perm: 'PROJECT_CASE:UPDATE', writable: true, svc: 'case/module.service', fn: 'createModule', body: 'moduleUpsertSchema',
    argExprs: [], status: 201,
    custom: `import { toResponse, okResponse, withProjectScope } from '@/server/guard';
import { moduleUpsertSchema } from '@rabbit/shared';
import * as svc from '@/server/domains/case/module.service';

export const POST = withProjectScope(async (ctx, req) => {
  try {
    ctx.requirePerm('PROJECT_CASE:UPDATE');
    ctx.requireWritable();
    const scene = new URL(req.url).searchParams.get('scene') ?? 'case';
    const body = moduleUpsertSchema.parse(await req.json());
    return okResponse(await svc.createModule(ctx.projectId, scene, body), 201);
  } catch (err) { return toResponse(err); }
});
`,
  }),
});
route('api/v1/projects/[projectId]/modules/[id]/route.ts', {
  PUT: h('project', {
    perm: 'PROJECT_CASE:UPDATE', writable: true, svc: 'case/module.service', fn: 'renameModule', body: 'moduleUpsertSchema', params: ['id'], argExprs: [],
    custom: `import { toResponse, okResponse, withProjectScope } from '@/server/guard';
import { moduleUpsertSchema } from '@rabbit/shared';
import * as svc from '@/server/domains/case/module.service';

export const PUT = withProjectScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm('PROJECT_CASE:UPDATE');
    ctx.requireWritable();
    const { id } = await (seg as { params: Promise<{ id: string }> }).params;
    const scene = new URL(req.url).searchParams.get('scene') ?? 'case';
    const body = moduleUpsertSchema.parse(await req.json());
    return okResponse(await svc.renameModule(ctx.projectId, scene, id, body.name));
  } catch (err) { return toResponse(err); }
});
`,
  }),
  DELETE: h('project', {
    perm: 'PROJECT_CASE:UPDATE', writable: true, svc: 'case/module.service', fn: 'deleteModule', params: ['id'], argExprs: [],
    custom: `import { toResponse, okResponse, withProjectScope } from '@/server/guard';
import * as svc from '@/server/domains/case/module.service';

export const DELETE = withProjectScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm('PROJECT_CASE:UPDATE');
    ctx.requireWritable();
    const { id } = await (seg as { params: Promise<{ id: string }> }).params;
    const scene = new URL(req.url).searchParams.get('scene') ?? 'case';
    return okResponse(await svc.deleteModule(ctx.projectId, scene, id));
  } catch (err) { return toResponse(err); }
});
`,
  }),
});
route('api/v1/projects/[projectId]/modules/[id]/move/route.ts', {
  POST: h('project', {
    perm: 'PROJECT_CASE:UPDATE', writable: true, svc: 'case/module.service', fn: 'moveModule', body: 'moduleMoveSchema', params: ['id'], argExprs: [],
    custom: `import { toResponse, okResponse, withProjectScope } from '@/server/guard';
import { moduleMoveSchema } from '@rabbit/shared';
import * as svc from '@/server/domains/case/module.service';

export const POST = withProjectScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm('PROJECT_CASE:UPDATE');
    ctx.requireWritable();
    const { id } = await (seg as { params: Promise<{ id: string }> }).params;
    const scene = new URL(req.url).searchParams.get('scene') ?? 'case';
    const body = moduleMoveSchema.parse(await req.json());
    return okResponse(await svc.moveModule(ctx.projectId, scene, id, body.parentId, body.order));
  } catch (err) { return toResponse(err); }
});
`,
  }),
});

// ── 用例列表 v2 / CRUD v2（覆盖 CASE-001 旧路由）──
route('api/v1/projects/[projectId]/cases/route.ts', {
  GET: h('project', {
    perm: 'PROJECT_CASE:READ', svc: 'case/caseV2.service', fn: 'listCasesV2', query: 'caseListQueryV2Schema', argExprs: ['ctx.projectId', 'q', 'ctx.userId'],
  }),
  POST: h('project', {
    perm: 'PROJECT_CASE:CREATE', writable: true, svc: 'case/caseV2.service', fn: 'createCaseV2', body: 'caseCreateV2Schema', argExprs: ['ctx.projectId', 'ctx.orgId', 'ctx.userId', 'body'], status: 201,
  }),
});
route('api/v1/projects/[projectId]/cases/[caseId]/route.ts', {
  GET: h('project', { perm: 'PROJECT_CASE:READ', svc: 'case/caseV2.service', fn: 'getCaseV2', params: ['caseId'], argExprs: ['ctx.projectId', 'caseId'] }),
  PUT: h('project', { perm: 'PROJECT_CASE:UPDATE', writable: true, svc: 'case/caseV2.service', fn: 'updateCaseV2', body: 'caseUpdateV2Schema', params: ['caseId'], argExprs: ['ctx.projectId', 'ctx.orgId', 'ctx.userId', 'caseId', 'body'] }),
  DELETE: h('project', { perm: 'PROJECT_CASE:DELETE', writable: true, svc: 'case/caseV2.service', fn: 'deleteCaseV2', params: ['caseId'], argExprs: ['ctx.projectId', 'caseId', 'ctx.userId'] }),
});
route('api/v1/projects/[projectId]/cases/[caseId]/copy/route.ts', {
  POST: h('project', { perm: 'PROJECT_CASE:CREATE', writable: true, svc: 'case/caseV2.service', fn: 'copyCase', params: ['caseId'], argExprs: ['ctx.projectId', 'ctx.userId', 'caseId'], status: 201 }),
});
route('api/v1/projects/[projectId]/cases/[caseId]/follow/route.ts', {
  POST: h('project', { perm: 'PROJECT_CASE:READ', svc: 'case/caseV2.service', fn: 'setFollow', params: ['caseId'], argExprs: ['ctx.projectId', 'ctx.userId', 'caseId', 'true'] }),
  DELETE: h('project', { perm: 'PROJECT_CASE:READ', svc: 'case/caseV2.service', fn: 'setFollow', params: ['caseId'], argExprs: ['ctx.projectId', 'ctx.userId', 'caseId', 'false'] }),
});
route('api/v1/projects/[projectId]/cases/batch-move/route.ts', {
  POST: h('project', { perm: 'PROJECT_CASE:UPDATE', writable: true, svc: 'case/caseV2.service', fn: 'batchCases', body: 'caseBatchSchema', argExprs: ['ctx.projectId', 'ctx.orgId', 'ctx.userId', "'move'", 'body'] }),
});
route('api/v1/projects/[projectId]/cases/batch-copy/route.ts', {
  POST: h('project', { perm: 'PROJECT_CASE:CREATE', writable: true, svc: 'case/caseV2.service', fn: 'batchCases', body: 'caseBatchSchema', argExprs: ['ctx.projectId', 'ctx.orgId', 'ctx.userId', "'copy'", 'body'] }),
});
route('api/v1/projects/[projectId]/cases/batch-delete/route.ts', {
  POST: h('project', { perm: 'PROJECT_CASE:DELETE', writable: true, svc: 'case/caseV2.service', fn: 'batchCases', body: 'caseBatchSchema', argExprs: ['ctx.projectId', 'ctx.orgId', 'ctx.userId', "'delete'", 'body'] }),
});
route('api/v1/projects/[projectId]/cases/batch-update/route.ts', {
  POST: h('project', { perm: 'PROJECT_CASE:UPDATE', writable: true, svc: 'case/caseV2.service', fn: 'batchCases', body: 'caseBatchSchema', argExprs: ['ctx.projectId', 'ctx.orgId', 'ctx.userId', "'update'", 'body'] }),
});

route('api/v1/projects/[projectId]/cases/import/route.ts', {
  POST: h('project', {
    perm: 'PROJECT_CASE:CREATE', writable: true, svc: 'case/caseIo.service', fn: 'importCases', argExprs: [],
    custom: `import { toResponse, okResponse, withProjectScope } from '@/server/guard';
import * as svc from '@/server/domains/case/caseIo.service';

export const POST = withProjectScope(async (ctx, req) => {
  try {
    ctx.requirePerm('PROJECT_CASE:CREATE');
    ctx.requireWritable();
    const form = await req.formData();
    const file = form.get('file');
    const mode = (String(form.get('mode') ?? 'skip') === 'overwrite' ? 'overwrite' : 'skip') as 'overwrite' | 'skip';
    const moduleId = String(form.get('moduleId') ?? '') || undefined;
    if (!(file instanceof File)) return okResponse({ ok: false, message: '缺少文件' }, 422);
    const buffer = Buffer.from(await file.arrayBuffer());
    const report = await svc.importCases(ctx.projectId, ctx.orgId, ctx.userId, {
      buffer, filename: file.name, mode, moduleId,
    });
    return okResponse(report);
  } catch (err) { return toResponse(err); }
});
`,
  }),
});
route('api/v1/projects/[projectId]/cases/import/template/route.ts', {
  GET: h('project', {
    perm: 'PROJECT_CASE:READ', svc: 'case/caseIo.service', fn: 'buildTemplate', argExprs: [],
    custom: `import { toResponse, withProjectScope } from '@/server/guard';
import * as svc from '@/server/domains/case/caseIo.service';

export const GET = withProjectScope(async (ctx) => {
  try {
    ctx.requirePerm('PROJECT_CASE:READ');
    const { buffer, filename, contentType } = await svc.buildTemplate(ctx.projectId, ctx.orgId);
    const res = new Response(new Uint8Array(buffer), {
      status: 200,
      headers: { 'Content-Type': contentType, 'Content-Disposition': "attachment; filename=" + JSON.stringify(encodeURIComponent(filename)) },
    });
    return res as unknown as import('next/server').NextResponse;
  } catch (err) { return toResponse(err); }
});
`,
  }),
});
route('api/v1/projects/[projectId]/cases/export/route.ts', {
  POST: h('project', {
    perm: 'PROJECT_CASE:READ', svc: 'case/caseIo.service', fn: 'exportCases', argExprs: [],
    custom: `import { toResponse, withProjectScope } from '@/server/guard';
import { exportOptionsSchema } from '@rabbit/shared';
import * as svc from '@/server/domains/case/caseIo.service';

export const POST = withProjectScope(async (ctx, req) => {
  try {
    ctx.requirePerm('PROJECT_CASE:READ');
    const body = exportOptionsSchema.parse(await req.json());
    const { buffer, filename, contentType } = await svc.exportCases(ctx.projectId, ctx.orgId, {
      format: body.format, fields: body.fields, caseIds: body.caseIds,
    });
    const res = new Response(new Uint8Array(buffer), {
      status: 200,
      headers: { 'Content-Type': contentType, 'Content-Disposition': "attachment; filename=" + JSON.stringify(encodeURIComponent(filename)) },
    });
    return res as unknown as import('next/server').NextResponse;
  } catch (err) { return toResponse(err); }
});
`,
  }),
});

// ── 视图与偏好 ──
route('api/v1/projects/[projectId]/views/route.ts', {
  GET: h('project', { perm: 'PROJECT_CASE:READ', svc: 'case/pref.service', fn: 'listViews', argExprs: ['ctx.userId', 'ctx.projectId'] }),
  POST: h('project', { perm: 'PROJECT_CASE:READ', svc: 'case/pref.service', fn: 'createView', body: 'viewUpsertSchema', argExprs: ['ctx.userId', 'ctx.projectId', 'body'], status: 201 }),
});
route('api/v1/projects/[projectId]/views/[id]/route.ts', {
  PUT: h('project', { perm: 'PROJECT_CASE:READ', svc: 'case/pref.service', fn: 'updateView', body: 'viewUpsertSchema', params: ['id'], argExprs: ['ctx.userId', 'ctx.projectId', 'id', 'body'] }),
  DELETE: h('project', { perm: 'PROJECT_CASE:READ', svc: 'case/pref.service', fn: 'deleteView', params: ['id'], argExprs: ['ctx.userId', 'ctx.projectId', 'id'] }),
});
route('api/v1/personal/preferences/[key]/route.ts', {
  GET: h('auth', {
    fn: '', svc: 'case/pref.service', argExprs: [],
    custom: `import { toResponse, okResponse, withAuth } from '@/server/guard';
import * as svc from '@/server/domains/case/pref.service';

export const GET = withAuth(async (_ctx, req: Request, seg: unknown) => {
  try {
    const { key } = await (seg as { params: Promise<{ key: string }> }).params;
    const projectId = new URL(req.url).searchParams.get('projectId') ?? '';
    return okResponse(await svc.getPreference(_ctx.userId, key, projectId));
  } catch (err) { return toResponse(err); }
});
`,
  }),
  PUT: h('auth', {
    fn: '', svc: 'case/pref.service', argExprs: [],
    custom: `import { toResponse, okResponse, withAuth } from '@/server/guard';
import * as svc from '@/server/domains/case/pref.service';

export const PUT = withAuth(async (ctx, req: Request, seg: unknown) => {
  try {
    const { key } = await (seg as { params: Promise<{ key: string }> }).params;
    const projectId = new URL(req.url).searchParams.get('projectId') ?? '';
    const body = (await req.json()) as { value: unknown };
    return okResponse(await svc.putPreference(ctx.userId, key, projectId, body.value));
  } catch (err) { return toResponse(err); }
});
`,
  }),
});

// ── CASE-003：依赖/聚合/评论/变更历史 ──
route('api/v1/projects/[projectId]/cases/[caseId]/dependencies/route.ts', {
  GET: h('project', { perm: 'PROJECT_CASE:READ', svc: 'case/caseDetail.service', fn: 'listDependencies', params: ['caseId'], argExprs: ['ctx.projectId', 'caseId'] }),
  POST: h('project', {
    perm: 'PROJECT_CASE:UPDATE', writable: true, svc: 'case/caseDetail.service', fn: 'addDependency', body: 'dependencyUpsertSchema', params: ['caseId'], argExprs: [],
    custom: `import { toResponse, okResponse, withProjectScope } from '@/server/guard';
import { dependencyUpsertSchema } from '@rabbit/shared';
import * as svc from '@/server/domains/case/caseDetail.service';

export const POST = withProjectScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm('PROJECT_CASE:UPDATE');
    ctx.requireWritable();
    const { caseId } = await (seg as { params: Promise<{ caseId: string }> }).params;
    const body = dependencyUpsertSchema.parse(await req.json());
    return okResponse(await svc.addDependency(ctx.projectId, body.preCaseId === caseId ? body.preCaseId : body.preCaseId, body.postCaseId === caseId ? caseId : body.postCaseId), 201);
  } catch (err) { return toResponse(err); }
});
`,
  }),
});
route('api/v1/projects/[projectId]/cases/[caseId]/dependencies/[id]/route.ts', {
  DELETE: h('project', { perm: 'PROJECT_CASE:UPDATE', writable: true, svc: 'case/caseDetail.service', fn: 'removeDependency', params: ['caseId', 'id'], argExprs: ['ctx.projectId', 'id'] }),
});
route('api/v1/projects/[projectId]/cases/[caseId]/reviews/route.ts', {
  GET: h('project', { perm: 'PROJECT_CASE_REVIEW:READ', svc: 'case/caseDetail.service', fn: 'caseReviews', params: ['caseId'], argExprs: ['ctx.projectId', 'caseId'] }),
});
route('api/v1/projects/[projectId]/cases/[caseId]/plans/route.ts', {
  GET: h('project', { perm: 'PROJECT_PLAN:READ', svc: 'case/caseDetail.service', fn: 'casePlans', params: ['caseId'], argExprs: ['ctx.projectId', 'caseId', 'ctx.userId'] }),
});
route('api/v1/projects/[projectId]/cases/[caseId]/bugs/route.ts', {
  GET: h('project', { perm: 'PROJECT_BUG:READ', svc: 'case/caseDetail.service', fn: 'caseBugs', params: ['caseId'], argExprs: ['ctx.projectId', 'caseId'] }),
  POST: h('project', { perm: 'PROJECT_BUG:UPDATE', writable: true, svc: 'case/caseDetail.service', fn: 'linkCaseBug', params: ['caseId'], argExprs: ['ctx.projectId', 'caseId', 'body.bugId'], body: 'linkCaseBugSchema' }),
});
route('api/v1/projects/[projectId]/cases/[caseId]/bugs/[bugId]/route.ts', {
  DELETE: h('project', { perm: 'PROJECT_BUG:UPDATE', writable: true, svc: 'case/caseDetail.service', fn: 'unlinkCaseBug', params: ['caseId', 'bugId'], argExprs: ['ctx.projectId', 'caseId', 'bugId'] }),
});
route('api/v1/projects/[projectId]/cases/[caseId]/changes/route.ts', {
  GET: h('project', {
    perm: 'PROJECT_CASE:READ', svc: 'case/caseDetail.service', fn: 'listChanges', params: ['caseId'], argExprs: [],
    custom: `import { toResponse, okResponse, withProjectScope } from '@/server/guard';
import * as svc from '@/server/domains/case/caseDetail.service';

export const GET = withProjectScope(async (ctx, _req, seg) => {
  try {
    ctx.requirePerm('PROJECT_CASE:READ');
    const { caseId } = await (seg as { params: Promise<{ caseId: string }> }).params;
    return okResponse({ items: await svc.listChanges('functional_case', caseId) });
  } catch (err) { return toResponse(err); }
});
`,
  }),
});
route('api/v1/projects/[projectId]/comments/route.ts', {
  GET: h('project', {
    perm: 'PROJECT_CASE:READ', svc: 'case/caseDetail.service', fn: 'listComments', argExprs: [],
    custom: `import { toResponse, okResponse, withProjectScope } from '@/server/guard';
import * as svc from '@/server/domains/case/caseDetail.service';

export const GET = withProjectScope(async (ctx, req) => {
  try {
    ctx.requirePerm('PROJECT_CASE:READ');
    const entity = new URL(req.url).searchParams.get('entity') ?? '';
    const [entityType, entityId] = entity.split(':');
    if (!entityType || !entityId) return okResponse({ items: [] });
    return okResponse({ items: await svc.listComments(entityType, entityId) });
  } catch (err) { return toResponse(err); }
});
`,
  }),
  POST: h('project', {
    perm: 'PROJECT_CASE:READ', writable: true, svc: 'case/caseDetail.service', fn: 'addComment', body: 'commentUpsertSchema', argExprs: [],
    custom: `import { toResponse, okResponse, withProjectScope } from '@/server/guard';
import { commentUpsertSchema } from '@rabbit/shared';
import * as svc from '@/server/domains/case/caseDetail.service';

export const POST = withProjectScope(async (ctx, req) => {
  try {
    const entity = new URL(req.url).searchParams.get('entity') ?? '';
    const [entityType, entityId] = entity.split(':');
    if (!entityType || !entityId) return okResponse({ ok: false }, 422);
    const body = commentUpsertSchema.parse(await req.json());
    return okResponse(await svc.addComment(ctx.userId, entityType, entityId, body.content, body.parentId), 201);
  } catch (err) { return toResponse(err); }
});
`,
  }),
});
route('api/v1/projects/[projectId]/comments/[commentId]/route.ts', {
  PUT: h('project', {
    perm: 'PROJECT_CASE:READ', svc: 'case/caseDetail.service', fn: 'updateComment', body: 'commentUpsertSchema', params: ['commentId'], argExprs: [],
    custom: `import { toResponse, okResponse, withProjectScope } from '@/server/guard';
import { commentUpsertSchema } from '@rabbit/shared';
import * as svc from '@/server/domains/case/caseDetail.service';

export const PUT = withProjectScope(async (ctx, req, seg) => {
  try {
    const { commentId } = await (seg as { params: Promise<{ commentId: string }> }).params;
    const body = commentUpsertSchema.parse(await req.json());
    const canModerate = ctx.permissions.has('PROJECT_CASE:UPDATE');
    return okResponse(await svc.updateComment(ctx.userId, canModerate, commentId, body.content));
  } catch (err) { return toResponse(err); }
});
`,
  }),
  DELETE: h('project', {
    perm: 'PROJECT_CASE:READ', svc: 'case/caseDetail.service', fn: 'deleteComment', params: ['commentId'], argExprs: [],
    custom: `import { toResponse, okResponse, withProjectScope } from '@/server/guard';
import * as svc from '@/server/domains/case/caseDetail.service';

export const DELETE = withProjectScope(async (ctx, _req, seg) => {
  try {
    const { commentId } = await (seg as { params: Promise<{ commentId: string }> }).params;
    const canModerate = ctx.permissions.has('PROJECT_CASE:UPDATE');
    return okResponse(await svc.deleteComment(ctx.userId, canModerate, commentId));
  } catch (err) { return toResponse(err); }
});
`,
  }),
});

// ═══════════════ CASE-005：评审 ═══════════════
route('api/v1/projects/[projectId]/reviews/route.ts', {
  GET: h('project', {
    perm: 'PROJECT_CASE_REVIEW:READ', svc: 'review/review.service', fn: 'listReviews', argExprs: [],
    custom: `import { toResponse, okResponse, withProjectScope } from '@/server/guard';
import * as svc from '@/server/domains/review/review.service';

export const GET = withProjectScope(async (ctx, req) => {
  try {
    ctx.requirePerm('PROJECT_CASE_REVIEW:READ');
    const url = new URL(req.url);
    return okResponse(await svc.listReviews(ctx.projectId, ctx.userId, {
      view: url.searchParams.get('view') ?? undefined,
      keyword: url.searchParams.get('keyword') ?? undefined,
      page: Number(url.searchParams.get('page') ?? 1),
      pageSize: Number(url.searchParams.get('pageSize') ?? 20),
    }));
  } catch (err) { return toResponse(err); }
});
`,
  }),
  POST: h('project', { perm: 'PROJECT_CASE_REVIEW:UPDATE', writable: true, svc: 'review/review.service', fn: 'createReview', body: 'reviewUpsertSchema', argExprs: ['ctx.projectId', 'ctx.userId', 'body'], status: 201 }),
});
route('api/v1/projects/[projectId]/reviews/[reviewId]/route.ts', {
  GET: h('project', {
    perm: 'PROJECT_CASE_REVIEW:READ', svc: 'review/review.service', fn: 'getReview', params: ['reviewId'], argExprs: ['ctx.projectId', 'reviewId', 'ctx.userId'],
  }),
  PUT: h('project', { perm: 'PROJECT_CASE_REVIEW:UPDATE', writable: true, svc: 'review/review.service', fn: 'updateReview', body: 'reviewUpsertSchema', params: ['reviewId'], argExprs: ['ctx.projectId', 'reviewId', 'body'] }),
  DELETE: h('project', { perm: 'PROJECT_CASE_REVIEW:UPDATE', writable: true, svc: 'review/review.service', fn: 'deleteReview', params: ['reviewId'], argExprs: ['ctx.projectId', 'reviewId'] }),
});
route('api/v1/projects/[projectId]/reviews/[reviewId]/close/route.ts', {
  POST: h('project', { perm: 'PROJECT_CASE_REVIEW:UPDATE', writable: true, svc: 'review/review.service', fn: 'closeReview', params: ['reviewId'], argExprs: ['ctx.projectId', 'reviewId'] }),
});
route('api/v1/projects/[projectId]/reviews/[reviewId]/copy/route.ts', {
  POST: h('project', { perm: 'PROJECT_CASE_REVIEW:UPDATE', writable: true, svc: 'review/review.service', fn: 'copyReview', params: ['reviewId'], argExprs: ['ctx.projectId', 'reviewId'], status: 201 }),
});
route('api/v1/projects/[projectId]/reviews/[reviewId]/cases/route.ts', {
  POST: h('project', { perm: 'PROJECT_CASE_REVIEW:UPDATE', writable: true, svc: 'review/review.service', fn: 'addReviewCases', body: 'reviewCasesAddSchema', params: ['reviewId'], argExprs: ['ctx.projectId', 'reviewId', 'body.caseIds'] }),
});
route('api/v1/projects/[projectId]/reviews/[reviewId]/cases/[caseId]/route.ts', {
  DELETE: h('project', { perm: 'PROJECT_CASE_REVIEW:UPDATE', writable: true, svc: 'review/review.service', fn: 'removeReviewCase', params: ['reviewId', 'caseId'], argExprs: ['ctx.projectId', 'reviewId', 'caseId'] }),
});
route('api/v1/projects/[projectId]/reviews/[reviewId]/cases/[caseId]/judge/route.ts', {
  POST: h('project', { perm: 'PROJECT_CASE_REVIEW:UPDATE', writable: true, svc: 'review/review.service', fn: 'judgeReviewCase', body: 'reviewJudgeSchema', params: ['reviewId', 'caseId'], argExprs: ['ctx.projectId', 'reviewId', 'caseId', 'ctx.userId', 'body'] }),
});
route('api/v1/projects/[projectId]/reviews/[reviewId]/cases/batch-judge/route.ts', {
  POST: h('project', { perm: 'PROJECT_CASE_REVIEW:UPDATE', writable: true, svc: 'review/review.service', fn: 'batchJudge', body: 'reviewBatchJudgeSchema', params: ['reviewId'], argExprs: ['ctx.projectId', 'reviewId', 'ctx.userId', 'body.caseIds', 'body'] }),
});
route('api/v1/projects/[projectId]/reviews/[reviewId]/cases/batch-reviewer/route.ts', {
  POST: h('project', { perm: 'PROJECT_CASE_REVIEW:UPDATE', writable: true, svc: 'review/review.service', fn: 'batchReviewer', body: 'reviewBatchReviewerSchema', params: ['reviewId'], argExprs: ['ctx.projectId', 'reviewId', 'body.caseIds', 'body.reviewer'] }),
});
route('api/v1/projects/[projectId]/settings/case-review/route.ts', {
  GET: h('project', { perm: 'PROJECT_CASE_REVIEW:READ', svc: 'review/review.service', fn: 'getReviewSetting', argExprs: ['ctx.projectId'] }),
  PUT: h('project', {
    perm: 'PROJECT_CASE_REVIEW:UPDATE', writable: true, svc: 'review/review.service', fn: 'setReviewSetting', argExprs: ['ctx.projectId', 'body.enabled'],
    custom: `import { toResponse, okResponse, withProjectScope } from '@/server/guard';
import * as svc from '@/server/domains/review/review.service';

export const PUT = withProjectScope(async (ctx, req) => {
  try {
    ctx.requirePerm('PROJECT_CASE_REVIEW:UPDATE');
    ctx.requireWritable();
    const body = (await req.json()) as { enabled?: boolean };
    return okResponse(await svc.setReviewSetting(ctx.projectId, Boolean(body.enabled)));
  } catch (err) { return toResponse(err); }
});
`,
  }),
});

// ═══════════════ BUG-001：缺陷 + 附件 ═══════════════
route('api/v1/projects/[projectId]/bugs/route.ts', {
  GET: h('project', {
    perm: 'PROJECT_BUG:READ', svc: 'bug/bug.service', fn: 'listBugs', argExprs: [],
    custom: `import { toResponse, okResponse, withProjectScope } from '@/server/guard';
import * as svc from '@/server/domains/bug/bug.service';

export const GET = withProjectScope(async (ctx, req) => {
  try {
    ctx.requirePerm('PROJECT_BUG:READ');
    const url = new URL(req.url);
    return okResponse(await svc.listBugs(ctx.projectId, {
      keyword: url.searchParams.get('keyword') ?? undefined,
      status: url.searchParams.get('status') ?? undefined,
      handler: url.searchParams.get('handler') ?? undefined,
      moduleId: url.searchParams.get('moduleId') ?? undefined,
      includeChildren: url.searchParams.get('includeChildren') === 'true',
      tags: url.searchParams.get('tags') ?? undefined,
      fields: url.searchParams.get('fields') ?? undefined,
      recycled: url.searchParams.get('recycled') === 'true',
      page: Number(url.searchParams.get('page') ?? 1),
      pageSize: Number(url.searchParams.get('pageSize') ?? 20),
    }));
  } catch (err) { return toResponse(err); }
});
`,
  }),
  POST: h('project', {
    perm: 'PROJECT_BUG:CREATE', writable: true, svc: 'bug/bug.service', fn: 'createBug', argExprs: ['ctx.projectId', 'ctx.orgId', 'ctx.userId', 'body'], status: 201,
    custom: `import { toResponse, okResponse, withProjectScope } from '@/server/guard';
import { bugUpsertSchema } from '@rabbit/shared';
import * as svc from '@/server/domains/bug/bug.service';

export const POST = withProjectScope(async (ctx, req) => {
  try {
    ctx.requirePerm('PROJECT_BUG:CREATE');
    ctx.requireWritable();
    const body = bugUpsertSchema.parse(await req.json());
    return okResponse(await svc.createBug(ctx.projectId, ctx.orgId, ctx.userId, body), 201);
  } catch (err) { return toResponse(err); }
});
`,
  }),
});
route('api/v1/projects/[projectId]/bugs/[bugId]/route.ts', {
  GET: h('project', {
    perm: 'PROJECT_BUG:READ', svc: 'bug/bug.service', fn: 'getBug', params: ['bugId'], argExprs: ['ctx.projectId', 'bugId'],
    custom: `import { toResponse, okResponse, withProjectScope } from '@/server/guard';
import * as svc from '@/server/domains/bug/bug.service';

export const GET = withProjectScope(async (ctx, _req, seg) => {
  try {
    ctx.requirePerm('PROJECT_BUG:READ');
    const { bugId } = await (seg as { params: Promise<{ bugId: string }> }).params;
    const bug = await svc.getBug(ctx.projectId, bugId);
    const transitions = await svc.allowedTransitions(ctx.projectId, ctx.orgId, bug.status);
    return okResponse({ ...bug, allowedTransitions: transitions });
  } catch (err) { return toResponse(err); }
});
`,
  }),
  PUT: h('project', { perm: 'PROJECT_BUG:UPDATE', writable: true, svc: 'bug/bug.service', fn: 'updateBug', body: 'bugUpsertSchema', params: ['bugId'], argExprs: ['ctx.projectId', 'bugId', 'ctx.userId', 'body'] }),
  DELETE: h('project', {
    perm: 'PROJECT_BUG:DELETE', writable: true, svc: 'bug/bug.service', fn: 'softDeleteBug', params: ['bugId'], argExprs: ['ctx.projectId', 'bugId'],
    custom: `import { toResponse, okResponse, withProjectScope } from '@/server/guard';
import * as svc from '@/server/domains/bug/bug.service';

export const DELETE = withProjectScope(async (ctx, req, seg) => {
  try {
    ctx.requirePerm('PROJECT_BUG:DELETE');
    ctx.requireWritable();
    const { bugId } = await (seg as { params: Promise<{ bugId: string }> }).params;
    const purge = new URL(req.url).searchParams.get('purge') === 'true';
    if (purge) return okResponse(await svc.purgeBug(ctx.projectId, bugId));
    return okResponse(await svc.softDeleteBug(ctx.projectId, bugId));
  } catch (err) { return toResponse(err); }
});
`,
  }),
});
route('api/v1/projects/[projectId]/bugs/[bugId]/restore/route.ts', {
  POST: h('project', { perm: 'PROJECT_BUG:UPDATE', writable: true, svc: 'bug/bug.service', fn: 'restoreBug', params: ['bugId'], argExprs: ['ctx.projectId', 'bugId'] }),
});
route('api/v1/projects/[projectId]/bugs/[bugId]/transition/route.ts', {
  POST: h('project', { perm: 'PROJECT_BUG:UPDATE', writable: true, svc: 'bug/bug.service', fn: 'transitionBug', body: 'bugTransitionSchema', params: ['bugId'], argExprs: ['ctx.projectId', 'ctx.orgId', 'bugId', 'ctx.userId', 'body'] }),
});
route('api/v1/projects/[projectId]/bugs/[bugId]/follow/route.ts', {
  POST: h('project', { perm: 'PROJECT_BUG:READ', svc: 'bug/bug.service', fn: 'setBugFollow', params: ['bugId'], argExprs: ['ctx.projectId', 'ctx.userId', 'bugId', 'true'] }),
});
route('api/v1/projects/[projectId]/bugs/[bugId]/cases/route.ts', {
  GET: h('project', { perm: 'PROJECT_BUG:READ', svc: 'bug/bug.service', fn: 'listBugCases', params: ['bugId'], argExprs: ['ctx.projectId', 'bugId'] }),
  POST: h('project', { perm: 'PROJECT_BUG:UPDATE', writable: true, svc: 'bug/bug.service', fn: 'linkBugCase', body: 'linkBugCaseSchema', params: ['bugId'], argExprs: ['ctx.projectId', 'bugId', 'body.caseId'] }),
});
route('api/v1/projects/[projectId]/bugs/[bugId]/cases/[caseId]/route.ts', {
  DELETE: h('project', { perm: 'PROJECT_BUG:UPDATE', writable: true, svc: 'bug/bug.service', fn: 'unlinkBugCase', params: ['bugId', 'caseId'], argExprs: ['ctx.projectId', 'bugId', 'caseId'] }),
});
route('api/v1/projects/[projectId]/bugs/[bugId]/attachments/route.ts', {
  GET: h('project', { perm: 'PROJECT_BUG:READ', svc: 'bug/bug.service', fn: 'listAttachments', params: ['bugId'], argExprs: ["'bug'", 'bugId'] }),
});
route('api/v1/projects/[projectId]/attachments/route.ts', {
  POST: h('project', {
    perm: 'PROJECT_BUG:CREATE', writable: true, svc: 'bug/bug.service', fn: 'addAttachment', argExprs: [],
    custom: `import { toResponse, okResponse, withProjectScope } from '@/server/guard';
import * as svc from '@/server/domains/bug/bug.service';

export const POST = withProjectScope(async (ctx, req) => {
  try {
    ctx.requirePerm('PROJECT_BUG:CREATE');
    ctx.requireWritable();
    const form = await req.formData();
    const file = form.get('file');
    const entity = String(form.get('entity') ?? '');
    if (!(file instanceof File) || !entity.includes(':')) return okResponse({ ok: false, message: '缺少 file/entity' }, 422);
    const [entityType, entityId] = entity.split(':') as [string, string];
    const buffer = Buffer.from(await file.arrayBuffer());
    return okResponse(await svc.addAttachment(ctx.projectId, ctx.userId, entityType, entityId, {
      name: file.name, mime: file.type || undefined, size: buffer.byteLength, buffer,
    }), 201);
  } catch (err) { return toResponse(err); }
});
`,
  }),
});
route('api/v1/projects/[projectId]/attachments/[attachmentId]/route.ts', {
  DELETE: h('project', { perm: 'PROJECT_BUG:UPDATE', writable: true, svc: 'bug/bug.service', fn: 'deleteAttachment', params: ['attachmentId'], argExprs: ['ctx.projectId', 'attachmentId'] }),
});
route('api/v1/projects/[projectId]/attachments/[attachmentId]/download/route.ts', {
  GET: h('project', {
    perm: 'PROJECT_BUG:READ', svc: 'bug/bug.service', fn: 'getAttachment', params: ['attachmentId'], argExprs: [],
    custom: `import { toResponse, withProjectScope } from '@/server/guard';
import * as svc from '@/server/domains/bug/bug.service';
import { readObject } from '@/server/storage';

export const GET = withProjectScope(async (ctx, _req, seg) => {
  try {
    ctx.requirePerm('PROJECT_BUG:READ');
    const { attachmentId } = await (seg as { params: Promise<{ attachmentId: string }> }).params;
    const a = await svc.getAttachment(ctx.projectId, attachmentId);
    const buffer = await readObject(a.storageKey);
    const res = new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': a.mime ?? 'application/octet-stream',
        'Content-Disposition': "attachment; filename=" + JSON.stringify(a.name),
      },
    });
    return res as unknown as import('next/server').NextResponse;
  } catch (err) { return toResponse(err); }
});
`,
  }),
});

route('api/v1/projects/[projectId]/bugs/[bugId]/changes/route.ts', {
  GET: h('project', {
    perm: 'PROJECT_BUG:READ', svc: 'bug/bug.service', fn: 'listBugChanges', params: ['bugId'], argExprs: [],
    custom: `import { toResponse, okResponse, withProjectScope } from '@/server/guard';
import * as svc from '@/server/domains/bug/bug.service';

export const GET = withProjectScope(async (ctx, _req, seg) => {
  try {
    ctx.requirePerm('PROJECT_BUG:READ');
    const { bugId } = await (seg as { params: Promise<{ bugId: string }> }).params;
    return okResponse({ items: await svc.listBugChanges(ctx.projectId, bugId) });
  } catch (err) { return toResponse(err); }
});
`,
  }),
});

// ═══════════════ PLAN-001：测试计划 ═══════════════
route('api/v1/projects/[projectId]/plans/route.ts', {
  GET: h('project', {
    perm: 'PROJECT_PLAN:READ', svc: 'plan/plan.service', fn: 'listPlans', argExprs: [],
    custom: `import { toResponse, okResponse, withProjectScope } from '@/server/guard';
import * as svc from '@/server/domains/plan/plan.service';

export const GET = withProjectScope(async (ctx, req) => {
  try {
    ctx.requirePerm('PROJECT_PLAN:READ');
    const url = new URL(req.url);
    return okResponse(await svc.listPlans(ctx.projectId, {
      keyword: url.searchParams.get('keyword') ?? undefined,
      archived: url.searchParams.get('archived') ?? undefined,
      page: Number(url.searchParams.get('page') ?? 1),
      pageSize: Number(url.searchParams.get('pageSize') ?? 20),
    }));
  } catch (err) { return toResponse(err); }
});
`,
  }),
  POST: h('project', { perm: 'PROJECT_PLAN:CREATE', writable: true, svc: 'plan/plan.service', fn: 'createPlan', body: 'planUpsertSchema', argExprs: ['ctx.projectId', 'ctx.userId', 'body'], status: 201 }),
});
route('api/v1/projects/[projectId]/plans/[planId]/route.ts', {
  GET: h('project', { perm: 'PROJECT_PLAN:READ', svc: 'plan/plan.service', fn: 'getPlan', params: ['planId'], argExprs: ['ctx.projectId', 'planId'] }),
  PUT: h('project', { perm: 'PROJECT_PLAN:UPDATE', writable: true, svc: 'plan/plan.service', fn: 'updatePlan', body: 'planUpsertSchema', params: ['planId'], argExprs: ['ctx.projectId', 'planId', 'body'] }),
  DELETE: h('project', { perm: 'PROJECT_PLAN:DELETE', writable: true, svc: 'plan/plan.service', fn: 'deletePlan', params: ['planId'], argExprs: ['ctx.projectId', 'planId'] }),
});
route('api/v1/projects/[projectId]/plans/[planId]/archive/route.ts', {
  POST: h('project', { perm: 'PROJECT_PLAN:UPDATE', writable: true, svc: 'plan/plan.service', fn: 'archivePlan', params: ['planId'], argExprs: ['ctx.projectId', 'planId', 'true'] }),
});
route('api/v1/projects/[projectId]/plans/[planId]/unarchive/route.ts', {
  POST: h('project', { perm: 'PROJECT_PLAN:UPDATE', writable: true, svc: 'plan/plan.service', fn: 'archivePlan', params: ['planId'], argExprs: ['ctx.projectId', 'planId', 'false'] }),
});
route('api/v1/projects/[projectId]/plans/[planId]/cases/route.ts', {
  POST: h('project', { perm: 'PROJECT_PLAN:UPDATE', writable: true, svc: 'plan/plan.service', fn: 'addPlanCases', body: 'planCasesAddSchema', params: ['planId'], argExprs: ['ctx.projectId', 'planId', 'body.caseIds', 'body.execUserId'] }),
});
route('api/v1/projects/[projectId]/plans/[planId]/cases/[refId]/route.ts', {
  DELETE: h('project', { perm: 'PROJECT_PLAN:UPDATE', writable: true, svc: 'plan/plan.service', fn: 'removePlanCase', params: ['planId', 'refId'], argExprs: ['ctx.projectId', 'planId', 'refId'] }),
});
route('api/v1/projects/[projectId]/plans/[planId]/cases/[refId]/exec/route.ts', {
  POST: h('project', { perm: 'PROJECT_PLAN:UPDATE', writable: true, svc: 'plan/plan.service', fn: 'execPlanCase', body: 'planExecSchema', params: ['planId', 'refId'], argExprs: ['ctx.projectId', 'planId', 'refId', 'ctx.userId', 'body'] }),
});
route('api/v1/projects/[projectId]/plans/[planId]/cases/batch-executor/route.ts', {
  POST: h('project', { perm: 'PROJECT_PLAN:UPDATE', writable: true, svc: 'plan/plan.service', fn: 'batchExecutor', body: 'planBatchExecutorSchema', params: ['planId'], argExprs: ['ctx.projectId', 'planId', 'body.refIds', 'body.execUserId'] }),
});
route('api/v1/projects/[projectId]/plans/[planId]/report/route.ts', {
  GET: h('project', { perm: 'PROJECT_PLAN:READ', svc: 'plan/plan.service', fn: 'getPlanReport', params: ['planId'], argExprs: ['ctx.projectId', 'planId'] }),
});
route('api/v1/projects/[projectId]/plans/[planId]/report/summary/route.ts', {
  PUT: h('project', { perm: 'PROJECT_PLAN:UPDATE', writable: true, svc: 'plan/plan.service', fn: 'updatePlanReportSummary', body: 'planReportSummarySchema', params: ['planId'], argExprs: ['ctx.projectId', 'planId', 'body.summary'] }),
});

// ═══════════════ DASH-001：工作台聚合 ═══════════════
route('api/v1/projects/[projectId]/dashboard/overview/route.ts', {
  GET: h('project', {
    perm: 'PROJECT_CASE:READ', svc: 'dash/dash.service', fn: 'overview', argExprs: [],
    custom: `import { toResponse, okResponse, withProjectScope } from '@/server/guard';
import * as svc from '@/server/domains/dash/dash.service';

export const GET = withProjectScope(async (ctx, req) => {
  try {
    const url = new URL(req.url);
    const range = url.searchParams.get('range') ?? '7d';
    const parsed = svc.parseRange(range, url.searchParams.get('from') ?? undefined, url.searchParams.get('to') ?? undefined);
    if (Number.isNaN(parsed.from.getTime()) || Number.isNaN(parsed.to.getTime())) {
      return okResponse({ ok: false, message: '非法时间区间' }, 422);
    }
    return okResponse(await svc.overview(ctx.projectId, ctx.orgId, parsed));
  } catch (err) { return toResponse(err); }
});
`,
  }),
});
route('api/v1/projects/[projectId]/dashboard/todo/route.ts', {
  GET: h('project', {
    perm: 'PROJECT_CASE:READ', svc: 'dash/dash.service', fn: 'todo', argExprs: [],
    custom: `import { toResponse, okResponse, withProjectScope } from '@/server/guard';
import * as svc from '@/server/domains/dash/dash.service';

export const GET = withProjectScope(async (ctx, req) => {
  try {
    const url = new URL(req.url);
    return okResponse(await svc.todo(ctx.projectId, ctx.orgId, ctx.userId, url.searchParams.get('kind') ?? 'review', Number(url.searchParams.get('page') ?? 1), Number(url.searchParams.get('pageSize') ?? 20)));
  } catch (err) { return toResponse(err); }
});
`,
  }),
});
route('api/v1/projects/[projectId]/dashboard/followed/route.ts', {
  GET: h('project', {
    perm: 'PROJECT_CASE:READ', svc: 'dash/dash.service', fn: 'followed', argExprs: [],
    custom: `import { toResponse, okResponse, withProjectScope } from '@/server/guard';
import * as svc from '@/server/domains/dash/dash.service';

export const GET = withProjectScope(async (ctx, req) => {
  try {
    const url = new URL(req.url);
    return okResponse(await svc.followed(ctx.userId, Number(url.searchParams.get('page') ?? 1), Number(url.searchParams.get('pageSize') ?? 20)));
  } catch (err) { return toResponse(err); }
});
`,
  }),
});
route('api/v1/projects/[projectId]/dashboard/created/route.ts', {
  GET: h('project', {
    perm: 'PROJECT_CASE:READ', svc: 'dash/dash.service', fn: 'created', argExprs: [],
    custom: `import { toResponse, okResponse, withProjectScope } from '@/server/guard';
import * as svc from '@/server/domains/dash/dash.service';

export const GET = withProjectScope(async (ctx, req) => {
  try {
    const url = new URL(req.url);
    return okResponse(await svc.created(ctx.projectId, url.searchParams.get('kind') ?? 'case', Number(url.searchParams.get('page') ?? 1), Number(url.searchParams.get('pageSize') ?? 20)));
  } catch (err) { return toResponse(err); }
});
`,
  }),
});

// ═══════════════ 个人权限下发（SYS-004 菜单/按钮守卫数据源） ═══════════════
route('api/v1/personal/permissions/route.ts', {
  GET: h('auth', {
    fn: '', svc: '', argExprs: [],
    custom: `import { toResponse, okResponse, withAuth } from '@/server/guard';
import { permissionSetFor } from '@/server/rbac';

export const GET = withAuth(async (ctx, req: Request) => {
  try {
    const url = new URL(req.url);
    const projectId = url.searchParams.get('projectId');
    let orgId: string | undefined;
    if (projectId) {
      const { prisma } = await import('@rabbit/db');
      const p = await prisma.project.findFirst({ where: { id: projectId }, select: { orgId: true } });
      orgId = p?.orgId;
    }
    const scoped = await permissionSetFor(ctx.userId, { orgId, projectId: projectId ?? undefined });
    const global = await permissionSetFor(ctx.userId);
    return okResponse({ scoped: [...scoped], global: [...global] });
  } catch (err) { return toResponse(err); }
});
`,
  }),
});

// ── 落盘 ──
let written = 0, skipped = 0;
for (const [rel, content] of files) {
  const abs = path.join(ROOT, 'apps/web/src/app', rel);
  if (existsSync(abs) && !FORCE) { skipped++; continue; }
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, content);
  written++;
}
console.log(`routes written=${written} skipped=${skipped}`);

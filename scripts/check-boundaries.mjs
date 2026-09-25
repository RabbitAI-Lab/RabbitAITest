#!/usr/bin/env node
/** 验收标准 7：跨域引用静态检查（dependency-graph §4 禁止方向）。 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
let violations = 0;

function walk(dir, cb) {
  for (const f of readdirSync(dir)) {
    if (f === 'node_modules' || f.startsWith('.')) continue;
    const p = path.join(dir, f);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, cb);
    else if (/\.(ts|tsx)$/.test(f)) cb(p);
  }
}

const rules = [
  {
    scope: 'apps/engine',
    banned: [/@rabbit\/db/, /@\/server/, /@\/components/],
    why: 'engine 不得依赖 web 与 db（monorepo-structure §2.2）',
  },
  {
    scope: 'packages/ui',
    banned: [/@rabbit\/api-client/, /@\/stores/],
    why: 'packages/ui 不得依赖业务客户端与状态（monorepo-structure §2.5）',
  },
];

for (const rule of rules) {
  walk(path.join(root, rule.scope), (file) => {
    const src = readFileSync(file, 'utf8');
    for (const re of rule.banned) {
      if (re.test(src)) {
        console.error(`[boundary] ${path.relative(root, file)} 违反：${rule.why}`);
        violations += 1;
      }
    }
  });
}

// exec/report/plan/bug 域不得直接 import case/api_test 域模型（test-domain-model §3）
walk(path.join(root, 'apps/web/src/server/domains'), (file) => {
  const rel = path.relative(root, file);
  const domain = rel.split('/').at(-2);
  if (['exec', 'report', 'plan', 'bug'].includes(domain ?? '')) {
    const src = readFileSync(file, 'utf8');
    const m = src.match(/domains\/(case|api_test)\//);
    if (m) {
      console.error(`[boundary] ${rel} 直接引用 ${m[1]} 域（须走 Provider，test-domain-model §3）`);
      violations += 1;
    }
  }
});

if (violations > 0) {
  console.error(`boundary check: ${violations} violation(s)`);
  process.exit(1);
}
console.log('boundary check: PASS');

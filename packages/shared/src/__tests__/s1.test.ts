/** Sprint 1 核心单测：权限并集/禁用交集、字段引擎矩阵、评审聚合、Markdown 转义、通过率口径。 */
import { describe, expect, it } from 'vitest';
import {
  resolvePermissionSet, PRESET_GROUP_PERMISSIONS, isValidPermissionPoint,
  buildValidator, renderKind,
  aggregateReviewResult, planPassRate,
  renderMarkdown, markdownExcerpt, escapeHtml,
} from '../index';
import type { FieldDefInput } from '../fields';

// ── SYS-004 权限矩阵（≥12 组合契约测试，rbac §1）──

describe('resolvePermissionSet 并集/禁用交集', () => {
  const g = (permissions: string[], disabled: string[] = []) => ({ permissions, disabled });

  it('单组：授权原样生效', () => {
    expect(resolvePermissionSet([g(['PROJECT_CASE:READ'])])).toEqual(new Set(['PROJECT_CASE:READ']));
  });

  it('两组并集', () => {
    const set = resolvePermissionSet([g(['PROJECT_CASE:READ']), g(['PROJECT_BUG:READ'])]);
    expect(set.has('PROJECT_CASE:READ')).toBe(true);
    expect(set.has('PROJECT_BUG:READ')).toBe(true);
    expect(set.size).toBe(2);
  });

  it('同资源不同动作并集', () => {
    const set = resolvePermissionSet([g(['PROJECT_CASE:READ']), g(['PROJECT_CASE:CREATE'])]);
    expect([...set].sort()).toEqual(['PROJECT_CASE:CREATE', 'PROJECT_CASE:READ']);
  });

  it('任一组禁用资源 → 整组剔除（交集语义）', () => {
    const set = resolvePermissionSet([g(['PROJECT_CASE:READ', 'PROJECT_CASE:CREATE']), g(['PROJECT_BUG:READ'], ['PROJECT_CASE'])]);
    expect(set.has('PROJECT_CASE:READ')).toBe(false);
    expect(set.has('PROJECT_CASE:CREATE')).toBe(false);
    expect(set.has('PROJECT_BUG:READ')).toBe(true);
  });

  it('禁用单点不影响同资源其它动作', () => {
    const set = resolvePermissionSet([g(['PROJECT_CASE:READ', 'PROJECT_CASE:CREATE'], ['PROJECT_CASE:CREATE'])]);
    expect(set.has('PROJECT_CASE:READ')).toBe(true);
    expect(set.has('PROJECT_CASE:CREATE')).toBe(false);
  });

  it('非法权限点被丢弃（防私造）', () => {
    const set = resolvePermissionSet([g(['PROJECT_CASE:READ', 'FAKE_POINT:READ'])]);
    expect(set.has('PROJECT_CASE:READ')).toBe(true);
    expect(set.has('FAKE_POINT:READ')).toBe(false);
  });

  it('空组集合 → 空权限', () => {
    expect(resolvePermissionSet([]).size).toBe(0);
  });

  it('预置组权限点全部合法', () => {
    for (const perms of Object.values(PRESET_GROUP_PERMISSIONS)) {
      for (const p of perms) expect(isValidPermissionPoint(p)).toBe(true);
    }
  });

  it('系统管理员含全部权限点；项目成员不含删除', () => {
    const admin = resolvePermissionSet([g([...PRESET_GROUP_PERMISSIONS.SYSTEM_ADMIN])]);
    expect(admin.has('SYSTEM_USER:DELETE')).toBe(true);
    const member = resolvePermissionSet([g([...PRESET_GROUP_PERMISSIONS.PROJECT_MEMBER])]);
    expect(member.has('PROJECT_CASE:READ')).toBe(true);
    expect(member.has('PROJECT_CASE:DELETE')).toBe(false);
  });

  it('禁用交集优先级高于并集（跨资源前缀匹配）', () => {
    const set = resolvePermissionSet([g(['PROJECT_CASE:READ', 'PROJECT_BUG:READ', 'PROJECT_BUG:CREATE']), g([], ['PROJECT_BUG'])]);
    expect(set.has('PROJECT_CASE:READ')).toBe(true);
    expect(set.has('PROJECT_BUG:READ')).toBe(false);
    expect(set.has('PROJECT_BUG:CREATE')).toBe(false);
  });

  it('多组同时禁用不同资源', () => {
    const set = resolvePermissionSet([g(['A:X'], ['PROJECT_PLAN']), g(['PROJECT_PLAN:READ'])]);
    expect(set.has('PROJECT_PLAN:READ')).toBe(false);
  });

  it('disabled 非法资源名不致命中（未授权资源无副作用）', () => {
    const set = resolvePermissionSet([g(['PROJECT_CASE:READ'], ['NOT_A_RESOURCE'])]);
    expect(set.has('PROJECT_CASE:READ')).toBe(true);
  });

  it('并集后禁用仍生效（顺序无关）', () => {
    const a = resolvePermissionSet([g(['PROJECT_CASE:READ']), g([], ['PROJECT_CASE'])]);
    const b = resolvePermissionSet([g([], ['PROJECT_CASE']), g(['PROJECT_CASE:READ'])]);
    expect(a.has('PROJECT_CASE:READ')).toBe(false);
    expect(b.has('PROJECT_CASE:READ')).toBe(false);
  });
});

// ── PROJ-002 buildValidator 10 类型矩阵 ──

describe('buildValidator 字段引擎', () => {
  const defs = (over: { key: string; type: string } & Partial<FieldDefInput>): FieldDefInput => ({
    scene: 'case', name: over.name ?? over.key, required: false, options: {}, enabled: true,
    ...over,
  } as FieldDefInput);

  it('input 必填缺失拒绝；通过后放行', () => {
    const v = buildValidator([defs({ key: 'title', type: 'input', required: true })]);
    expect(v.safeParse({}).success).toBe(false);
    expect(v.safeParse({ title: 'ok' }).success).toBe(true);
  });

  it('number 范围校验', () => {
    const v = buildValidator([defs({ key: 'age', type: 'number', options: { min: 1, max: 100 } })]);
    expect(v.safeParse({ age: 0 }).success).toBe(false);
    expect(v.safeParse({ age: 50 }).success).toBe(true);
    expect(v.safeParse({ age: 101 }).success).toBe(false);
  });

  it('single_select 选项白名单', () => {
    const v = buildValidator([defs({ key: 'sev', type: 'single_select', options: { options: ['P1', 'P2'] } })]);
    expect(v.safeParse({ sev: 'P1' }).success).toBe(true);
    expect(v.safeParse({ sev: 'P9' }).success).toBe(false);
  });

  it('multi_select 数组且逐项白名单', () => {
    const v = buildValidator([defs({ key: 'tags', type: 'multi_select', options: { options: ['a', 'b'] } })]);
    expect(v.safeParse({ tags: ['a', 'b'] }).success).toBe(true);
    expect(v.safeParse({ tags: ['a', 'x'] }).success).toBe(false);
    expect(v.safeParse({ tags: 'a' }).success).toBe(false);
  });

  it('date YYYY-MM-DD 格式', () => {
    const v = buildValidator([defs({ key: 'd', type: 'date' })]);
    expect(v.safeParse({ d: '2026-09-26' }).success).toBe(true);
    expect(v.safeParse({ d: '2026/09/26' }).success).toBe(false);
  });

  it('checkbox 布尔', () => {
    const v = buildValidator([defs({ key: 'ok', type: 'checkbox' })]);
    expect(v.safeParse({ ok: true }).success).toBe(true);
    expect(v.safeParse({ ok: 'yes' }).success).toBe(false);
  });

  it('radio 同 single_select；url 格式与长度', () => {
    const v = buildValidator([
      defs({ key: 'r', type: 'radio', options: { options: ['x', 'y'] } }),
      defs({ key: 'link', type: 'url', options: { maxLength: 30 } }),
    ]);
    expect(v.safeParse({ r: 'x', link: 'https://a.cn' }).success).toBe(true);
    expect(v.safeParse({ r: 'z', link: 'https://a.cn' }).success).toBe(false);
    expect(v.safeParse({ r: 'x', link: 'not-a-url' }).success).toBe(false);
  });

  it('input 正则与长度', () => {
    const v = buildValidator([defs({ key: 'code', type: 'input', options: { pattern: '^RB-\\d+$', minLength: 2, maxLength: 10 } })]);
    expect(v.safeParse({ code: 'RB-123' }).success).toBe(true);
    expect(v.safeParse({ code: 'XX' }).success).toBe(false);
  });

  it('member UUID 校验', () => {
    const v = buildValidator([defs({ key: 'owner', type: 'member' })]);
    expect(v.safeParse({ owner: '00000000-0000-0000-0000-000000000001' }).success).toBe(true);
    expect(v.safeParse({ owner: 'not-uuid' }).success).toBe(false);
  });

  it('模板绑定覆写 required；未绑定字段不校验', () => {
    const v = buildValidator(
      [defs({ key: 'a', type: 'input' }), defs({ key: 'b', type: 'input' })],
      [{ fieldKey: 'a', required: true, visibleInList: false }],
    );
    expect(v.safeParse({}).success).toBe(false);           // a 被覆写必填
    expect(v.safeParse({ a: 'x' }).success).toBe(true);    // b 未绑定不参与
  });

  it('停用字段不校验（软停用语义）', () => {
    const v = buildValidator([defs({ key: 'gone', type: 'input', required: true, enabled: false })]);
    expect(v.safeParse({}).success).toBe(true);
  });

  it('renderKind 控件映射完备', () => {
    for (const t of ['input', 'textarea', 'number', 'date', 'single_select', 'multi_select', 'checkbox', 'radio', 'member', 'url'] as const) {
      expect(typeof renderKind(t)).toBe('string');
    }
  });
});

// ── CASE-005 聚合矩阵 ──

describe('aggregateReviewResult 单人/多人', () => {
  const reviewers = ['u1', 'u2'];
  it('无人标记 → PENDING', () => {
    expect(aggregateReviewResult('MULTI', reviewers, [])).toBe('PENDING');
  });
  it('任一 FAIL 即 FAIL', () => {
    expect(aggregateReviewResult('MULTI', reviewers, [
      { userId: 'u1', result: 'PASS' }, { userId: 'u2', result: 'FAIL' },
    ])).toBe('FAIL');
  });
  it('全员 PASS 才 PASS', () => {
    expect(aggregateReviewResult('MULTI', reviewers, [{ userId: 'u1', result: 'PASS' }])).toBe('PENDING');
    expect(aggregateReviewResult('MULTI', reviewers, [
      { userId: 'u1', result: 'PASS' }, { userId: 'u2', result: 'PASS' },
    ])).toBe('PASS');
  });
  it('Suggest 不否决但不足 PASS', () => {
    expect(aggregateReviewResult('MULTI', reviewers, [
      { userId: 'u1', result: 'SUGGEST' }, { userId: 'u2', result: 'PASS' },
    ])).toBe('SUGGEST');
  });
  it('单人模式=最后结果生效', () => {
    expect(aggregateReviewResult('SINGLE', reviewers, [
      { userId: 'u1', result: 'PASS' }, { userId: 'u2', result: 'FAIL' },
    ])).toBe('FAIL');
  });
  it('非评审人标记不计入', () => {
    expect(aggregateReviewResult('MULTI', reviewers, [
      { userId: 'outsider', result: 'FAIL' }, { userId: 'u1', result: 'PASS' }, { userId: 'u2', result: 'PASS' },
    ])).toBe('PASS');
  });
});

// ── PLAN-001 通过率口径 ──

describe('planPassRate 口径（skipped 不计分母）', () => {
  it('空集 → null', () => {
    expect(planPassRate([]).passRate).toBeNull();
  });
  it('pass/(pass+fail+blocked)', () => {
    const r = planPassRate([{ status: 'PASS' }, { status: 'PASS' }, { status: 'FAIL' }]);
    expect(r.passRate).toBe(67);
    expect(r.executed).toBe(3);
  });
  it('skipped 不计分母；pending 只影响进度', () => {
    const r = planPassRate([{ status: 'PASS' }, { status: 'SKIPPED' }, { status: 'NOT_RUN' }, { status: 'BLOCKED' }]);
    expect(r.passRate).toBe(50);
    expect(r.pending).toBe(1);
    expect(r.skipped).toBe(1);
  });
  it('全 skipped → null（除零保护）', () => {
    expect(planPassRate([{ status: 'SKIPPED' }]).passRate).toBeNull();
  });
});

// ── CASE-003 Markdown 转义（防 XSS）──

describe('renderMarkdown 受限子集', () => {
  it('script 注入被转义', () => {
    const html = renderMarkdown('<script>alert(1)</script>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
  it('javascript: 链接被拒', () => {
    const html = renderMarkdown('[点我](javascript:alert(1))');
    expect(html).not.toContain('href="javascript');
  });
  it('https 链接保留 target=_blank', () => {
    const html = renderMarkdown('[官网](https://example.com)');
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('rel="noopener noreferrer"');
  });
  it('粗体/斜体/行内码/列表/表格', () => {
    expect(renderMarkdown('**b**')).toContain('<strong>b</strong>');
    expect(renderMarkdown('*i*')).toContain('<em>i</em>');
    expect(renderMarkdown('`c`')).toContain('<code>c</code>');
    expect(renderMarkdown('- a\n- b')).toContain('<ul>');
    expect(renderMarkdown('| a | b |\n|---|---|\n| 1 | 2 |')).toContain('<table>');
  });
  it('代码块', () => {
    expect(renderMarkdown('```\nconst a=1\n```')).toContain('<pre><code>');
  });
  it('escapeHtml 覆盖五类字符', () => {
    expect(escapeHtml(`<a href="x">&'`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
  });
  it('摘要提取', () => {
    expect(markdownExcerpt('**粗体** [链接](https://x.cn) 正文')).toBe('粗体 链接 正文');
  });
});

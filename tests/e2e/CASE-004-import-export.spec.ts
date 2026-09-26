import type { APIRequestContext } from '@playwright/test';
import { statSync } from 'node:fs';
import { test, expect, navFromHome } from './fixtures';

/**
 * 规格：docs/sprint-1-mvp-test-mgmt/CASE-004-excel-xmind-io.md §5（T2 主链路：导出 → 导入向导三步 → 覆盖模式报告）
 * 选择器来源（已核对源码）：
 * - apps/web/src/app/(console)/cases/page.tsx：btn-import / btn-export（工具栏）；导出 Modal（radio-export-format、
 *   okText=导出）；导入向导三步：import-step-upload（btn-download-template、Dragger 文件输入）→ import-step-mapping
 *   （radio-import-mode：相同编号跳过/覆盖）→ import-step-report（created+overwritten 计数 + 「导入成功」文案）；
 *   步骤按钮 = Modal okText（下一步/开始导入），step3 footer = 重新上传/完成
 * - 下载实现：caseIoApi.exportCases（fetch POST → blob）+ saveBlob（a[download] + blob URL）→ Playwright
 *   download 事件可捕获（Chromium 支持 blob 下载），保存后作为导入文件完成真实 roundtrip；
 *   模板下载（caseIoApi.template，GET，fetch blob）不走浏览器导航，用 expectApi 断言 200
 * - 上传入口：antd Dragger 的 input[type=file]（无角色/文本可用，限定在 import-step-upload 作用域内定位）
 * 数据隔离：authedPage 每用例独立项目，项目内仅 1 条自建用例（覆盖模式断言「记录数不变」的前提）。
 */

interface CaseRow {
  id: string; num: number; name: string;
}

async function apiCreateCase(
  request: APIRequestContext, projectId: string,
  body: { name: string; steps?: { desc: string; expect: string }[] },
): Promise<CaseRow> {
  const res = await request.post(`/api/v1/projects/${projectId}/cases`, {
    data: { precondition: '', level: 'P2', tags: [], fields: {}, ...body },
  });
  expect(res.status()).toBe(201);
  const json = (await res.json()) as { code: number; data: CaseRow };
  expect(json.code).toBe(0);
  return json.data;
}

test('CASE-004-01 导入向导三步', async ({ authedPage, page, request, expectNoConsoleErrors, expectApi }, testInfo) => {
  const uniq = `${Date.now() % 100000}`;
  const caseName = `导入导出用例${uniq}`;
  const kase = await apiCreateCase(request, authedPage.projectId, {
    name: caseName,
    steps: [{ desc: '打开登录页', expect: '登录表单可见' }],
  });
  expect(kase.num).toBeGreaterThan(0);

  // 用户路径：首页 → 左侧菜单「测试用例」
  await navFromHome(page, '测试用例');
  await expect(page.getByTestId('case-table')).toBeVisible();
  await expect(page.getByText(caseName)).toBeVisible();

  // ── 导出 Excel：接口 200 + 捕获浏览器下载保存（作为导入 roundtrip 文件） ──
  await page.getByTestId('btn-export').click();
  const exportDialog = page.getByRole('dialog');
  await expect(exportDialog.getByText('导出用例')).toBeVisible();
  const exportApi = expectApi('**/api/v1/projects/*/cases/export');
  const downloadPromise = page.waitForEvent('download');
  await exportDialog.getByRole('button', { name: '导出', exact: true }).click();
  const exported = await exportApi;
  // 接口断言：导出为 xlsx 二进制流（非 JSON 信封），断言状态码；内容正确性由下方导入 roundtrip 验证
  expect(exported.status).toBe(200);
  const download = await downloadPromise;
  const exportPath = testInfo.outputPath('case-export.xlsx');
  await download.saveAs(exportPath);
  expect(statSync(exportPath).size).toBeGreaterThan(0);
  // UI 断言：导出成功 toast + 弹窗关闭
  await expect(page.getByText('导出成功')).toBeVisible({ timeout: 8000 });
  await expect(page.getByText('导出用例')).toHaveCount(0);

  // ── 导入向导 步骤①：上传文件（含模板下载） ──
  await page.getByTestId('btn-import').click();
  await expect(page.getByTestId('import-step-upload')).toBeVisible();
  const importDialog = page.getByRole('dialog');
  // 模板下载：GET import/template（fetch blob，不走下载事件）→ 状态码 200
  const tplApi = expectApi('**/api/v1/projects/*/cases/import/template');
  await page.getByTestId('btn-download-template').click();
  const tpl = await tplApi;
  expect(tpl.status).toBe(200);
  // 上传导出的 xlsx（beforeUpload return false 仅暂存文件）
  await page.getByTestId('import-step-upload').locator('input[type="file"]').setInputFiles(exportPath);
  await importDialog.getByRole('button', { name: '下一步' }).click();

  // ── 步骤②：确认映射 → 相同编号覆盖 ──
  await expect(page.getByTestId('import-step-mapping')).toBeVisible();
  await expect(page.getByTestId('import-step-mapping').getByText(/文件：.*\.xlsx/)).toBeVisible(); // 文件名回显（导出文件名={项目名}-用例-{ts}.xlsx）
  await page.getByTestId('radio-import-mode').getByText('相同编号覆盖').click();

  // ── 步骤③：开始导入 → 结果报告 ──
  const importApi = expectApi('**/api/v1/projects/*/cases/import');
  await importDialog.getByRole('button', { name: '开始导入' }).click();
  const imported = await importApi;
  // 接口断言：POST import 200 + code=0 + 报告字段（覆盖 1 / 失败 0 / 模式 overwrite）
  expect(imported.status).toBe(200);
  expect(imported.code).toBe(0);
  const report = imported.data as {
    mode: string; total: number; created: number; overwritten: number; skipped: number; failed: number;
  };
  expect(report.mode).toBe('overwrite');
  expect(report.created + report.overwritten).toBe(1);
  expect(report.overwritten).toBe(1);
  expect(report.failed).toBe(0);
  // UI 断言：结果报告步骤 + 「导入成功」计数
  await expect(page.getByTestId('import-step-report')).toBeVisible();
  await expect(page.getByTestId('import-step-report').getByText('导入成功')).toBeVisible();

  // 完成 → 列表仍 1 条（覆盖不新增，记录数不变）
  await importDialog.getByRole('button', { name: '完成' }).click();
  await expect(page.getByTestId('case-table')).toBeVisible();
  await expect(page.getByText('共 1 条')).toBeVisible({ timeout: 8000 });
  await expect(page.getByText(caseName)).toHaveCount(1);

  await expectNoConsoleErrors();
});

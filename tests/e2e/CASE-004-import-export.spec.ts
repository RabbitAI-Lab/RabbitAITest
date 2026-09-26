import type { APIRequestContext } from "@playwright/test";
import { statSync } from "node:fs";
import { test, expect, navFromHome } from "./fixtures";

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
  id: string;
  num: number;
  name: string;
}

async function apiCreateCase(
  request: APIRequestContext,
  projectId: string,
  body: { name: string; steps?: { desc: string; expect: string }[] },
): Promise<CaseRow> {
  const res = await request.post(`/api/v1/projects/${projectId}/cases`, {
    data: { precondition: "", level: "P2", tags: [], fields: {}, ...body },
  });
  expect(res.status()).toBe(201);
  const json = (await res.json()) as { code: number; data: CaseRow };
  expect(json.code).toBe(0);
  return json.data;
}

test("CASE-004-01 导入向导三步", async ({
  authedPage,
  page,
  request,
  expectNoConsoleErrors,
  expectApi,
}, testInfo) => {
  const uniq = `${Date.now() % 100000}`;
  const caseName = `导入导出用例${uniq}`;
  const kase = await apiCreateCase(request, authedPage.projectId, {
    name: caseName,
    steps: [{ desc: "打开登录页", expect: "登录表单可见" }],
  });
  expect(kase.num).toBeGreaterThan(0);

  // 用户路径：首页 → 左侧菜单「测试用例」
  await navFromHome(page, "测试用例");
  await expect(page.getByTestId("case-table")).toBeVisible();
  await expect(page.getByText(caseName)).toBeVisible();

  // ── 导出 Excel：接口 200 + 捕获浏览器下载保存（作为导入 roundtrip 文件） ──
  await page.getByTestId("btn-export").click();
  const exportDialog = page.getByRole("dialog");
  await expect(exportDialog.getByText("导出用例")).toBeVisible();
  const exportApi = expectApi("**/api/v1/projects/*/cases/export");
  const downloadPromise = page.waitForEvent("download");
  // Modal okText=导出（2 字主按钮渲染「导 出」），正则兼容
  await exportDialog.getByRole("button", { name: /导\s*出/ }).click();
  const exported = await exportApi;
  // 接口断言：导出为 xlsx 二进制流（非 JSON 信封），断言状态码；内容正确性由下方导入 roundtrip 验证
  expect(exported.status).toBe(200);
  const download = await downloadPromise;
  const exportPath = testInfo.outputPath("case-export.xlsx");
  await download.saveAs(exportPath);
  expect(statSync(exportPath).size).toBeGreaterThan(0);
  // UI 断言：导出成功 toast + 弹窗关闭（antd 关闭后仍保留隐藏标题 DOM → 按可访问性 dialog 角色断言）
  await expect(page.getByText("导出成功")).toBeVisible({ timeout: 8000 });
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // ── 导入向导 步骤①：上传文件（含模板下载） ──
  await page.getByTestId("btn-import").click();
  await expect(page.getByTestId("import-step-upload")).toBeVisible();
  const importDialog = page.getByRole("dialog");
  // 模板下载：GET import/template（fetch blob，不走下载事件）→ 状态码 200
  const tplApi = expectApi("**/api/v1/projects/*/cases/import/template");
  await page.getByTestId("btn-download-template").click();
  const tpl = await tplApi;
  expect(tpl.status).toBe(200);
  // 上传导出的 xlsx（beforeUpload return false 仅暂存文件）
  await page
    .getByTestId("import-step-upload")
    .locator('input[type="file"]')
    .setInputFiles(exportPath);
  await importDialog.getByRole("button", { name: "下一步" }).click();

  // ── 步骤②：确认映射 → 相同编号覆盖 ──
  await expect(page.getByTestId("import-step-mapping")).toBeVisible();
  await expect(page.getByTestId("import-step-mapping").getByText(/文件：.*\.xlsx/)).toBeVisible(); // 文件名回显（导出文件名={项目名}-用例-{ts}.xlsx）
  await page.getByTestId("radio-import-mode").getByText("相同编号覆盖").click();

  // ── 步骤③：开始导入 → 结果报告 ──
  const importApi = expectApi("**/api/v1/projects/*/cases/import");
  await importDialog.getByRole("button", { name: "开始导入" }).click();
  const imported = await importApi;
  // 接口断言：POST import 200 + code=0 + 报告字段（覆盖 1 / 失败 0 / 模式 overwrite）
  expect(imported.status).toBe(200);
  expect(imported.code).toBe(0);
  const report = imported.data as {
    mode: string;
    total: number;
    created: number;
    overwritten: number;
    skipped: number;
    failed: number;
  };
  expect(report.mode).toBe("overwrite");
  expect(report.created + report.overwritten).toBe(1);
  expect(report.overwritten).toBe(1);
  expect(report.failed).toBe(0);
  // UI 断言：结果报告步骤 + 「导入成功」计数
  await expect(page.getByTestId("import-step-report")).toBeVisible();
  await expect(page.getByTestId("import-step-report").getByText("导入成功")).toBeVisible();

  // 完成 → 列表仍 1 条（覆盖不新增，记录数不变）；「完成」按钮 2 字渲染「完 成」
  await importDialog.getByRole("button", { name: /完\s*成/ }).click();
  await expect(page.getByTestId("case-table")).toBeVisible();
  // exact：排除导出弹窗 radio 文案「当前筛选结果（共 1 条）」的子串命中
  await expect(page.getByText("共 1 条", { exact: true })).toBeVisible({ timeout: 8000 });
  await expect(page.getByText(caseName)).toHaveCount(1);

  await expectNoConsoleErrors();
});

/** coverage-audit 回补：CASE-004 §1.2 行 1 子能力——校验报告（错误行号+原因）与「相同编号=跳过」策略（规格 §5 T2/T1
 *  声明的失败行与跳过路径从未落地；覆盖路径已由 CASE-004-01 覆盖）。
 *  期望值溯源规格 §2：全部行先校验后落库（fail-fast 原子：任一行失败→不产生半量导入）；跳过=按 num 匹配仅计数不动数据；
 *  §6「全量预检→原子落库」为实现口径（与基线半量成功不同，规格明示）。
 *  fixture：xlsx 由 exceljs（apps/web 依赖，pnpm workspace 符号链接）在用例内生成——rules/testing §3.5.2 fixture 一律自造。 */
test("CASE-004-02 导入失败行报告（原子不落库）与跳过模式", async ({
  authedPage,
  page,
  request,
  expectNoConsoleErrors,
  expectApi,
}, testInfo) => {
  const uniq = `${Date.now() % 100000}`;
  const pid = authedPage.projectId;

  // 生成导入文件①：3 个数据行，第 3 行（Excel 行号 4）等级非法
  const headers = ["ID", "所属模块", "用例名称", "前置条件", "步骤描述", "预期结果", "用例等级", "标签"];
  // 最小合法 xlsx（无压缩 zip：[Content_Types].xml + workbook + rels + sheet1，共享字符串内联）
  // 零三方依赖（exceljs 目录导入在 ESM 下不可用，rules/testing §3.5.2 fixture 自造）
  async function buildXlsx(rows: (string | number)[][]): Promise<string> {
    const { writeFileSync } = await import("node:fs");
    const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const cell = (v: string | number) =>
      typeof v === "number"
        ? `<c t="n"><v>${v}</v></c>`
        : `<c t="inlineStr"><is><t xml:space="preserve">${esc(String(v))}</t></is></c>`;
    const rowXml = rows
      .map((r, i) => `<row r="${i + 2}">${r.map((v, c) => `<c r="${String.fromCharCode(65 + c)}${i + 2}"${typeof v === "number" ? "" : ""}>${String(cell(v)).replace(/<c r="[A-Z]\d+"[^>]*>/, "<c>")}</c>`).join("")}</row>`)
      .join("");
    const sheet1 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1">${headers.map((h, c) => `<c r="${String.fromCharCode(65 + c)}1" t="inlineStr"><is><t>${h}</t></is></c>`).join("")}</row>${rowXml}</sheetData></worksheet>`;
    const content = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`;
    const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="用例" sheetId="1" r:id="rId1"/></sheets></workbook>`;
    const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`;
    const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
    const files: [string, string][] = [
      ["[Content_Types].xml", content],
      ["_rels/.rels", rootRels],
      ["xl/workbook.xml", workbook],
      ["xl/_rels/workbook.xml.rels", rels],
      ["xl/worksheets/sheet1.xml", sheet1],
    ];
    // 无压缩（store）zip：crc32 自实现
    const crcTable: number[] = [];
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0; }
    const crc32 = (buf: Buffer) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
    const chunks: Buffer[] = [];
    const central: Buffer[] = [];
    for (const [name, xml] of files) {
      const nameB = Buffer.from(name, "utf8");
      const data = Buffer.from(xml, "utf8");
      const crc = crc32(data);
      const off = chunks.reduce((n, b) => n + b.length, 0);
      const head = Buffer.alloc(30);
      head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(0, 6); head.writeUInt16LE(0, 8);
      head.writeUInt16LE(0, 10); head.writeUInt16LE(0, 12); head.writeUInt32LE(crc, 14);
      head.writeUInt32LE(data.length, 18); head.writeUInt32LE(data.length, 22); head.writeUInt16LE(nameB.length, 26);
      chunks.push(head, nameB, data);
      const ce = Buffer.alloc(46);
      ce.writeUInt32LE(0x02014b50, 0); ce.writeUInt16LE(20, 4); ce.writeUInt16LE(20, 6); ce.writeUInt32LE(crc, 16);
      ce.writeUInt32LE(data.length, 20); ce.writeUInt32LE(data.length, 24); ce.writeUInt16LE(nameB.length, 28);
      ce.writeUInt32LE(off, 42);
      central.push(ce, nameB);
    }
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
    end.writeUInt32LE(central.reduce((n, b) => n + b.length, 0), 12);
    end.writeUInt32LE(chunks.reduce((n, b) => n + b.length, 0), 16);
    const path = testInfo.outputPath(`import-${rows.length}-${uniq}.xlsx`);
    writeFileSync(path, Buffer.concat([...chunks, ...central, end]));
    return path;
  }

  // 用户路径：首页 → 测试用例
  await navFromHome(page, "测试用例");
  await expect(page.getByTestId("case-table")).toBeVisible();

  // ── ① 校验失败报告：2 合法 + 1 非法等级 → failed=1、created=0（原子）、行号明细 ──
  const badPath = await buildXlsx([
    [undefined, undefined, `合法甲${uniq}`, "", "步骤甲", "预期甲", "P1", ""],
    [undefined, undefined, `非法行${uniq}`, "", "", "", "P9", ""],
    [undefined, undefined, `合法乙${uniq}`, "", "", "", "", ""],
  ]);
  await page.getByTestId("btn-import").click();
  await expect(page.getByTestId("import-step-upload")).toBeVisible();
  const importDialog = page.getByRole("dialog");
  await page
    .getByTestId("import-step-upload")
    .locator('input[type="file"]')
    .setInputFiles(badPath);
  await importDialog.getByRole("button", { name: "下一步" }).click();
  await expect(page.getByTestId("import-step-mapping")).toBeVisible();
  // 默认模式=相同编号跳过（radio-import-mode useState("skip")）——本文件无同编号，模式不影响失败断言
  const badApi = expectApi("**/api/v1/projects/*/cases/import");
  await importDialog.getByRole("button", { name: "开始导入" }).click();
  const bad = await badApi;
  // 接口断言：failed=1、created=0（全量预检原子口径，规格 §6）、errors 行号=3（第 2 个数据行，表头为第 1 行）
  expect(bad.status).toBe(200);
  expect(bad.code).toBe(0);
  const report = bad.data as {
    total: number;
    created: number;
    failed: number;
    errors: { row: number; reason: string }[];
  };
  expect(report.total).toBe(3);
  expect(report.failed).toBe(1);
  expect(report.created).toBe(0);
  expect(report.errors).toHaveLength(1);
  expect(report.errors[0]!.row).toBe(3);
  expect(report.errors[0]!.reason).toContain("非法等级");
  // UI 断言：结果报告含「校验失败 1」与失败行明细表（行号 + 原因）
  const reportStep = page.getByTestId("import-step-report");
  await expect(reportStep).toBeVisible();
  await expect(reportStep.getByText("校验失败")).toBeVisible();
  await expect(reportStep.getByRole("cell", { name: "3", exact: true })).toBeVisible();
  await expect(reportStep.getByText(/非法等级/)).toBeVisible();
  await importDialog.getByRole("button", { name: /完\s*成/ }).click();
  // UI 断言：原子不落库——列表无任何导入行
  await expect(page.getByText(`合法甲${uniq}`)).toHaveCount(0);

  // ── ② 跳过模式：存量 num=1 + 导入同编号改名 → skipped=1、数据不动 ──
  const existing = await apiCreateCase(request, pid, { name: `存量用例${uniq}` });
  expect(existing.num).toBe(1);
  const skipPath = await buildXlsx([[1, undefined, `改名后${uniq}`, "", "", "", "P1", ""]]);
  await page.getByTestId("btn-import").click();
  await expect(page.getByTestId("import-step-upload")).toBeVisible();
  await page
    .getByTestId("import-step-upload")
    .locator('input[type="file"]')
    .setInputFiles(skipPath);
  await importDialog.getByRole("button", { name: "下一步" }).click();
  await expect(page.getByTestId("import-step-mapping")).toBeVisible();
  // 接口断言：跳过模式（默认 radio）+ skipped=1 / created=0 / overwritten=0
  const skipApi = expectApi("**/api/v1/projects/*/cases/import");
  await importDialog.getByRole("button", { name: "开始导入" }).click();
  const skipped = await skipApi;
  expect(skipped.status).toBe(200);
  const skipReport = skipped.data as {
    mode: string;
    created: number;
    overwritten: number;
    skipped: number;
    failed: number;
  };
  expect(skipReport.mode).toBe("skip");
  expect(skipReport.skipped).toBe(1);
  expect(skipReport.created).toBe(0);
  expect(skipReport.overwritten).toBe(0);
  expect(skipReport.failed).toBe(0);
  await expect(reportStep.getByText("跳过（编号已存在）").first()).toBeVisible();
  await importDialog.getByRole("button", { name: /完\s*成/ }).click();
  // UI 断言：跳过不动数据——列表仍为存量原名（改名行未生效）
  await expect(page.getByText(`存量用例${uniq}`)).toBeVisible();
  await expect(page.getByText(`改名后${uniq}`)).toHaveCount(0);

  await expectNoConsoleErrors();
});

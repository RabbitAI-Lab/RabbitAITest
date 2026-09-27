import { test, expect, navFromHome } from "./fixtures";
import { createEnv, emptyEnvConfig, ok } from "./s2-helpers";

/**
 * PROJ-003 环境管理（规格：docs/sprint-2-api-core/PROJ-003-environment.md）。
 * 覆盖：新建（变量/域名/HOST/数据源连接测试二态）→ 编辑回显 → 复制 → 导出 → 删除；
 * 导入同名覆盖 true/false 二态。
 * 三类断言：UI（env-list-table / env-tab-* / db-test-result）+ Console + 接口
 * （create/PUT payload、copy/export/import 覆盖计数）。
 */

test("PROJ-003-01 环境主链路：新建五区→连接测试失败态→保存→回显→复制→导出→删除", async ({
  authedPage,
  page,
  expectNoConsoleErrors,
  expectApi,
}) => {
  const { projectId } = authedPage;
  const uniq = `P3${Date.now() % 1e7}${Math.floor(Math.random() * 1e3)}`;
  const envName = `主链路环境-${uniq}`;

  // ── 用户路径：项目设置 → 环境管理 ──
  await navFromHome(page, "环境管理");
  await expect(page.getByTestId("env-list-table")).toBeVisible();

  // ── 新建（btn-new-env 创建后直接进编辑视图）；POST 断言按方法圈定（列表 GET 同 URL 竞态）──
  const createP = page.waitForResponse(
    (r) => /\/environments$/.test(r.url()) && r.request().method() === "POST",
  );
  await page.getByTestId("btn-new-env").click();
  const createdRes = await createP;
  expect(createdRes.status()).toBe(201);
  expect((((await createdRes.json()) as { code: number }).code)).toBe(0);
  await expect(page.getByTestId("input-env-name")).toBeVisible();
  await page.getByTestId("input-env-name").fill(envName);

  // ① 变量：base → mock 地址
  await expect(page.getByTestId("env-tab-vars")).toBeVisible();
  await page.getByTestId("btn-add-var").click();
  const varRow = page.getByTestId("env-vars-row").first();
  await varRow.locator('input[placeholder="key"]').fill("base");
  await varRow.locator('input[placeholder="value"]').fill("http://127.0.0.1:4000");

  // ② 域名卡：默认 → 127.0.0.1:4000
  await page.getByTestId("env-tab-http").click();
  await page.getByTestId("btn-add-http").click();
  const httpCard = page.getByTestId("env-http-card").first();
  await httpCard.locator('input[placeholder="名称"]').fill("默认");
  await httpCard.locator('input[placeholder="hostname"]').fill("127.0.0.1");
  await httpCard.locator(".ant-input-number input").first().fill("4000");
  await httpCard.locator('input[placeholder^="/前缀"]').fill("");

  // ③ HOST 行：petstore.example → 127.0.0.1
  await page.getByTestId("env-tab-hosts").click();
  await page.getByTestId("btn-add-host").click();
  const hostRow = page.getByTestId("env-hosts-row").first();
  await hostRow.locator('input[placeholder="host"]').fill("petstore.example");
  await hostRow.locator('input[placeholder="address"]').fill("127.0.0.1");

  // ④ 数据源：非法连接串 → 连接测试失败红字（二态：失败态；合法连接串依赖外部 DB，跳过）
  await page.getByTestId("env-tab-db").click();
  await page.getByTestId("btn-add-db").click();
  const dbCard = page.getByTestId("env-db-card").first();
  await dbCard.locator('input[placeholder="名称"]').fill("测试库");
  await dbCard.locator('input[placeholder^="postgresql://"]').fill("postgresql://no-such-user:x@127.0.0.1:59999/nodb");
  const testApi = expectApi("**/api/v1/projects/*/environments/test-datasource");
  await page.getByTestId("btn-db-test-1").click();
  const tested = await testApi;
  expect(tested.status).toBe(200);
  expect(tested.code).toBe(0);
  expect((tested.data as { ok: boolean }).ok).toBe(false);
  await expect(page.getByTestId("db-test-result-1")).toContainText("连接失败");

  // ── 保存（PUT payload 断言五区配置）──
  const saveApi = expectApi("**/api/v1/projects/*/environments/*");
  const saveRaw = page.waitForResponse(
    (r) => r.url().includes("/environments/") && !r.url().includes("test-datasource") && r.request().method() === "PUT",
  );
  await page.getByTestId("btn-save-env").click();
  const saved = await saveApi;
  expect(saved.status).toBe(200);
  expect(saved.code).toBe(0);
  const saveRawRes = await saveRaw;
  const savePayload = saveRawRes.request().postDataJSON() as {
    name: string;
    config: { vars: { key: string; value: string }[]; http: { hostname: string; port: number }[]; hosts: { host: string }[]; database: { url: string }[] };
  };
  expect(savePayload.name).toBe(envName);
  expect(savePayload.config.vars).toContainEqual({ key: "base", value: "http://127.0.0.1:4000", enabled: true });
  expect(savePayload.config.http[0]).toMatchObject({ hostname: "127.0.0.1", port: 4000 });
  expect(savePayload.config.hosts[0]).toMatchObject({ host: "petstore.example", address: "127.0.0.1" });
  expect(savePayload.config.database[0].url).toContain("59999");
  await expect(page.getByText("环境已保存")).toBeVisible();

  // ── 列表行 +1 → 编辑回显 ──
  await expect(page.getByTestId("env-list-table").getByText(envName)).toBeVisible();
  await page.getByTestId("env-list-table").getByText(envName).click();
  await expect(page.getByTestId("input-env-name")).toHaveValue(envName);
  await expect(page.getByTestId("env-tab-vars")).toContainText("① 变量（1）");
  await expect(page.getByTestId("env-vars-row").first().locator('input[placeholder="key"]')).toHaveValue("base");
  await page.getByTestId("env-tab-db").click();
  await expect(page.getByTestId("env-db-card").first().locator('input[placeholder^="postgresql://"]')).toHaveValue(
    "postgresql://no-such-user:x@127.0.0.1:59999/nodb",
  );

  // ── 复制 → 副本（xxx_copy）──
  await page.getByRole("button", { name: /返\s*回列表/ }).click();
  const copyRow = page.getByTestId("env-list-table").getByRole("row", { name: new RegExp(envName) });
  const copyApi = expectApi("**/api/v1/projects/*/environments/*/copy");
  await copyRow.getByRole("button", { name: /复\s*制/ }).click();
  const copied = await copyApi;
  expect(copied.status).toBe(201);
  expect(copied.code).toBe(0);
  await expect(page.getByText("已复制为副本（xxx_copy）")).toBeVisible();
  await expect(page.getByTestId("env-list-table").getByText(`${envName}_copy`)).toBeVisible();

  // ── 导出（UI 点击触发下载；内容断言经 page.request 直发）──
  await copyRow.first().getByRole("button", { name: /导\s*出/ }).click();
  const list = await page.request.get(`/api/v1/projects/${projectId}/environments`);
  const envId = (await ok<{ items: { name: string; id: string }[] }>(list)).items.find(
    (e) => e.name === envName,
  )!.id;
  const exportResp = await page.request.get(`/api/v1/projects/${projectId}/environments/${envId}/export`);
  expect(exportResp.status()).toBe(200);
  const expText = await exportResp.text();
  expect(expText).toContain(envName);
  expect(expText).toContain('"base"');

  // ── 删除（软删）→ 原环境行消失（_copy 副本仍在；按精确名区分）──
  const exactNameRow = page
    .getByTestId("env-list-table")
    .getByRole("row")
    .filter({ hasText: new RegExp(`${envName}(?!_)`) });
  const delApi = expectApi("**/api/v1/projects/*/environments/*");
  await exactNameRow.first().getByRole("button", { name: /删\s*除/ }).click();
  await page.locator(".ant-popover").getByRole("button", { name: /确\s*定|删\s*除/ }).click();
  const removed = await delApi;
  expect(removed.status).toBe(200);
  expect(removed.code).toBe(0);
  await expect(page.getByText("环境已删除")).toBeVisible();
  await expect(page.getByTestId("env-list-table").getByText(envName, { exact: true })).toHaveCount(0, { timeout: 10000 });
  await expect(page.getByTestId("env-list-table").getByText(`${envName}_copy`)).toBeVisible();

  await expectNoConsoleErrors();
});

test("PROJ-003-02 导入二态：同名覆盖=false 跳过 / =true 覆盖", async ({
  authedPage,
  page,
  expectNoConsoleErrors,
  expectApi,
}) => {
  const { projectId } = authedPage;
  const uniq = `Q3${Date.now() % 1e7}${Math.floor(Math.random() * 1e3)}`;
  const envName = `导入目标环境-${uniq}`;

  // 已存在同名环境（API 造）
  await createEnv(page.request, projectId, envName);
  const importPayload = JSON.stringify([
    {
      name: envName,
      config: { ...emptyEnvConfig(), vars: [{ key: "imported", value: "1", enabled: true }] },
    },
  ]);

  await navFromHome(page, "环境管理");
  await expect(page.getByTestId("env-list-table").getByText(envName)).toBeVisible();

  // ── 覆盖=false：同名跳过 ──
  await page.getByTestId("btn-import-env").click();
  await page.getByTestId("import-env-textarea").fill(importPayload);
  const importApi1 = expectApi("**/api/v1/projects/*/environments/import");
  const importRaw1 = page.waitForResponse("**/api/v1/projects/*/environments/import");
  await page.getByRole("button", { name: /开始导入/ }).click();
  const imported1 = await importApi1;
  expect(imported1.status).toBe(200);
  expect(imported1.code).toBe(0);
  const data1 = imported1.data as { imported: number; overwritten: number; skipped: number };
  expect(data1).toMatchObject({ imported: 0, overwritten: 0, skipped: 1 });
  const raw1 = await importRaw1;
  expect((raw1.request().postDataJSON() as { overwrite: boolean }).overwrite).toBe(false);
  await expect(page.getByText("导入完成：导入 0 · 覆盖 0 · 跳过 1")).toBeVisible();

  // ── 覆盖=true：同名覆盖（version 重置，变量更新）──
  await page.getByTestId("btn-import-env").click();
  await page.getByTestId("import-env-textarea").fill(importPayload);
  await page.getByTestId("import-env-overwrite").click();
  const importApi2 = expectApi("**/api/v1/projects/*/environments/import");
  const importRaw2 = page.waitForResponse("**/api/v1/projects/*/environments/import");
  await page.getByRole("button", { name: /开始导入/ }).click();
  const imported2 = await importApi2;
  expect(imported2.code).toBe(0);
  expect((imported2.data as { overwritten: number }).overwritten).toBe(1);
  const raw2 = await importRaw2;
  expect((raw2.request().postDataJSON() as { overwrite: boolean }).overwrite).toBe(true);
  await expect(page.getByText("导入完成：导入 0 · 覆盖 1 · 跳过 0")).toBeVisible();

  // 覆盖生效（接口断言）：变量变为导入内容
  const list = await page.request.get(`/api/v1/projects/${projectId}/environments`);
  const items = (await ok<{ items: { name: string; config: { vars: { key: string }[] } }[] }>(list)).items;
  const target = items.find((e) => e.name === envName);
  expect(target?.config.vars.map((v) => v.key)).toContain("imported");

  await expectNoConsoleErrors();
});

import { test, expect, navFromHome } from "./fixtures";
import {
  bundle,
  createApiDef,
  createEnv,
  createMockRule,
  MOCK_BASE,
  pickOption,
  projectNum,
  updateApiDef,
  type BundleLike,
} from "./s2-helpers";

/**
 * API-002 接口定义（规格：docs/sprint-2-api-core/API-002-api-definition.md）。
 * 三类断言（rules/testing.md §3.1）：
 * - UI：新建 Modal / api-list-table 行 / 详情头部与七区编辑器 / import-report / 状态两态
 * - Console：expectNoConsoleErrors
 * - 接口：expectApi + waitForResponse payload（create PUT debug changes import list）
 */

test("API-002-01 定义主链路：新建→参数体系→环境执行→保存→变更历史", async ({
  authedPage,
  page,
  expectNoConsoleErrors,
  expectApi,
}) => {
  const { projectId } = authedPage;
  const uniq = `A2${Date.now() % 1e7}${Math.floor(Math.random() * 1e3)}`;
  const apiName = `宠物查询-${uniq}`;
  // 数据准备（旁路 API，页面挂载前）：环境 base → mock 命名空间（EnvSelect 列表进入页面前就绪）
  const envName = `执行环境-${uniq}`;
  const base = `${MOCK_BASE}/mock/${await projectNum(page.request, projectId)}`;
  const envId = await createEnv(page.request, projectId, envName, [{ key: "base", value: base }]);

  // ── 1. 用户路径：首页 → 接口定义 → 新建接口（Modal：名称/POST//pets）──
  await navFromHome(page, "接口定义");
  await expect(page.getByTestId("api-list-table")).toBeVisible();
  await page.getByTestId("btn-new-api").click();
  await expect(page.getByTestId("input-new-name")).toBeVisible();
  await page.getByTestId("input-new-name").fill(apiName);
  await expect(page.getByTestId("select-new-method")).toBeVisible({ timeout: 10000 });
  await pickOption(page, page.getByTestId("select-new-method"), "POST");
  await page.getByTestId("input-new-path").fill("/pets");

  const createApi = expectApi("**/api/v1/projects/*/apis");
  const createRaw = page.waitForResponse("**/api/v1/projects/*/apis");
  await page.getByRole("button", { name: /创建并编辑/ }).click();
  const created = await createApi;
  expect(created.status).toBe(201);
  expect(created.code).toBe(0);
  const createdRaw = await createRaw;
  expect(createdRaw.request().method()).toBe("POST");
  const createPayload = createdRaw.request().postDataJSON() as {
    name: string;
    request: { spec: { method: string; url: string } };
  };
  expect(createPayload.name).toBe(apiName);
  expect(createPayload.request.spec.method).toBe("POST");
  expect(createPayload.request.spec.url).toBe("/pets");

  // 列表行出现（用户路径内路由跳转进详情）
  await expect(page).toHaveURL(/\/apis\//, { timeout: 10000 });
  await expect(page.getByTestId("input-api-name")).toHaveValue(apiName);
  await expect(page.getByTestId("input-api-path")).toHaveValue("/pets");

  // ── 2. API 页签编辑：Query 参数 + body raw_json + 断言（状态码 200）──
  await page.getByTestId("req-tab-params").click();
  await expect(page.getByTestId("req-panel-params")).toBeVisible();
  await page.getByTestId("req-query-rows").getByText("＋ 添加").click();
  const qRow = page.getByTestId("req-query-row").first();
  await qRow.locator('input[placeholder="key"]').fill("verbose");
  await qRow.locator('input[placeholder^="value"]').fill("true");

  await page.getByTestId("req-tab-body").click();
  await expect(page.getByTestId("req-panel-body")).toBeVisible();
  await page.getByTestId("req-panel-body").getByText("json", { exact: true }).click();
  await page.getByTestId("req-panel-body").locator("textarea").last().fill('{"name": "rex"}');

  await page.getByTestId("req-tab-asserts").click();
  await page.getByTestId("req-panel-asserts").getByRole("button", { name: "＋ 添加断言" }).click();
  await expect(page.getByTestId("req-panel-asserts").getByTestId("assert-row")).toHaveCount(1);

  // ── 3. 数据准备（旁路 API，不占用户路径镜头）：Mock 规则（环境已在用例开头建好）──
  const apiId = page.url().split("/").pop()!;
  await createMockRule(page.request, projectId, apiId, {
    name: `新建默认规则-${uniq}`,
    respBody: '{"code":0,"data":{"id":1,"name":"rex"}}',
  });

  // ── 4. 保存（PUT v2，payload 含 query/body）→ 选环境执行（UI）──
  await page.getByTestId("input-api-path").fill("${base}/pets");
  await pickOption(page, page.getByTestId("env-select"), envName);

  const saveApi = expectApi("**/api/v1/projects/*/apis/*");
  const saveRaw = page.waitForResponse(
    (r) => r.url().includes("/apis/") && r.request().method() === "PUT",
  );
  await page.getByTestId("btn-save-api").click();
  const saved = await saveApi;
  expect(saved.status).toBe(200);
  expect(saved.code).toBe(0);
  const saveRawRes = await saveRaw;
  const savePayload = saveRawRes.request().postDataJSON() as {
    version: number;
    request: BundleLike;
  };
  expect(savePayload.version).toBe(1);
  expect(savePayload.request.spec.query.map((q) => q.key)).toContain("verbose");
  expect(savePayload.request.spec.body).toMatchObject({
    kind: "raw_json",
    content: '{"name": "rex"}',
  });
  await expect(page.getByText(/已保存（v2）/)).toBeVisible();

  const debugApi = expectApi("**/api/v1/projects/*/apis/*/debug");
  const debugRaw = page.waitForResponse("**/api/v1/projects/*/apis/*/debug");
  await page.getByTestId("btn-exec-api").click();
  const debugged = await debugApi;
  expect(debugged.status).toBe(201);
  expect(debugged.code).toBe(0);
  const debugRawRes = await debugRaw;
  const debugPayload = debugRawRes.request().postDataJSON() as {
    envId: string;
    request: {
      spec: { url: string; query: { key: string }[]; body: { kind: string; content: string } };
    };
  };
  expect(debugPayload.envId).toBe(envId);
  expect(debugPayload.request.spec.url).toBe("${base}/pets");
  expect(debugPayload.request.spec.query.map((q) => q.key)).toContain("verbose");
  expect(debugPayload.request.spec.body).toMatchObject({
    kind: "raw_json",
    content: '{"name": "rex"}',
  });

  // ── 5. 报告页：SUCCESS（POST /pets 命中 mock 规则 200）──
  await expect(page).toHaveURL(/\/reports\//, { timeout: 15000 });
  await expect(page.getByTestId("report-status")).toHaveText("SUCCESS", { timeout: 30000 });
  // UI 断言：单请求视图展示提交的 URL 与请求体（渲染后实际 URL 在 api_case 钻取视图，见 API-003-01）
  await expect(page.getByTestId("report-request")).toContainText("${base}/pets");
  await expect(page.getByTestId("report-request")).toContainText('{"name": "rex"}');
  await expect(page.getByTestId("assert-pass").first()).toBeVisible();

  // ── 6. 返回详情 → 变更历史可见（创建 + 更新 v2）──
  await navFromHome(page, "接口定义");
  await page.getByRole("link", { name: apiName }).click();
  await expect(page.getByTestId("input-api-name")).toHaveValue(apiName);
  await expect(page.getByText("当前版本 v2")).toBeVisible();

  // 变更历史抽屉：创建 + 更新 两条记录
  const changesApi = expectApi("**/api/v1/projects/*/apis/*/changes");
  await page.getByTestId("btn-api-changes").click();
  const changes = await changesApi;
  expect(changes.status).toBe(200);
  expect(changes.code).toBe(0);
  expect((changes.data as { items: unknown[] }).items.length).toBeGreaterThanOrEqual(2);
  await expect(page.locator(".ant-drawer-title").filter({ hasText: "变更历史" })).toBeVisible();
  const changesDrawer = page.locator(".ant-drawer-content");
  await expect(changesDrawer.getByText("创建").first()).toBeVisible();
  await expect(changesDrawer.getByText("更新").first()).toBeVisible();

  await expectNoConsoleErrors();
});

test("API-002-02 导入：OpenAPI3 粘贴导入新增 2 → 覆盖导入计数与 payload.overwrite", async ({
  authedPage,
  page,
  expectNoConsoleErrors,
  expectApi,
}) => {
  const uniq = `I2${Date.now() % 1e7}${Math.floor(Math.random() * 1e3)}`;
  const openapi = JSON.stringify({
    openapi: "3.0.0",
    info: { title: `导入-${uniq}`, version: "1.0.0" },
    paths: {
      [`/imp-a-${uniq}`]: { get: { summary: `导入接口A-${uniq}` } },
      [`/imp-b-${uniq}`]: { post: { summary: `导入接口B-${uniq}` } },
    },
  });

  await navFromHome(page, "接口定义");
  await expect(page.getByTestId("api-list-table")).toBeVisible();

  // ── 第一次导入（覆盖=false）：新增 2 ──
  await page.getByTestId("btn-import-api").click();
  await expect(page.getByTestId("input-import-content")).toBeVisible();
  await page.getByTestId("input-import-content").fill(openapi);
  const importApi1 = expectApi("**/api/v1/projects/*/apis/import");
  const importRaw1 = page.waitForResponse("**/api/v1/projects/*/apis/import");
  await page.getByRole("button", { name: /开始导入/ }).click();
  const imported1 = await importApi1;
  expect(imported1.status).toBe(200);
  expect(imported1.code).toBe(0);
  expect((imported1.data as { created: string[] }).created).toHaveLength(2);
  const raw1 = await importRaw1;
  const payload1 = raw1.request().postDataJSON() as {
    format: string;
    overwrite: boolean;
    source: { content: string };
  };
  expect(payload1.format).toBe("openapi3");
  expect(payload1.overwrite).toBe(false);
  expect(payload1.source.content).toContain(`/imp-a-${uniq}`);

  // UI 断言：校验报告弹窗「新增 2」
  await expect(page.getByTestId("import-report")).toBeVisible();
  await expect(page.getByTestId("import-report")).toContainText("新增");
  await expect(page.getByTestId("import-report").locator(".text-2xl").first()).toHaveText("2");
  await page.getByRole("button", { name: /完\s*成/ }).click();

  // 列表出现导入行
  await expect(page.getByRole("row", { name: new RegExp(`导入接口A-${uniq}`) })).toBeVisible();

  // ── 第二次导入（覆盖=true）：覆盖 2 ──
  await page.getByTestId("btn-import-api").click();
  await page.getByTestId("input-import-content").fill(openapi);
  await page.getByTestId("switch-import-overwrite").click();
  const importApi2 = expectApi("**/api/v1/projects/*/apis/import");
  const importRaw2 = page.waitForResponse("**/api/v1/projects/*/apis/import");
  await page.getByRole("button", { name: /开始导入/ }).click();
  const imported2 = await importApi2;
  expect(imported2.code).toBe(0);
  expect((imported2.data as { overwritten: string[] }).overwritten).toHaveLength(2);
  const raw2 = await importRaw2;
  expect((raw2.request().postDataJSON() as { overwrite: boolean }).overwrite).toBe(true);
  // UI 断言：覆盖计数 2
  await expect(page.getByTestId("import-report")).toBeVisible();
  await expect(page.getByTestId("import-report").locator(".text-2xl").nth(1)).toHaveText("2");
  await page.getByRole("button", { name: /完\s*成/ }).click();

  await expectNoConsoleErrors();
});

test("API-002-03 状态二态：DEBUG/RELEASED 筛选与状态列两态呈现", async ({
  authedPage,
  page,
  request,
  expectNoConsoleErrors,
}) => {
  const { projectId } = authedPage;
  const uniq = `S2${Date.now() % 1e7}${Math.floor(Math.random() * 1e3)}`;
  const debugName = `调试态接口-${uniq}`;
  const releasedName = `发布态接口-${uniq}`;

  // API 造数据：一条 DEBUG（默认）、一条 PUT 为 RELEASED
  const a = await createApiDef(request, projectId, { name: debugName, path: `/dbg-${uniq}` });
  const b = await createApiDef(request, projectId, { name: releasedName, path: `/rel-${uniq}` });
  await updateApiDef(request, projectId, b.id, { status: "RELEASED" });

  await navFromHome(page, "接口定义");
  await expect(page.getByTestId("api-list-table")).toBeVisible();
  // 关键字收敛到本用例两条
  await page.getByTestId("input-keyword").fill(uniq);
  await page.getByTestId("input-keyword").press("Enter");
  const rows = page
    .getByTestId("api-list-table")
    .locator(".ant-table-tbody tr")
    .filter({ hasText: uniq });
  await expect(rows).toHaveCount(2);

  // 状态列两态呈现：调试中（蓝）/ 已发布（绿）
  await expect(rows.filter({ hasText: debugName }).getByText("调试中")).toBeVisible();
  await expect(rows.filter({ hasText: releasedName }).getByText("已发布")).toBeVisible();

  // 筛选 DEBUG → 仅剩调试行；接口断言 list query 带 status=DEBUG
  const listDebug = page.waitForResponse(
    (r) => r.url().includes("/apis?") && r.url().includes("status=DEBUG"),
  );
  await page.getByTestId("select-status").click();
  await page
    .locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden)")
    .getByText("调试中", { exact: true })
    .click();
  const debugResp = await listDebug;
  expect(debugResp.status()).toBe(200);
  await expect(rows.filter({ hasText: debugName })).toHaveCount(1);
  await expect(rows.filter({ hasText: releasedName })).toHaveCount(0);

  // 切 RELEASED → 仅剩发布行
  const listRel = page.waitForResponse(
    (r) => r.url().includes("/apis?") && r.url().includes("status=RELEASED"),
  );
  await page.getByTestId("select-status").click();
  await page
    .locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden)")
    .getByText("已发布", { exact: true })
    .click();
  const relResp = await listRel;
  expect(relResp.status()).toBe(200);
  await expect(rows.filter({ hasText: releasedName })).toHaveCount(1);
  await expect(rows.filter({ hasText: debugName })).toHaveCount(0);

  await expectNoConsoleErrors();
});

/** 补充：行内「执行」入口（列表页快捷调试，API-002 §1.2 能力行）——debug 后跳报告 */
test("API-002-04 列表行内执行：以已保存定义快捷调试并跳转报告", async ({
  authedPage,
  page,
  request,
  expectNoConsoleErrors,
  expectApi,
}) => {
  const { projectId } = authedPage;
  const uniq = `E2${Date.now() % 1e7}${Math.floor(Math.random() * 1e3)}`;
  const name = `行内执行接口-${uniq}`;
  await createApiDef(request, projectId, {
    name,
    path: `/inline-${uniq}`,
    request: bundle("GET", "http://127.0.0.1:4001/hello"),
  });

  await navFromHome(page, "接口定义");
  const row = page.getByRole("row", { name: new RegExp(name) });
  await expect(row).toBeVisible();
  const debugApi = expectApi("**/api/v1/projects/*/apis/*/debug");
  await row.getByTestId("btn-exec-api-1").click();
  const debugged = await debugApi;
  expect(debugged.status).toBe(201);
  expect(debugged.code).toBe(0);
  await expect(page).toHaveURL(/\/reports\//, { timeout: 15000 });
  await expect(page.getByTestId("report-status")).toHaveText("SUCCESS", { timeout: 30000 });
  await expectNoConsoleErrors();
});

/** 门禁 8 回补（API-002 §5 T4 权限半区 + 验收标准 8）：仅 PROJECT_API:READ 的受限成员
 *  接口定义只读——列表可见、新建按钮隐藏、直发创建 403 code 10003（与 SYS-004-05 同款自降权法：
 *  退出「项目管理员」预置组 → 剩余生效权限=组织管理员只读集，含 PROJECT_API:READ 无 CREATE）。 */
test("API-002-05 受限成员（仅 PROJECT_API:READ）：列表可见、新建按钮隐藏、直发 POST 403", async ({
  authedPage,
  page,
  request,
  expectNoConsoleErrors,
}) => {
  const pid = authedPage.projectId;
  const meRes = await request.get("/api/v1/personal/me");
  const me = (await meRes.json()) as { data: { userId: string } };
  const groupsRes = await request.get(`/api/v1/projects/${pid}/groups`);
  const groups = (await groupsRes.json()) as { data: { id: string; name: string }[] };
  const adminGroup = groups.data.find((g) => g.name === "项目管理员");
  expect(adminGroup, "项目预置组「项目管理员」应存在").toBeTruthy();

  // 自降权：移出「项目管理员」
  const leave = await request.delete(
    `/api/v1/projects/${pid}/groups/${adminGroup!.id}/members/${me.data.userId}`,
  );
  expect(leave.status()).toBe(200);

  // UI 断言：接口定义列表可见（READ 保留），「新建接口」隐藏（CREATE 缺失）
  await navFromHome(page, "接口定义");
  await expect(page.getByTestId("api-list-table")).toBeVisible();
  await expect(page.getByTestId("btn-new-api")).toHaveCount(0);

  // 接口断言：受限会话直发创建定义 → 403 code 10003
  const post = await page.request.post(`/api/v1/projects/${pid}/apis`, {
    data: { name: "受限成员不应能创建", path: "/denied" },
  });
  expect(post.status()).toBe(403);
  expect(((await post.json()) as { code: number }).code).toBe(10003);

  // 二态回补：重新入组 → 新建按钮恢复
  const rejoin = await page.request.post(
    `/api/v1/projects/${pid}/groups/${adminGroup!.id}/members`,
    { data: { userIds: [me.data.userId] } },
  );
  expect(rejoin.status()).toBe(200);
  await page.reload();
  await expect(page.getByTestId("api-list-table")).toBeVisible();
  await expect(page.getByTestId("btn-new-api")).toBeVisible();

  await expectNoConsoleErrors();
});

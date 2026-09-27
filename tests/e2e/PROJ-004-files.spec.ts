import { test, expect, navFromHome } from "./fixtures";
import { bundle, createApiDef, getMockUrl, ok, pickOption, pollTask } from "./s2-helpers";

/**
 * PROJ-004 文件管理（规格：docs/sprint-2-api-core/PROJ-004-file-management.md）。
 * 覆盖：CSV/JAR 上传、JAR 开关二态（非 JAR 行无开关）、下载字节、移动模块、关键字过滤；
 * .exe 拒收二态（422 + Toast）。
 * 三类断言：UI（file-list-table / jar-switch-{id}）+ Console（422 白名单显式登记）
 * + 接口（上传 201、PUT jarEnabled payload、下载 200 字节）。
 */

const CSV_CONTENT = "id,name,level\n1,登录成功,P0\n2,支付失败,P1\n";

test("PROJ-004-01 文件主链路：上传 CSV/JAR→JAR 开关二态→下载→移动模块→过滤", async ({
  authedPage,
  page,
  expectNoConsoleErrors,
}) => {
  const { projectId } = authedPage;
  const uniq = `F4${Date.now() % 1e7}${Math.floor(Math.random() * 1e3)}`;
  const csvName = `测试数据-${uniq}.csv`;
  const jarName = `驱动插件-${uniq}.jar`;
  const moduleName = `文件子模块-${uniq}`;

  // 数据准备：file 场景子模块（API）
  const modRes = await page.request.post(`/api/v1/projects/${projectId}/modules?scene=file`, {
    data: { name: moduleName },
  });
  expect(modRes.status()).toBe(201);

  // ── 用户路径：文件管理 → 上传 CSV ──
  await navFromHome(page, "文件管理");
  await expect(page.getByTestId("file-list-table")).toBeVisible();
  const uploadPost = () =>
    page.waitForResponse((r) => /\/files(\?|$)/.test(r.url()) && r.request().method() === "POST");
  const csvUploadP = uploadPost();
  await page.getByTestId("file-upload").locator("input[type=file]").setInputFiles({
    name: csvName,
    mimeType: "text/csv",
    buffer: Buffer.from(CSV_CONTENT, "utf8"),
  });
  const uploadedCsv = await csvUploadP;
  expect(uploadedCsv.status()).toBe(201);
  await expect(page.getByText(`${csvName} 上传成功`)).toBeVisible();

  const csvRow = page.getByTestId("file-list-table").getByRole("row", { name: new RegExp(csvName) });
  await expect(csvRow).toBeVisible();
  await expect(csvRow).toContainText("B"); // 大小列展示（字节文本）

  // ── 上传 JAR（伪 zip 头）→ jar 行开关可切 ──
  const jarUploadP = uploadPost();
  await page.getByTestId("file-upload").locator("input[type=file]").setInputFiles({
    name: jarName,
    mimeType: "application/java-archive",
    buffer: Buffer.concat([Buffer.from("PK\x03\x04", "binary"), Buffer.from("fake-jar-payload-" + uniq)]),
  });
  await jarUploadP;
  await expect(page.getByText(`${jarName} 上传成功`)).toBeVisible();

  const listRes = await page.request.get(`/api/v1/projects/${projectId}/files?keyword=${encodeURIComponent(uniq)}`);
  const files = (await ok<{ items: { id: string; name: string; isJar: boolean; size: number }[] }>(listRes)).items;
  const csv = files.find((f) => f.name === csvName)!;
  const jar = files.find((f) => f.name === jarName)!;
  expect(jar.isJar).toBe(true);
  expect(csv.isJar).toBe(false);

  // 二态：jar 行有开关、csv 行无开关
  const jarRow = page.getByTestId("file-list-table").getByRole("row", { name: new RegExp(jarName) });
  await expect(page.getByTestId(`jar-switch-${jar.id}`)).toBeVisible();
  await expect(csvRow.locator(".ant-switch")).toHaveCount(0);

  // JAR 开关切换（默认禁用 → 启用）：PUT payload jarEnabled=true
  const jarPut = page.waitForResponse((r) => r.url().endsWith(`/files/${jar.id}`) && r.request().method() === "PUT");
  await page.getByTestId(`jar-switch-${jar.id}`).click();
  const jarPutRes = await jarPut;
  expect(jarPutRes.status()).toBe(200);
  expect((jarPutRes.request().postDataJSON() as { jarEnabled: boolean }).jarEnabled).toBe(true);
  await expect(page.getByText("JAR 已启用：项目内前后置脚本可引用")).toBeVisible();

  // ── 下载（request 断言字节一致）──
  const dl = await page.request.get(`/api/v1/projects/${projectId}/files/${csv.id}/download`);
  expect(dl.status()).toBe(200);
  expect(await dl.text()).toBe(CSV_CONTENT);

  // ── 移动模块（CSV → 子模块）──
  const movePut = page.waitForResponse((r) => r.url().endsWith(`/files/${csv.id}`) && r.request().method() === "PUT");
  await csvRow.getByRole("button", { name: /移\s*动/ }).click();
  await page.getByTestId("select-move-module").click();
  await page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden)").getByText(moduleName).click();
  await page.getByRole("button", { name: /确\s*定/ }).click();
  const moveRes = await movePut;
  expect(moveRes.status()).toBe(200);
  expect((moveRes.request().postDataJSON() as { moduleId: string }).moduleId).toBeTruthy();
  await expect(page.getByText("已移动")).toBeVisible();
  await expect(csvRow).toContainText(moduleName);

  // ── 按模块过滤（模块树选子模块 → 仅 CSV 行）──
  await page.getByTestId(`module-node-${moduleName}`).click();
  await expect(page.getByTestId("file-list-table").getByRole("row", { name: new RegExp(csvName) })).toBeVisible();
  await expect(page.getByTestId("file-list-table").getByRole("row", { name: new RegExp(jarName) })).toHaveCount(0);

  // ── 关键字过滤（再点同节点取消选中回全部 → 搜 jar 名只剩 jar 行）──
  await page.getByTestId(`module-node-${moduleName}`).click();
  await page.getByTestId("file-filter-keyword").fill(jarName);
  await page.getByTestId("file-filter-keyword").press("Enter");
  await expect(page.getByTestId("file-list-table").getByRole("row", { name: new RegExp(jarName) })).toBeVisible();
  await expect(page.getByTestId("file-list-table").getByRole("row", { name: new RegExp(csvName) })).toHaveCount(0);

  await expectNoConsoleErrors();
});

test("PROJ-004-02 拒收二态：.exe 上传 422 + 错误文案透出", async ({
  authedPage,
  page,
  expectNoConsoleErrors,
}) => {
  const uniq = `X4${Date.now() % 1e7}${Math.floor(Math.random() * 1e3)}`;
  const exeName = `恶意脚本-${uniq}.exe`;

  await navFromHome(page, "文件管理");
  await expect(page.getByTestId("file-list-table")).toBeVisible();

  const blockedP = page.waitForResponse(
    (r) => /\/files(\?|$)/.test(r.url()) && r.request().method() === "POST",
  );
  await page.getByTestId("file-upload").locator("input[type=file]").setInputFiles({
    name: exeName,
    mimeType: "application/x-msdownload",
    buffer: Buffer.from("MZ fake exe", "utf8"),
  });
  const blocked = await blockedP;
  expect(blocked.status()).toBe(422);
  await expect(page.getByText("不支持的文件类型")).toBeVisible();

  // 列表不出现该文件
  await expect(page.getByTestId("file-list-table").getByText(exeName)).toHaveCount(0);

  // 白名单：黑名单 422 为预期业务拒绝（UI fetch 失败留痕，rules/testing §3.5.1 显式登记）
  await expectNoConsoleErrors([
    {
      pageUrlPattern: "/files",
      textPattern: "(\\[http 422\\]|status of 422)",
      reason: "PROJ-004-02 可执行文件拒收的预期 422（类型白名单）",
    },
  ]);
});

/** 门禁 8 回补（PROJ-004 §5 T3 后半）：form_data 引用文件执行——引擎拉取文件字节组装 multipart，
 *  mock 规则以内容标记（bodyContains=唯一 marker）匹配，证明文件内容真实送达；
 *  二态：带文件行 → 命中 200（断言过、任务 SUCCESS）；缺文件行（同 key 纯文本）→ 未命中 404（断言败、FAILED）。
 *  勘误登记（§8）：断言口径由「文件名回显」改为「内容标记命中」——Mock 无请求回显模板，
 *  标记法证明力更强（内容级而非文件名级）。 */
test("PROJ-004-03 form_data 引用文件执行：mock 按内容标记命中二态（带文件 200 / 缺文件 404）", async ({
  authedPage,
  page,
  request,
  expectNoConsoleErrors,
  expectApi,
}) => {
  const { projectId } = authedPage;
  const uniq = `U4${Date.now() % 1e7}${Math.floor(Math.random() * 1e3)}`;
  const marker = `file-marker-${uniq}`;
  const csvName = `执行数据-${uniq}.csv`;

  // 数据准备①：上传含唯一标记的 CSV（multipart 直传；UI 上传路径已由 01 覆盖）
  const up = await request.post(`/api/v1/projects/${projectId}/files`, {
    multipart: {
      file: {
        name: csvName,
        mimeType: "text/csv",
        buffer: Buffer.from(`marker,note\n${marker},payload\n`, "utf-8"),
      },
    },
  });
  expect(up.status()).toBe(201);
  const fileId = ((await up.json()) as { data: { id: string } }).data.id;

  // 数据准备②：POST 定义 + bodyContains 标记规则（规则走 web API → Redis 快照失效 → mock 热更新）
  const def = await createApiDef(request, projectId, {
    name: `文件执行定义-${uniq}`,
    path: `/upload-${uniq}`,
    request: bundle("POST", `/upload-${uniq}`),
  });
  const rule = await request.post(`/api/v1/projects/${projectId}/apis/${def.id}/mocks`, {
    data: {
      name: `标记规则-${uniq}`,
      enabled: true,
      followApi: false,
      matchers: { headers: [], query: [], bodyContains: marker },
      response: { status: 200, headers: [], body: '{"echo":"FILE-CONTENT-HIT"}', delayMs: 0 },
    },
  });
  expect(rule.status()).toBe(201);
  const mockUrl = await getMockUrl(request, projectId, def.id);

  // ── 正向：调试页 form_data（file 行引用上传文件 + text 行）→ 执行 → mock 命中 200 ──
  await navFromHome(page, "接口调试");
  await pickOption(page, page.getByTestId("debug-method"), "POST");
  await page.getByTestId("debug-url").fill(mockUrl);
  await page.getByRole("tab", { name: "请求体" }).click();
  await page.getByRole("radio", { name: "form-data" }).check();
  await page.getByTestId("req-panel-body").getByText("＋ 添加").click();
  const row1 = page.getByTestId("req-form-row").first();
  await row1.locator('input[placeholder="key"]').fill("csv");
  await pickOption(page, row1.locator(".ant-select").first(), "file");
  await pickOption(page, row1.locator(".ant-select").last(), new RegExp(csvName));
  await page.getByTestId("req-panel-body").getByText("＋ 添加").click();
  const row2 = page.getByTestId("req-form-row").nth(1);
  await row2.locator('input[placeholder="key"]').fill("note");
  await row2.locator('input[placeholder^="value"]').fill("x");

  const createApi = expectApi("**/api/v1/projects/*/exec-tasks");
  const createRaw = page.waitForResponse("**/api/v1/projects/*/exec-tasks");
  await page.getByTestId("btn-execute").click();
  const created = await createApi;
  expect(created.status).toBe(201);
  // 接口断言：提交载荷带 file 行（type=file + fileId）
  const payload = (await createRaw).request().postDataJSON() as {
    request: { body: { rows: { key: string; type: string; fileId?: string }[] } };
  };
  const csvRow = payload.request.body.rows.find((r) => r.key === "csv");
  expect(csvRow?.type).toBe("file");
  expect(csvRow?.fileId).toBe(fileId);

  await expect(page).toHaveURL(/\/reports\//, { timeout: 15000 });
  await expect(page.getByTestId("report-status")).toHaveText("SUCCESS", { timeout: 30000 });
  await expect(page.getByTestId("report-response-body")).toContainText("FILE-CONTENT-HIT");

  // ── 负向：同 key 纯文本行（无文件内容）→ mock 未命中 404 → 状态码断言失败 ──
  const miss = await request.post(`/api/v1/projects/${projectId}/exec-tasks`, {
    data: {
      type: "api_debug",
      request: {
        method: "POST",
        url: mockUrl,
        headers: [],
        query: [],
        body: {
          kind: "form_data",
          rows: [{ key: "csv", value: "plain-text-without-marker", type: "text", enabled: true }],
        },
        auth: { kind: "none" },
        timeoutMs: 60000,
        followRedirects: false,
        skipPre: false,
        skipPost: false,
      },
      asserts: [{ kind: "status_code", path: "", op: "eq", expected: "200" }],
      pre: [],
      post: [],
      extracts: [],
    },
  });
  expect(miss.status()).toBe(201);
  const missId = ((await miss.json()) as { data: { taskId: string } }).data.taskId;
  expect((await pollTask(request, projectId, missId)).status).toBe("FAILED");
  await page.goto(`/reports/${missId}`);
  await expect(page.getByTestId("report-status")).toHaveText("FAILED");
  await expect(page.getByTestId("assert-fail").first()).toBeVisible();
  await expect(page.getByTestId("report-response-body").or(page.getByTestId("drill-response"))).toContainText("40401");

  await expectNoConsoleErrors();
});

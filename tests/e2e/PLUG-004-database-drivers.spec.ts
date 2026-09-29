import path from "node:path";
import { test, expect, navFromHome } from "./fixtures";
import { uploadPlugin, enablePlugin, loginSeedAdmin, newAdminContext } from "./s6-helpers";
import { ok, pollTask } from "./s2-helpers";
import {
  createScenario,
  executeScenario,
  saveSteps,
  scenarioTree,
  stepUid,
  type StepNodeLike,
} from "./s3-helpers";
import { E2E_BASE, E2E_PG_URL } from "./env";

/**
 * PLUG-004 e2e（规格 §5 T8/T9/T10）：
 * T3(UI)=插件管理浏览器 multipart 直传 dm 驱动 + 驱动徽标 + 启用；
 * T4(UI)=环境数据源 driver 五家下拉 + 占位跟随 + 连接测试二态（PG 直连成功 / dm 不可达失败）；
 * T5(链路)=场景 SQL 前置（参数绑定+varMapping）执行成功、变量断言通过；非 SELECT → 失败项。
 * 三类断言：UI + Console（白名单显式登记）+ 接口（上传/连接测试/执行请求负载）。
 */

/** SQL 前置步骤（custom 请求 + pre SQL 处理器 + 可选变量断言） */
function sqlPreStep(
  name: string,
  url: string,
  sql: string,
  extra: { params?: unknown[]; varMapping?: Record<string, string>; asserts?: unknown[] } = {},
): StepNodeLike {
  return {
    uid: stepUid(),
    stepType: "custom",
    name,
    enabled: true,
    config: {
      bundle: {
        request: {
          method: "GET",
          url,
          headers: [],
          query: [],
          body: { kind: "none" },
          auth: { kind: "none" },
        },
        asserts: extra.asserts ?? [],
        pre: [
          {
            kind: "sql",
            sql,
            datasourceId: "ds-pg-e2e",
            params: extra.params ?? [],
            varMapping: extra.varMapping ?? {},
          },
        ],
        post: [],
        extracts: [],
      },
    },
    children: [],
  };
}

test("PLUG-004-T3 插件管理：浏览器 multipart 直传 dm 驱动 → 驱动徽标 → 启用", async ({
  page,
  context,
  request,
  expectNoConsoleErrors,
}) => {
  await loginSeedAdmin(request, context);
  await page.goto("/system/plugins");
  await expect(page.getByTestId("page-system-plugins")).toBeVisible();

  // UI 直传（multipart 浏览器出口——S6 两连缺陷回归面，PLUG-001-T5 同型）
  const resPromise = page.waitForResponse(
    (r) => r.url().includes("/api/v1/system/plugins") && r.request().method() === "POST",
  );
  await page.getByTestId("plugin-upload-btn").click();
  const tgz = path.resolve(process.cwd(), "plugins", "dist", "dm-1.0.0.tgz");
  await page.locator(".ant-modal input[type=file]").setInputFiles(tgz);
  await page.getByText("dm-1.0.0.tgz").waitFor({ state: "visible", timeout: 8000 });
  await page.waitForTimeout(800); // beforeUpload 状态落定（演示录制同型竞态教训）
  await page.getByRole("button", { name: "确认上传" }).click();
  const res = await resPromise;

  // 接口断言：multipart 直传 + 201 首传 / 409 幂等
  expect([201, 409]).toContain(res.status());
  expect(res.request().headers()["content-type"] ?? "").toContain("multipart/form-data");
  const body = (await res.json()) as {
    code: number;
    data?: { manifest?: { name: string; kind: string } } | null;
  };
  if (res.status() === 201) {
    expect(body.code).toBe(0);
    expect(body.data?.manifest?.name).toBe("dm");
    expect(body.data?.manifest?.kind).toBe("driver");
  } else {
    expect(body.code).toBe(70005);
  }

  // UI 断言：dm 行 + kind=驱动徽标 + 启用开关（UI 启用走 runner 热加载 → worker 线程装载 CJS bundle）
  const row = page.getByRole("row").filter({ hasText: "dm" }).first();
  await expect(row).toBeVisible({ timeout: 15000 });
  await expect(row.getByText("驱动")).toBeVisible();
  // 栈启动早期内嵌 plugin-runner 可能未就绪（health 缓存 5s）→ PUT 400·70004，退避重试点开关
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await page.waitForTimeout(5000);
    await page.getByTestId("plugin-toggle-dm").click();
    const up = await row
      .getByText("运行中")
      .isVisible({ timeout: 8000 })
      .catch(() => false);
    if (up) break;
    if (attempt === 3) throw new Error("dm 驱动启用后未进入运行中（runner 未就绪或加载失败）");
  }
  await expect(row.getByText("运行中")).toBeVisible();

  await expectNoConsoleErrors([
    {
      pageUrlPattern: "/system/plugins",
      textPattern: "(\\[http 409\\] POST .*system/plugins|status of 409)",
      reason: "PLUG-004-T3 幂等 409（dm 驱动 1.0.0 已存在）为预期响应",
    },
  ]);
});

test("PLUG-004-T4 环境数据源：五家下拉 + 占位跟随 + 连接测试二态（PG 成功 / dm 失败）", async ({
  authedPage,
  page,
  expectApi,
  expectNoConsoleErrors,
}) => {
  await navFromHome(page, "环境管理");
  await page.getByTestId("btn-new-env").click();

  // 数据源卡片：driver 下拉五家（UI 断言）
  await page.getByTestId("env-tab-db").click();
  await page.getByTestId("btn-add-db").click();
  await page.getByTestId("db-driver-select-1").click();
  const dropdown = page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden)");
  for (const label of ["PostgreSQL", "MySQL", "Oracle", "SQL Server", "达梦 DM"]) {
    await expect(dropdown.getByText(label, { exact: true })).toBeVisible();
  }

  // 选达梦 → URL 占位跟随（UI 断言）
  await dropdown.getByText("达梦 DM", { exact: true }).click();
  const dmUrlInput = page.getByTestId("env-db-card").first().locator('input[placeholder^="dm://"]');
  await expect(dmUrlInput).toBeVisible();

  // dm 不可达 → 连接失败红字（runner 插件路径；T3 已启用 dm 驱动）
  const dmApi = expectApi("**/environments/test-datasource");
  await dmUrlInput.fill("dm://u:p@127.0.0.1:1");
  await page.getByTestId("btn-db-test-1").click();
  const dmRes = await dmApi;
  expect(dmRes.status).toBe(200);
  expect((dmRes.data as { ok: boolean }).ok).toBe(false);
  await expect(page.getByTestId("db-test-result-1")).toContainText("连接失败", { timeout: 20_000 });

  // PG 直连本栈库 → 成功绿字（接口断言：信封 ok=true）
  await page.getByTestId("btn-add-db").click();
  await page
    .getByTestId("env-db-card")
    .nth(1)
    .locator('input[placeholder^="postgresql://"]')
    .fill(E2E_PG_URL);
  const pgApi = expectApi("**/environments/test-datasource");
  await page.getByTestId("btn-db-test-2").click();
  const pgRes = await pgApi;
  expect(pgRes.status).toBe(200);
  expect((pgRes.data as { ok: boolean }).ok).toBe(true);
  await expect(page.getByTestId("db-test-result-2")).toContainText("连接成功", { timeout: 10_000 });

  await expectNoConsoleErrors();
});

test("PLUG-004-T5 场景 SQL 前置：参数绑定+varMapping → 变量断言通过；非 SELECT → 失败项", async ({
  authedPage,
  page,
  request,
  playwright,
  expectNoConsoleErrors,
}) => {
  const pid = authedPage.projectId;
  const uniq = `P4${Date.now() % 1e7}`;

  // 前置：管理员独立 context 上传并启用 postgresql 驱动（幂等；不覆盖用户会话）——
  // 栈启动早期内嵌 plugin-runner 可能未就绪（400·70004），退避重试
  const admin = await newAdminContext(playwright);
  const driverId = await uploadPlugin(admin, "postgresql-1.0.0.tgz");
  for (let attempt = 0; ; attempt++) {
    try {
      await enablePlugin(admin, driverId);
      break;
    } catch (e) {
      if (attempt >= 3) throw e;
      await page.waitForTimeout(5000);
    }
  }
  await admin.dispose();

  // 环境：数据源指向本栈 embedded PG（接口断言：创建 201）
  const envRes = await request.post(`/api/v1/projects/${pid}/environments`, {
    data: {
      name: `驱动环境-${uniq}`,
      config: {
        database: [{ id: "ds-pg-e2e", name: "本栈库", driver: "postgresql", url: E2E_PG_URL }],
      },
    },
  });
  const env = await ok<{ id: string }>(envRes, 201);

  // 场景①：SQL 前置 SELECT + 参数绑定 + varMapping 提取 → 变量断言 eq
  //（整链路：词法白名单→READ ONLY 事务→绑定通道→首行提取→变量断言）
  const scOk = await createScenario(request, pid, { name: `SQL前置成功-${uniq}` });
  await saveSteps(request, pid, scOk.id, [
    sqlPreStep("查库断变量", `${E2E_BASE}/`, "SELECT ? AS id", {
      params: [{ value: "123" }],
      varMapping: { id: "orderId" },
      asserts: [{ kind: "variable", path: "orderId", op: "eq", expected: "123" }],
    }),
  ]);

  // 引擎驱动注册表 30s 轮询窗口：50032 未就绪 → 退避重执行（PLUG-003 勘误 2 同型）
  let okTree: { tree: { status: string }[] } | null = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    if (attempt > 0) await page.waitForTimeout(10_000);
    const taskId = await executeScenario(request, pid, scOk.id, { envId: env.id });
    const detail = await pollTask(request, pid, taskId, 60_000);
    if (detail.status === "SUCCESS") {
      okTree = await scenarioTree(request, pid, taskId);
      break;
    }
  }
  expect(okTree, "SQL 前置场景应在引擎驱动注册表就绪后成功").toBeTruthy();
  expect(okTree!.tree[0]!.status).toBe("SUCCESS");

  // 场景②：非 SELECT（DELETE）→ 词法白名单拦截 → 失败项（不触达数据库）
  const scBad = await createScenario(request, pid, { name: `SQL非白名单-${uniq}` });
  await saveSteps(request, pid, scBad.id, [
    sqlPreStep("违规语句", `${E2E_BASE}/`, "DELETE FROM orders WHERE id = 1"),
  ]);
  const taskId2 = await executeScenario(request, pid, scBad.id, { envId: env.id });
  const detail2 = await pollTask(request, pid, taskId2, 60_000);
  expect(detail2.status).toBe("FAILED");
  // 白名单拦截语义：失败消息含 SQL_NOT_SELECT(50031)——经 frames 断言（前置失败无步骤帧，树为空是预期）
  const rep2 = await request.get(`/api/v1/projects/${pid}/reports/${taskId2}`);
  const rep2d = await ok<{ items: { itemId: string }[] }>(rep2);
  const itemId2 = rep2d.items[0]!.itemId;
  const framesRes = await request.get(
    `/api/v1/projects/${pid}/reports/${taskId2}/items/${itemId2}/frames`,
  );
  const frames = await ok<{ frames?: unknown }>(framesRes);
  expect(JSON.stringify(frames)).toContain("50031");

  await expectNoConsoleErrors();
});

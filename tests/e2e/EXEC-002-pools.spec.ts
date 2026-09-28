import { test, expect, navFromHome } from "./fixtures";
import {
  bundle,
  createApiCase,
  createApiDef,
  createEnv,
  createMockRule,
  executeCases,
  getMockUrl,
  ok,
  pollTask,
} from "./s2-helpers";

/**
 * EXEC-002 资源池（规格：docs/sprint-2-api-core/EXEC-002-resource-pool.md）。
 * 覆盖：默认池卡片+节点表（engine ONLINE）、并发编辑、新建池 License 禁用（二态）；
 * 停止二态：RUNNING → STOPPED；SUCCESS 任务不可重跑（UI 无按钮 + 直发 422/50004）。
 * 三类断言：UI（pool-card/pool-nodes/btn-new-pool disabled/STOPPED 徽标）+ Console
 * + 接口（PUT maxConcurrency payload、stop、rerun 422 code=50004）。
 * 注：资源池为系统级页面，需 SYSTEM_POOL:READ（种子管理员具备；authedPage 注册用户仅在
 * 自建 org/project 组，无系统组权限——与 SYS-004/005 同款种子管理员登录）。
 */

/** 种子管理员登录（admin@rabbit.test；cookie 注入浏览器上下文，与 SYS-004/005 同款） */
async function loginSeedAdmin(
  request: import("@playwright/test").APIRequestContext,
  context: import("@playwright/test").BrowserContext,
) {
  const res = await request.post("/api/v1/auth/login", {
    data: { email: "admin@rabbit.test", password: "rabbit-admin-123" },
  });
  expect(res.status()).toBe(200);
  const ras = (res.headers()["set-cookie"] ?? "").split("ras=")[1]?.split(";")[0];
  expect(ras, "登录响应应下发 ras 会话 cookie").toBeTruthy();
  await context.addCookies([
    { name: "ras", value: ras!, url: process.env.E2E_BASE_URL ?? "http://localhost:3100" },
  ]);
}

test("EXEC-002-01 默认池：节点 ONLINE + 并发编辑 4 + 新建池 License 禁用", async ({
  page,
  context,
  request,
  expectNoConsoleErrors,
  expectApi,
}) => {
  await loginSeedAdmin(request, context);

  await navFromHome(page, "资源池");
  await expect(page.getByTestId("pool-nodes")).toBeVisible();

  // 默认池卡片存在（接口取池 id）
  const poolsRes = await request.get("/api/v1/system/pools");
  const pools = (
    await ok<{
      items: {
        id: string;
        name: string;
        isDefault: boolean;
        maxConcurrency: number;
        nodes: unknown[];
      }[];
    }>(poolsRes)
  ).items;
  expect(pools.length).toBeGreaterThanOrEqual(1);
  const defPool = pools.find((p) => p.isDefault) ?? pools[0];
  await expect(page.getByTestId(`pool-card-${defPool.id}`)).toBeVisible();
  await expect(page.getByTestId(`pool-card-${defPool.id}`)).toContainText("默认 · 不可删");

  // 节点表：engine 心跳在线（ONLINE 行存在）
  await expect(page.getByTestId("pool-nodes").getByText("在线").first()).toBeVisible({
    timeout: 15000,
  });

  // 编辑并发 4 → 保存（PUT payload maxConcurrency=4）
  await page.getByTestId(`btn-edit-pool-${defPool.id}`).click();
  const modal = page.getByRole("dialog");
  await expect(modal.getByTestId("input-pool-concurrency")).toBeVisible();
  await modal.getByTestId("input-pool-concurrency").fill("4");
  const putApi = expectApi("**/api/v1/system/pools/*");
  const putRaw = page.waitForResponse(
    (r) => r.url().includes("/system/pools/") && r.request().method() === "PUT",
  );
  await modal.getByRole("button", { name: /保\s*存/ }).click();
  const put = await putApi;
  expect(put.status).toBe(200);
  expect(put.code).toBe(0);
  expect((put.data as { maxConcurrency: number }).maxConcurrency).toBe(4);
  const putRawRes = await putRaw;
  expect((putRawRes.request().postDataJSON() as { maxConcurrency: number }).maxConcurrency).toBe(4);
  await expect(page.getByText("已保存，约一个心跳周期后生效")).toBeVisible();

  // T4 并发动态生效：4 → 2，一个心跳周期（engine 10s 心跳 + 页面 10s 自刷）后节点表槽位 total=2
  await page.getByTestId(`btn-edit-pool-${defPool.id}`).click();
  const modal2 = page.getByRole("dialog");
  await expect(modal2.getByTestId("input-pool-concurrency")).toBeVisible();
  await modal2.getByTestId("input-pool-concurrency").fill("2");
  const put2Api = expectApi("**/api/v1/system/pools/*");
  await modal2.getByRole("button", { name: /保\s*存/ }).click();
  const put2 = await put2Api;
  expect(put2.status).toBe(200);
  expect((put2.data as { maxConcurrency: number }).maxConcurrency).toBe(2);
  await expect
    .poll(async () => page.getByTestId("pool-nodes").getByText("0÷2").count(), {
      timeout: 35_000,
      message: "并发下调至 2 后节点槽位应变为 0÷2",
    })
    .toBeGreaterThan(0);

  // 恢复 4（不拖慢后续并行用例的批量执行），恢复动作不阻塞本用例收尾
  await page.getByTestId(`btn-edit-pool-${defPool.id}`).click();
  const modal3 = page.getByRole("dialog");
  await expect(modal3.getByTestId("input-pool-concurrency")).toBeVisible();
  await modal3.getByTestId("input-pool-concurrency").fill("4");
  const put4Api = expectApi("**/api/v1/system/pools/*");
  await modal3.getByRole("button", { name: /保\s*存/ }).click();
  const put4 = await put4Api;
  expect(put4.status).toBe(200);
  expect((put4.data as { maxConcurrency: number }).maxConcurrency).toBe(4);

  // 二态：新建资源池 = 企业版功能——社区版 disabled / 企业版 enabled（S9 勘误：ENTP spec 并行持证
  // 时按钮解锁，门控 403/放行已在 ENTP-007 e2e+jmx 全覆盖）。读态与断言间存在并行持证竞态
  // （读到社区→按钮随即被解锁）——重试环桥接：任一轮「读态↔按钮态」一致即过（≤30s）
  for (let attempt = 0; attempt < 10; attempt++) {
    const lic = await request.get("/api/v1/public/license-status");
    const edition = ((await lic.json()) as { data: { edition: string } }).data.edition;
    const disabledCount = await page
      .getByTestId("btn-new-pool")
      .evaluate((el) => ((el as HTMLButtonElement).disabled ? 1 : 0));
    const expectDisabled = edition === "COMMUNITY" ? 1 : 0;
    if (disabledCount === expectDisabled) break;
    if (attempt === 9) {
      throw new Error(`门控二态竞态未收敛：edition=${edition} disabled=${disabledCount === 1}`);
    }
    await page.waitForTimeout(3_000);
    await page.reload();
    await expect(page.getByTestId("pool-nodes")).toBeVisible();
  }

  await expectNoConsoleErrors();
});

test("EXEC-002-02 停止二态：慢任务 STOPPED + SUCCESS 任务不可重跑（422/50004）", async ({
  page,
  context,
  request,
  expectNoConsoleErrors,
  expectApi,
}) => {
  await loginSeedAdmin(request, context);
  const projects = await ok<{ id: string }[]>(await request.get("/api/v1/personal/projects"));
  const projectId = projects[0]!.id;
  const uniq = `T2${Date.now() % 1e7}${Math.floor(Math.random() * 1e3)}`;

  // 数据准备：mock 延迟 8s 规则 + 慢用例 + 一个已 SUCCESS 的快任务
  const envId = await createEnv(request, projectId, `池环境-${uniq}`);
  // 注意：定义 path 列由 request.spec.url 推导（create /apis 契约）——mock 规则模板跟随该 path，
  // 因此定义 URL 必须就是路径模板本身；用例 URL 单独用绝对 mock 地址
  const def = await createApiDef(request, projectId, {
    name: `慢定义-${uniq}`,
    path: "/pets/{id}",
  });
  const mockUrl = await getMockUrl(request, projectId, def.id);
  const mockBase = mockUrl.replace("/pets/{id}", "");
  await createMockRule(request, projectId, def.id, {
    name: `慢规则-${uniq}`,
    respBody: "{}",
    delayMs: 8000,
  });
  const slowBundle = bundle("GET", `${mockBase}/pets/1`);
  slowBundle.spec.timeoutMs = 20000; // 慢响应 8s 延迟 < 采样超时
  const slowCase = await createApiCase(request, projectId, def.id, {
    name: `慢用例-${uniq}`,
    request: slowBundle,
  });
  // 快任务（SUCCESS，验证不可重跑）：直打 mock /hello
  const fastDef = await createApiDef(request, projectId, {
    name: `快定义-${uniq}`,
    path: "/hello",
    request: bundle("GET", "http://127.0.0.1:4001/hello"),
  });
  const fastCase = await createApiCase(request, projectId, fastDef.id, {
    name: `快用例-${uniq}`,
    request: bundle("GET", "http://127.0.0.1:4001/hello"),
  });
  const fastTaskId = await executeCases(request, projectId, fastDef.id, { caseIds: [fastCase.id] });
  const fastFinal = await pollTask(request, projectId, fastTaskId);
  expect(fastFinal.status).toBe("SUCCESS");

  // 慢任务（RUNNING）
  const slowTaskId = await executeCases(request, projectId, def.id, {
    caseIds: [slowCase.id],
    envId,
  });

  // ── 用户路径：任务中心 → 慢任务行 RUNNING → 停止 → STOPPED ──
  await navFromHome(page, "任务中心");
  const slowRow = page
    .getByTestId("task-list-table")
    .getByRole("row", { name: new RegExp(slowTaskId.slice(0, 8)) });
  await expect(slowRow).toBeVisible({ timeout: 15000 });
  await expect(slowRow.getByText(/RUNNING|PENDING/).first()).toBeVisible({ timeout: 10000 });

  const stopApi = expectApi("**/api/v1/projects/*/exec-tasks/*/stop");
  await slowRow.getByTestId(/btn-stop-\d/).click();
  await page
    .locator(".ant-popover")
    .getByRole("button", { name: /停\s*止/ })
    .click();
  const stopped = await stopApi;
  expect(stopped.status).toBe(200);
  expect(stopped.code).toBe(0);
  await expect(slowRow.getByText("STOPPED", { exact: true })).toBeVisible({ timeout: 20000 });

  // ── SUCCESS 任务无重跑按钮 + 直发 422（$.code==50004 TASK_NOT_RERUNNABLE）──
  const fastRow = page
    .getByTestId("task-list-table")
    .getByRole("row", { name: new RegExp(fastTaskId.slice(0, 8)) });
  await expect(fastRow.getByText("SUCCESS", { exact: true })).toBeVisible();
  await expect(fastRow.getByTestId(/btn-rerun-\d/)).toHaveCount(0);
  const rerunRes = await request.post(
    `/api/v1/projects/${projectId}/exec-tasks/${fastTaskId}/rerun`,
    { data: {} },
  );
  expect(rerunRes.status()).toBe(422);
  expect(((await rerunRes.json()) as { code: number }).code).toBe(50004);

  await expectNoConsoleErrors();
});

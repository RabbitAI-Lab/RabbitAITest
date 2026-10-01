import { test, expect } from "./fixtures";
import { MOCK_URL } from "./s9-helpers";

/**
 * S14 UIT-004：项目级 Runner + 环境检测 e2e（规格 §5 T01/T02/T03/T04b）。
 * T01 隔离（UI+接口）：A 项目抽屉仅本项目（内置恒在）；B 用户直访 A 的 runner → 404 防枚举；
 * T02 checklist 渲染：内置卡检测 → 六项行（node/chromium 等 testid）+ warn 行文案「不阻断」；
 * T03 安装链路（负路径·CI 不下真包）：非法版本 422·90086 → 受理不存在版本（0.0.1，npm 404 快速 FAILED）
 *   → 重复受理 422·90088 busy → FAILED 日志尾部渲染 → 重试受理复用行再 INSTALLING；
 * T04b 预检帧缺省态：正常执行任务报告页无 runner-check 卡（阻断态由引擎单测覆盖——共享栈无法
 *   破坏浏览器目录而不伤及其他用例，规格 §5 登记豁免）。
 * 三类断言：UI（胶囊/抽屉/checklist 行/FAILED 日志/报告无阻断卡）+ Console（无 error/pageerror）+
 * 接口（list 200 信封、404/422 形态、busy 90088、run 202）。
 * 凭据口径：e2e 临时账号密码走 E2E_USER_PASSWORD 环境变量（fixtures 同源），MOCK_URL 复用 s9-helpers。
 */

const E2E_PASSWORD = process.env.E2E_USER_PASSWORD ?? "rabbit-pass-123";

async function enableUitModule(page: import("@playwright/test").Page) {
  await page.goto("/settings/info");
  const sw = page.getByTestId("module-switch-uit");
  await expect(sw).toBeVisible();
  if (!(await sw.evaluate((el) => el.classList.contains("ant-switch-checked")))) {
    await sw.click();
    await page.waitForTimeout(300);
    await page.getByTestId("btn-save-info").click();
    await expect(page.getByText("基本信息已保存").first()).toBeVisible({ timeout: 8000 });
  }
}

async function enterUit(page: import("@playwright/test").Page) {
  await page.goto("/ui-test");
  await expect(page.getByTestId("uit-page")).toBeVisible({ timeout: 60000 });
  await expect(page.getByTestId("uit4-pill")).toBeVisible({ timeout: 20000 });
}

test("UIT-004-T01 Runner 管理面·项目隔离【抽屉仅本项目·跨项目 404】", async ({
  authedPage,
  page,
  expectNoConsoleErrors,
}) => {
  await enableUitModule(page);
  await enterUit(page);

  // UI：胶囊存在且可开抽屉；内置 runner 卡恒在
  await page.getByTestId("uit4-pill").click();
  const drawer = page.getByTestId("uit4-drawer");
  await expect(drawer).toBeVisible({ timeout: 8000 });
  await expect(page.getByTestId("uit4-runner-builtin")).toBeVisible();
  await expect(page.getByTestId("uit4-runner-builtin")).toContainText("系统 Runner");
  await expect(drawer).toContainText("仅当前项目可见可用");

  // 本项目无项目 runner 时空态文案（内置恒在=不算空）
  await expect(page.getByTestId("uit4-empty-project")).toBeVisible();

  // 接口：本项目列表信封 {items,total} 且首行=内置
  const listRes = await page.request.get(`/api/v1/projects/${authedPage.projectId}/ui-runners`);
  expect(listRes.status()).toBe(200);
  const listBody = (await listRes.json()) as {
    code: number;
    data: { items: { id: string; kind: string }[]; total: number };
  };
  expect(listBody.code).toBe(0);
  expect(listBody.data.total).toBe(1);
  expect(listBody.data.items[0]).toMatchObject({ id: "builtin", kind: "builtin" });

  // 隔离：项目 A 造一个 runner 行（受理不存在版本——负路径秒级 FAILED，行即隔离标的）
  const installRes = await page.request.post(
    `/api/v1/projects/${authedPage.projectId}/ui-runners`,
    {
      data: { version: "0.0.1" },
    },
  );
  expect(installRes.status()).toBe(202);
  const installBody = (await installRes.json()) as { data: { id: string } };
  const runnerIdA = installBody.data.id;

  // 项目 B（新注册用户，个人项目）：列表看不到 A 的 runner；直访 A 的 runner → 404 防枚举
  const bEmail = `e2e-uit4b-${Date.now()}-${Math.floor(Math.random() * 1e6)}@rabbit.test`;
  const regB = await page.request.post("/api/v1/auth/register", {
    data: { email: bEmail, password: E2E_PASSWORD },
  });
  expect(regB.status()).toBe(201);
  const regBody = (await regB.json()) as { data: { projectId: string } };
  const projectB = regBody.data.projectId;
  const rasCookie = (regB.headers()["set-cookie"] ?? "").split("ras=")[1]?.split(";")[0];
  expect(rasCookie).toBeTruthy();

  const bList = await page.request.get(`/api/v1/projects/${projectB}/ui-runners`, {
    headers: { cookie: `ras=${rasCookie}` },
  });
  expect(bList.status()).toBe(200);
  const bListBody = (await bList.json()) as { data: { items: { id: string }[] } };
  expect(bListBody.data.items.map((i) => i.id)).toEqual(["builtin"]); // 只剩内置=看不到 A 的
  const bCross = await page.request.get(`/api/v1/projects/${projectB}/ui-runners/${runnerIdA}`, {
    headers: { cookie: `ras=${rasCookie}` },
  });
  expect(bCross.status()).toBe(404);
  const bCrossBody = (await bCross.json()) as { code: number };
  expect(bCrossBody.code).toBe(90085);

  // 未登录 → 401
  const anon = await page.request.get(`/api/v1/projects/${authedPage.projectId}/ui-runners`, {
    headers: { cookie: "" },
  });
  expect(anon.status()).toBe(401);
});

test("UIT-004-T02 环境检测 checklist 渲染【六项三态·warn 不阻断】", async ({
  authedPage,
  page,
  expectNoConsoleErrors,
}) => {
  await enableUitModule(page);
  await enterUit(page);

  // 触发内置检测（接口 202 受理）
  const checkRes = await page.request.post(
    `/api/v1/projects/${authedPage.projectId}/ui-runners/builtin/check`,
  );
  expect(checkRes.status()).toBe(202);

  // 轮询列表至 builtin 带 checklist（引擎实测回调）
  let items: { key: string; status: string; hint?: string }[] | null = null;
  for (let i = 0; i < 20 && !items; i++) {
    await page.waitForTimeout(1500);
    const l = await page.request.get(`/api/v1/projects/${authedPage.projectId}/ui-runners`);
    const b = (await l.json()) as {
      data: { items: { id: string; check: { items: typeof items } | null }[] };
    };
    items = b.data.items[0]?.check?.items ?? null;
  }
  expect(items).toBeTruthy();
  const keys = items!.map((i) => i.key);
  expect(keys).toEqual(["node", "runner_pkg", "chromium", "disk", "ffmpeg", "npm_registry"]);

  // UI：抽屉内六项行渲染（testid 逐项）+ 检测时间戳。
  // 注：warn 行文案（「不影响执行」）由引擎单测 T08 断言——e2e 栈环境恒绿（ffmpeg/registry 在本机与 CI 均可用），
  // 无法稳定造出 warn 行，规格 §5 登记（环境相关三态归单测，e2e 断言环境无关项）。
  await page.reload();
  await expect(page.getByTestId("uit-page")).toBeVisible({ timeout: 60000 });
  await page.getByTestId("uit4-pill").click();
  await expect(page.getByTestId("uit4-runner-builtin")).toBeVisible({ timeout: 8000 });
  for (const key of keys) {
    await expect(page.getByTestId(`uit4-check-${key}`).first()).toBeVisible({ timeout: 8000 });
  }
  await expect(page.getByTestId("uit4-drawer")).toContainText("检测于");
});

test("UIT-004-T03 安装链路负路径【422·90086 → busy 90088 → FAILED 日志 → 重试复用】", async ({
  authedPage,
  page,
  expectNoConsoleErrors,
}) => {
  await enableUitModule(page);
  await enterUit(page);

  // 非法版本（range/tag）→ 422·90086（接口断言）
  const bad = await page.request.post(`/api/v1/projects/${authedPage.projectId}/ui-runners`, {
    data: { version: "^1.63.0" },
  });
  expect(bad.status()).toBe(422);
  expect(((await bad.json()) as { code: number }).code).toBe(90086);
  const bad2 = await page.request.post(`/api/v1/projects/${authedPage.projectId}/ui-runners`, {
    data: { version: "latest" },
  });
  expect(((await bad2.json()) as { code: number }).code).toBe(90086);

  // 受理不存在版本 0.0.1（npm 404 → 秒级 FAILED）
  const inst = await page.request.post(`/api/v1/projects/${authedPage.projectId}/ui-runners`, {
    data: { version: "0.0.1" },
  });
  expect(inst.status()).toBe(202);
  const instBody = (await inst.json()) as {
    data: { id: string; status: string; isDefault: boolean };
  };
  const runnerId = instBody.data.id;
  expect(instBody.data.status).toBe("INSTALLING");
  expect(instBody.data.isDefault).toBe(true); // 首个项目 runner 自动默认

  // INSTALLING 中重复受理同版本 → 422·90088 busy；删除同样 busy
  const busy = await page.request.post(`/api/v1/projects/${authedPage.projectId}/ui-runners`, {
    data: { version: "0.0.1" },
  });
  expect(busy.status()).toBe(422);
  expect(((await busy.json()) as { code: number }).code).toBe(90088);
  const busyDel = await page.request.delete(
    `/api/v1/projects/${authedPage.projectId}/ui-runners/${runnerId}`,
  );
  expect(busyDel.status()).toBe(422);
  expect(((await busyDel.json()) as { code: number }).code).toBe(90088);

  // 等引擎终态 FAILED（npm 404 秒级；网络异常兜底 120s）
  let status = "INSTALLING";
  for (let i = 0; i < 60 && status === "INSTALLING"; i++) {
    await page.waitForTimeout(2000);
    const d = await page.request.get(
      `/api/v1/projects/${authedPage.projectId}/ui-runners/${runnerId}`,
    );
    status = ((await d.json()) as { data: { status: string } }).data.status ?? "UNKNOWN";
  }
  expect(status).toBe("FAILED");

  // UI：抽屉 FAILED 态 + npm 日志尾部渲染
  await page.reload();
  await expect(page.getByTestId("uit-page")).toBeVisible({ timeout: 60000 });
  await page.getByTestId("uit4-pill").click();
  await expect(page.getByTestId("uit4-runner-builtin")).toBeVisible({ timeout: 8000 });
  const failLog = page.getByTestId(`uit4-install-log-${runnerId.slice(0, 8)}`);
  await expect(failLog).toBeVisible({ timeout: 8000 });
  await expect(failLog).toContainText(/npm|ERR|404|not found/i);

  // 重试受理：FAILED 行复用 → 再 INSTALLING（幂等重试语义）
  const retry = await page.request.post(`/api/v1/projects/${authedPage.projectId}/ui-runners`, {
    data: { version: "0.0.1" },
  });
  expect(retry.status()).toBe(202);
  const retryBody = (await retry.json()) as { data: { id: string; status: string } };
  expect(retryBody.data.id).toBe(runnerId);
  expect(retryBody.data.status).toBe("INSTALLING");

  // 清场：等终态后删除（软删+目录清理 job）
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(2000);
    const d = await page.request.get(
      `/api/v1/projects/${authedPage.projectId}/ui-runners/${runnerId}`,
    );
    if (((await d.json()) as { data: { status: string } }).data.status !== "INSTALLING") break;
  }
  const del = await page.request.delete(
    `/api/v1/projects/${authedPage.projectId}/ui-runners/${runnerId}`,
  );
  expect(del.status()).toBe(200);
  const after = await page.request.get(`/api/v1/projects/${authedPage.projectId}/ui-runners`);
  const afterBody = (await after.json()) as { data: { items: { id: string }[] } };
  expect(afterBody.data.items.map((i) => i.id)).toEqual(["builtin"]);
});

test("UIT-004-T04b 预检帧缺省态+内置回落执行【正常执行无阻断卡】", async ({
  authedPage,
  page,
  expectNoConsoleErrors,
}) => {
  await enableUitModule(page);
  await enterUit(page);

  // 本项目无项目 runner（回落内置）：执行一条脚本用例 → SUCCESS 且报告页无 runner-check 卡
  const script = [
    "import { test, expect } from '@playwright/test';",
    "test('回落内置执行', async ({ page }) => {",
    `  await page.goto('${MOCK_URL}/uit/demo');`,
    "  await expect(page.getByTestId('demo-username')).toBeVisible();",
    "});",
  ].join("\n");
  const caseRes = await page.request.post(`/api/v1/projects/${authedPage.projectId}/ui-cases`, {
    data: { name: `e2e-uit4-t4-${Date.now()}`, mode: "script", script },
  });
  expect(caseRes.status()).toBe(201);
  const caseId = ((await caseRes.json()) as { data: { id: string } }).data.id;
  const runRes = await page.request.post(
    `/api/v1/projects/${authedPage.projectId}/ui-cases/${caseId}/run`,
  );
  expect(runRes.status()).toBe(202);
  const taskId = ((await runRes.json()) as { data: { taskId: string } }).data.taskId;

  await page.goto(`/ui-test/tasks/${taskId}`);
  await expect(page.getByTestId("uit-report-status")).toHaveText("SUCCESS", { timeout: 120000 });
  // 预检通过=无阻断卡（runner-check 帧缺省态）；阻断态由引擎单测覆盖（规格 §5 T04 口径登记）
  await expect(page.locator("[data-testid^='uit4-report-frame-']")).toHaveCount(0);
  const detail = await page.request.get(
    `/api/v1/projects/${authedPage.projectId}/ui-tasks/${taskId}`,
  );
  const detailBody = (await detail.json()) as { data: { items: { runnerChecks: unknown[] }[] } };
  expect(detailBody.data.items[0]?.runnerChecks ?? []).toHaveLength(0);
});

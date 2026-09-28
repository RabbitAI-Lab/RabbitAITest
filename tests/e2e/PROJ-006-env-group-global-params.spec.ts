import { test, expect } from "./fixtures";
import {
  createEnv,
  bundle,
  createApiDef,
  createApiCase,
  executeCases,
  pollTask,
  MOCK_BASE,
} from "./s2-helpers";
import { createScenario } from "./s3-helpers";

// 白名单：project store 水合前 /projects/null 查询 404（S1 既有面，S5 §7.2 登记）
const hydrateRace = {
  pageUrlPattern: "/settings/environments",
  textPattern: "projects/null|Failed to load resource",
  reason: "store 水合前 projectId=null 的首帧查询",
};

/** PROJ-006 环境组与全局参数 e2e（组 CRUD/按组执行/全局参数生效；三类断言）。 */
test.describe("PROJ-006 环境组与全局参数", () => {
  test("T2 全局参数：设变量→api 用例引用执行→mock 命中（环境变量覆盖同验）", async ({
    page,
    authedPage,
    request,
    expectNoConsoleErrors,
  }) => {
    const { projectId } = authedPage;
    // 全局参数（UI 表格操作走查 + 生效断言走 API 执行）
    const saved = await request.put(`/api/v1/projects/${projectId}/global-params`, {
      data: { params: [{ key: "who", value: "global", description: "e2e" }] },
    });
    expect(saved.status()).toBe(200);
    // UI：全局参数 Tab 可见 key
    await page.goto("/settings/environments");
    await page.getByRole("tab", { name: "全局参数" }).click();
    await expect(page.getByTestId("global-params-panel")).toBeVisible({ timeout: 10_000 });
    // KV 表格回显（input 受控值）：读取首行两个输入框的 value
    // a11y 视角断言（textbox "who"/"global" 由 snapshot 证实渲染）
    await expect(
      page.getByRole("tabpanel", { name: "全局参数" }).getByRole("textbox").first(),
    ).toHaveValue("who");
    await expect(
      page.getByRole("tabpanel", { name: "全局参数" }).getByRole("textbox").nth(1),
    ).toHaveValue("global");

    // 环境A：仅 base（who 取全局参数 global）；环境B：base + who=envwin（覆盖全局）
    const envA = await createEnv(page.request, projectId, `e2e-gp-a-${Date.now()}`);
    const envB = await createEnv(page.request, projectId, `e2e-gp-b-${Date.now()}`, [
      { key: "base", value: MOCK_BASE },
      { key: "who", value: "envwin" },
    ]);
    const def = await createApiDef(page.request, projectId, {
      name: "gp-api",
      path: "/hello",
      method: "GET",
    });
    const caseRow = await createApiCase(page.request, projectId, def.id, {
      name: "gp-case",
      request: bundle("GET", "${base}/hello?who=${who}"),
    });
    // 环境A：全局参数注入（who=global，环境未定义该 key）→ 用例执行成功
    const tid1 = await executeCases(page.request, projectId, def.id, {
      caseIds: [caseRow.id],
      envId: envA,
    });
    const r1 = await pollTask(page.request, projectId, tid1);
    expect(r1.status).toBe("SUCCESS");
    expect(r1.summary?.passed).toBe(1);
    // 环境B：环境变量覆盖全局参数（who=envwin）→ 仍成功
    const tid2 = await executeCases(page.request, projectId, def.id, {
      caseIds: [caseRow.id],
      envId: envB,
    });
    const r2 = await pollTask(page.request, projectId, tid2);
    expect(r2.status).toBe("SUCCESS");
    expect(r2.summary?.passed).toBe(1);
    await expectNoConsoleErrors([hydrateRace]);
  });

  test("T3 环境组：两环境入组→按组执行→2 个任务（envId 各异）", async ({
    page,
    authedPage,
    request,
    expectNoConsoleErrors,
  }) => {
    const { projectId } = authedPage;
    const envA = await createEnv(page.request, projectId, `e2e-grp-a-${Date.now()}`, [
      { key: "tag", value: "a" },
    ]);
    const envB = await createEnv(page.request, projectId, `e2e-grp-b-${Date.now()}`, [
      { key: "tag", value: "b" },
    ]);
    // UI：环境组 Tab 展示（新建弹窗的成员选择为 antd 虚拟列表——option 可见性受滚动控制，建组走 API，UI 断言组行渲染）
    await page.goto("/settings/environments");
    await page.getByRole("tab", { name: "环境组" }).click();
    await expect(page.getByTestId("env-groups-panel")).toBeVisible();
    await page.getByTestId("btn-new-env-group").click();
    await expect(page.getByTestId("env-group-name-input")).toBeVisible();
    await page.keyboard.press("Escape");

    const group = (
      (await (
        await request.post(`/api/v1/projects/${projectId}/env-groups`, {
          data: { name: `e2e-回归组-${Date.now()}`, environmentIds: [envA, envB] },
        })
      ).json()) as { data: { id: string; name: string } }
    ).data;
    expect(group.id).toBeTruthy();
    // API 建组不触发 UI 缓存失效——刷新重取后断言组行渲染
    await page.reload();
    await page.getByRole("tab", { name: "环境组" }).click();
    await expect(page.getByText(group.name)).toBeVisible({ timeout: 10_000 });
    const def = await createApiDef(page.request, projectId, {
      name: "grp-api",
      path: "/hello",
      method: "GET",
    });
    const caseRow = await createApiCase(page.request, projectId, def.id, {
      name: "grp-case",
      request: bundle("GET", "/hello"),
    });
    void def;
    void caseRow;
    // 按组执行（场景批量）：建最小场景 → execute envGroupId → 2 个任务（组内顺序）
    const scenario = await createScenario(page.request, projectId, {
      name: `e2e-grp-scenario-${Date.now()}`,
    });
    const exec = await request.post(`/api/v1/projects/${projectId}/scenarios/execute`, {
      data: { scenarioIds: [scenario.id], envGroupId: group!.id },
    });
    expect(exec.status()).toBe(201);
    const tasks = (
      (await exec.json()) as {
        data: { tasks: { taskId: string; envId: string; envName: string }[] };
      }
    ).data.tasks;
    expect(tasks.length).toBe(2);
    expect(new Set(tasks.map((t) => t.envId)).size).toBe(2);
    const f1 = await pollTask(page.request, projectId, tasks[0]!.taskId);
    expect(f1.status).toBe("SUCCESS");
    await expectNoConsoleErrors();
  });

  test("T4 二态：组内环境全删→ENV_GROUP_EMPTY 422；互斥 422", async ({
    page,
    authedPage,
    request,
  }) => {
    const { projectId } = authedPage;
    const envId = await createEnv(page.request, projectId, `e2e-empty-env-${Date.now()}`);
    const group = (
      (await (
        await request.post(`/api/v1/projects/${projectId}/env-groups`, {
          data: { name: `e2e-empty-group-${Date.now()}`, environmentIds: [envId] },
        })
      ).json()) as { data: { id: string } }
    ).data;
    const scenarioId = (
      await createScenario(request, projectId, { name: `e2e-empty-sc-${Date.now()}` })
    ).id;
    // envId 与 envGroupId 同传 → 422（互斥）
    const mutex = await request.post(`/api/v1/projects/${projectId}/scenarios/execute`, {
      data: { scenarioIds: [scenarioId], envId, envGroupId: group.id },
    });
    expect(mutex.status()).toBe(422);
    // 删组内唯一环境 → 组展开空 → 422 ENV_GROUP_EMPTY（真实场景 id，避开场景不存在的 20422 前置）
    await request.delete(`/api/v1/projects/${projectId}/environments/${envId}`);
    const empty = await request.post(`/api/v1/projects/${projectId}/scenarios/execute`, {
      data: { scenarioIds: [scenarioId], envGroupId: group.id },
    });
    expect(empty.status()).toBe(422);
    expect(((await empty.json()) as { code: number }).code).toBe(20461);
  });
});

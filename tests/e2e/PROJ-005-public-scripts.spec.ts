import { test, expect } from "./fixtures";
import {
  createEnv,
  createApiDef,
  createApiCase,
  executeCases,
  pollTask,
  bundle,
} from "./s2-helpers";

/** PROJ-005 公共脚本 e2e（CRUD/调试/发布/引用执行/删除保护；三类断言）。 */
test.describe("PROJ-005 公共脚本", () => {
  test("T2 主链路：新建（参数定义）→调试控制台（参数覆盖）→发布", async ({
    page,
    authedPage,
    request,
    expectNoConsoleErrors,
  }) => {
    const { projectId } = authedPage;
    // ① 接口：建脚本（经 API 建，UI 走查编辑抽屉与调试抽屉）
    const created = await request.post(`/api/v1/projects/${projectId}/public-scripts`, {
      data: {
        name: "e2e-生成登录凭证",
        language: "javascript",
        tags: ["e2e"],
        params: [{ name: "length", defaultValue: "8", required: true }],
        content:
          'const n = Number(getVar("param.length")||"8"); setVar("loginUser","u"+randomInt(1000,9999)); log("n="+n);',
      },
    });
    expect(created.status()).toBe(201);
    const script = ((await created.json()) as { data: { id: string } }).data;

    // ② UI：列表 + 调试抽屉（参数覆盖默认值 → 控制台输出 n=6）
    await page.goto("/settings/public-scripts");
    await expect(page.getByTestId("page-settings-public-scripts")).toBeVisible();
    await expect(page.getByText("e2e-生成登录凭证")).toBeVisible();
    await page.getByTestId("script-debug-e2e-生成登录凭证").click();
    await page.getByTestId("script-debug-run").waitFor({ state: "visible" });
    // params JSON 覆盖 length=6（调试抽屉默认 params 为 {}）
    await page.locator(".ant-drawer").last().locator("textarea").nth(1).fill('{"length":"6"}');
    await page.getByTestId("script-debug-run").click();
    await expect(page.getByTestId("script-debug-console")).toContainText("n=6", {
      timeout: 10_000,
    });

    // ③ 发布（DRAFT→ENABLED）状态 tag 变化（先关调试抽屉避免遮罩拦截）
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    await page.getByRole("button", { name: "发布" }).first().click({ force: true });
    await expect(page.getByText("已发布").first()).toBeVisible({ timeout: 10_000 });
    await expectNoConsoleErrors();
  });

  test("T3 引用链路：api 用例前置引用公共脚本→执行成功；被引用删除 409→force", async ({
    page,
    authedPage,
    request,
    expectNoConsoleErrors,
  }) => {
    const { projectId } = authedPage;
    // 建 mock 目标环境 + api 定义 + 用例（前置 scriptRef）
    const envId = await createEnv(page.request, projectId, `e2e-script-env-${Date.now()}`);
    const def = await createApiDef(page.request, projectId, {
      name: "script-ref-api",
      path: "/hello",
      method: "GET",
    });
    const script = (
      (await (
        await request.post(`/api/v1/projects/${projectId}/public-scripts`, {
          data: {
            name: `e2e-ref-script-${Date.now()}`,
            language: "javascript",
            tags: [],
            params: [{ name: "prefix", defaultValue: "u", required: false }],
            content: 'setVar("who", getVar("param.prefix")+"1"); log("script-ok");',
          },
        })
      ).json()) as { data: { id: string } }
    ).data;
    await request.patch(`/api/v1/projects/${projectId}/public-scripts/${script.id}`, {
      data: { status: "ENABLED" },
    });
    const caseRow = await createApiCase(page.request, projectId, def.id, {
      name: "script-ref-case",
      request: bundle("GET", "/hello", {
        pre: [
          {
            kind: "script",
            script: "",
            scriptRef: { scriptId: script.id, params: { prefix: "z" } },
          } as never,
        ],
      }),
    });
    // 执行（脚本引用构建期展开 → engine 内联执行 → 任务 SUCCESS）
    const taskId = await executeCases(page.request, projectId, def.id, {
      caseIds: [caseRow.id],
      envId,
    });
    const final = await pollTask(page.request, projectId, taskId);
    expect(["SUCCESS", "FAILED"]).toContain(final.status);
    // 脚本执行成功（无 CONFIG_ERROR/构建失败）→ 引用展开成功即 SUCCESS
    expect(final.status).toBe("SUCCESS");

    // 删除保护：被引用 → 409 附清单
    const blocked = await request.delete(
      `/api/v1/projects/${projectId}/public-scripts/${script.id}`,
    );
    expect(blocked.status()).toBe(409);
    expect(((await blocked.json()) as { code: number; data: unknown }).code).toBe(20451);
    // force 删除成功
    const forced = await request.delete(
      `/api/v1/projects/${projectId}/public-scripts/${script.id}?force=true`,
    );
    expect(forced.status()).toBe(200);
    await expectNoConsoleErrors();
  });

  test("T4 二态：DRAFT 不可被引用（422 SCRIPT_INVALID_REF）", async ({
    page,
    authedPage,
    request,
  }) => {
    const { projectId } = authedPage;
    const script = (
      (await (
        await request.post(`/api/v1/projects/${projectId}/public-scripts`, {
          data: {
            name: `e2e-draft-${Date.now()}`,
            language: "javascript",
            tags: [],
            params: [],
            content: "log(1);",
          },
        })
      ).json()) as { data: { id: string } }
    ).data;
    const envId = await createEnv(page.request, projectId, `e2e-draft-env-${Date.now()}`);
    const def = await createApiDef(page.request, projectId, {
      name: "draft-ref-api",
      path: "/hello",
      method: "GET",
    });
    const caseRow = await createApiCase(page.request, projectId, def.id, {
      name: "draft-ref-case",
      request: bundle("GET", "/hello", {
        pre: [
          { kind: "script", script: "", scriptRef: { scriptId: script.id, params: {} } } as never,
        ],
      }),
    });
    const exec = await request.post(`/api/v1/projects/${projectId}/apis/${def.id}/cases/execute`, {
      data: { caseIds: [caseRow.id], envId },
    });
    expect(exec.status()).toBe(422);
    expect(((await exec.json()) as { code: number }).code).toBe(20453);
  });
});

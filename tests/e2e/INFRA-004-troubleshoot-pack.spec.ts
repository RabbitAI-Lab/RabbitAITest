/**
 * INFRA-004 排障包 e2e（rules/testing §1.2 三类断言；规格 §3 原型三状态走查）：
 * 态一：失败任务报告页「排障包」按钮可见 → 点击 → 下载请求（payload/Content-Type/内容断言）
 * 态二：成功任务报告页无「排障包」按钮（不留灰态）；直发 → 422 70060
 * 失败任务构造：api_debug 目标 mock /hello 但断言期望 500（实际 200）→ ASSERT_FAILED → FAILED。
 * mock 地址口径走 s2-helpers MOCK_BASE（e2e 栈恒 :4001；服务端配置下发，与既有 spec 同源）。
 */
import { test, expect } from "./fixtures";
import { MOCK_BASE } from "./s2-helpers";

const MOCK_URL = `${MOCK_BASE}/hello`;

function debugBody(clientTaskId: string, expectStatus: string) {
  return {
    type: "api_debug" as const,
    clientTaskId,
    request: {
      method: "GET",
      url: MOCK_URL,
      headers: [],
      query: [],
      body: { kind: "none" },
      auth: { kind: "none" },
      timeoutMs: 10000,
      followRedirects: false,
      skipPre: false,
      skipPost: false,
    },
    asserts: [{ kind: "status_code", path: "", op: "eq", expected: expectStatus }],
    pre: [],
    post: [],
    extracts: [],
  };
}

test("INFRA-004-01 失败任务：排障包按钮 → 生成下载（manifest+events）", async ({
  authedPage,
  request,
  page,
  expectNoConsoleErrors,
}) => {
  const { projectId } = authedPage;

  // 构造失败任务（断言故意失败：期望 500 实际 200 → ASSERT_FAILED）
  const created = await request.post(`/api/v1/projects/${projectId}/exec-tasks`, {
    data: debugBody(`e2e-pack-fail-${Date.now()}`, "500"),
  });
  expect(created.status()).toBe(201);
  const taskId = ((await created.json()) as { data: { taskId: string } }).data.taskId;

  // 报告页：等待 FAILED 终态（SSE/轮询驱动）
  await page.goto(`/reports/${taskId}`);
  await expect(page.getByTestId("report-status")).toHaveText("FAILED", { timeout: 30_000 });

  // 按钮可见（态一）→ 点击 → 网络断言（方法+状态+头；body 由 request 直发断言——浏览器下载会消费响应体）
  const packBtn = page.getByTestId("btn-troubleshoot-pack");
  await expect(packBtn).toBeVisible();
  const packReq = page.waitForResponse(
    (r) =>
      r.url().includes(`/reports/${taskId}/troubleshoot-pack`) && r.request().method() === "POST",
  );
  await packBtn.click();
  const res = await packReq;
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("application/json");
  const direct = await request.post(
    `/api/v1/projects/${projectId}/reports/${taskId}/troubleshoot-pack`,
  );
  expect(direct.status()).toBe(200);
  const body = JSON.parse(await direct.text()) as {
    manifest: { task: { status: string; id: string } };
    events: unknown[];
    logs: string;
  };
  expect(body.manifest.task.status).toBe("FAILED"); // 接口断言：包内任务状态
  expect(body.manifest.task.id).toBe(taskId);
  expect(Array.isArray(body.events)).toBe(true);
  expect(typeof body.logs).toBe("string");

  // 下载 toast（UI 断言）
  await expect(page.getByText(/排障包已生成/)).toBeVisible({ timeout: 10_000 });
  await expectNoConsoleErrors();
});

test("INFRA-004-02 成功任务：无排障包按钮（不留灰态）+ 直发 422 70060", async ({
  authedPage,
  request,
  page,
  expectNoConsoleErrors,
}) => {
  const { projectId } = authedPage;

  const created = await request.post(`/api/v1/projects/${projectId}/exec-tasks`, {
    data: debugBody(`e2e-pack-ok-${Date.now()}`, "200"),
  });
  expect(created.status()).toBe(201);
  const taskId = ((await created.json()) as { data: { taskId: string } }).data.taskId;

  await page.goto(`/reports/${taskId}`);
  await expect(page.getByTestId("report-status")).toHaveText("SUCCESS", { timeout: 30_000 });
  await expect(page.getByTestId("btn-troubleshoot-pack")).toHaveCount(0); // 成功任务不渲染

  // 直发防护（接口断言）：成功任务 POST 排障包 → 422 70060
  const direct = await request.post(
    `/api/v1/projects/${projectId}/reports/${taskId}/troubleshoot-pack`,
  );
  expect(direct.status()).toBe(422);
  const j = (await direct.json()) as { code: number };
  expect(j.code).toBe(70060);
  await expectNoConsoleErrors();
});

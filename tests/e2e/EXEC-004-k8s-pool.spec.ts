import { test, expect } from "./fixtures";
import { loginSeedAdmin } from "./s6-helpers";

/**
 * S-future EXEC-004 e2e（规格 §5 T8）：池页切 K8S → 四项表单 → 保存掩码回显 → 切回 NODE 休眠保留。
 * 三类断言：UI（Tag/表单/掩码）+ Console（无错误）+ 接口（PUT 负载含 type=K8S 与四项）。
 */

test("EXEC-004-T8 K8S 型切换全流程：表单→保存→掩码回显→休眠往返", async ({
  page,
  request,
  context,
  expectNoConsoleErrors,
  expectApi,
}) => {
  await loginSeedAdmin(request, context);
  await page.goto("/system/pools");
  const card = page.locator('[data-testid^="pool-card-"]').first();
  await expect(card).toBeVisible({ timeout: 15000 });
  const poolId = (await card.getAttribute("data-testid"))!.replace("pool-card-", "");
  await expect(card.getByTestId(`pool-type-${poolId}`)).toHaveText("NODE");

  // 打开编辑：类型 Radio 切 K8S → 表单出现
  await card.getByTestId(`btn-edit-pool-${poolId}`).click();
  await expect(page.getByTestId("pool-type-radio")).toBeVisible();
  await page.getByTestId("pool-type-radio").getByText("K8S（集群 task-runner）").click();
  await expect(page.getByTestId("k8s-form")).toBeVisible();

  // 四项表单 + 保存（接口断言：PUT 负载 type=K8S 与四项）
  const putApi = expectApi(`**/api/v1/system/pools/${poolId}`);
  await page.getByTestId("k8s-apiserver").fill("https://k8s.e2e.internal:6443");
  await page.getByTestId("k8s-namespace").fill("rabbit-e2e");
  await page.getByTestId("k8s-token").fill("e2e-secret-token");
  await page.getByTestId("k8s-image").fill("rabbitaitest/task-runner:e2e");
  await page.getByRole("button", { name: "保 存" }).click();
  const put = await putApi;
  expect(put.status).toBe(200);
  expect(put.code).toBe(0);
  expect(JSON.stringify(put.body)).toContain('"type":"K8S"');
  expect(JSON.stringify(put.body)).toContain("k8s.e2e.internal:6443");

  // 掩码回显：type Tag=K8S + tokenSet 不回明文
  await expect(card.getByTestId(`pool-type-${poolId}`)).toHaveText("K8S", { timeout: 10000 });
  await expect(page.getByTestId(`pool-k8s-${poolId}`)).toBeVisible({ timeout: 10000 });
  const k8sText = await page.getByTestId(`pool-k8s-${poolId}`).textContent();
  expect(k8sText).toContain("已设置");
  expect(k8sText).not.toContain("e2e-secret-token");

  // 休眠往返：切回 NODE 再切回 K8S → apiServer/namespace 保留（token 不回显、留空=不改）
  await card.getByTestId(`btn-edit-pool-${poolId}`).click();
  await page.getByTestId("pool-type-radio").getByText("NODE（单机进程）").click();
  await page.getByRole("button", { name: "保 存" }).click();
  await expect(card.getByTestId(`pool-type-${poolId}`)).toHaveText("NODE", { timeout: 10000 });

  await card.getByTestId(`btn-edit-pool-${poolId}`).click();
  await page.getByTestId("pool-type-radio").getByText("K8S（集群 task-runner）").click();
  await expect(page.getByTestId("k8s-apiserver")).toHaveValue("https://k8s.e2e.internal:6443");
  await expect(page.getByTestId("k8s-namespace")).toHaveValue("rabbit-e2e");
  // 收尾：切回 NODE（不污染后续 EXEC-002 用例的池型基线）
  await page.getByTestId("pool-type-radio").getByText("NODE（单机进程）").click();
  await page.getByRole("button", { name: "保 存" }).click();
  await expect(card.getByTestId(`pool-type-${poolId}`)).toHaveText("NODE", { timeout: 10000 });

  await expectNoConsoleErrors();
});

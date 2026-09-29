import { test, expect, navFromHome } from "./fixtures";
import { bundle, createApiDef, createMockRule, getMockUrl } from "./s2-helpers";
import {
  createScenario,
  customStep,
  executeScenario,
  loopForeachStep,
  saveSteps,
} from "./s3-helpers";
import { MOCK_BASE } from "./env";

/**
 * API-007 场景参数化（规格：docs/sprint-3-scenario-automation/API-007-scenario-params-csv.md）。
 * 三类断言：UI（参数三分区/CSV 预览）+ Console + 接口（config 保存回读/foreach 迭代报告）。
 */

test("API-007-01 参数三分区：常量/列表/CSV inline 编辑→保存→回读，CSV 预览呈现", async ({
  authedPage,
  page,
  request,
  expectNoConsoleErrors,
}) => {
  const pid = authedPage.projectId;
  const uniq = `S7${Date.now() % 1e7}`;
  const sc = await createScenario(request, pid, { name: `参数场景-${uniq}` });

  await page.goto(`/scenarios/${sc.id}`);
  await page.getByTestId("scenario-tab-params").click();
  await expect(page.getByTestId("scenario-params-panel")).toBeVisible();

  // 常量：添加一行
  await page.getByTestId("params-constants").getByText("＋ 添加").click();
  await page.getByTestId("params-constants").getByPlaceholder("变量名").fill("app_id");
  await page
    .getByTestId("params-constants")
    .getByPlaceholder(/值（支持/)
    .fill("rabbit-demo");

  // 列表：添加一组
  await page.getByTestId("params-lists").getByText("＋ 添加列表").click();
  await page.getByTestId("params-lists").getByPlaceholder("列表名").fill("users");
  await page.getByTestId("params-lists").locator(".ant-select").first().click();
  await page.keyboard.type("alice");
  await page.keyboard.press("Enter");
  await page.keyboard.type("bob");
  await page.keyboard.press("Enter");

  // CSV inline：填表头 + 2 行
  await page.getByTestId("input-csv-inline").fill("name,email\nalice,a@demo.io\nbob,b@demo.io");
  // CSV 预览（前 10 行表）
  await expect(page.getByTestId("csv-preview")).toBeVisible();
  await expect(page.getByTestId("csv-preview").getByText("alice")).toBeVisible();

  // 保存 → 接口断言回读
  await page.getByTestId("btn-save-scenario").click();
  await expect(page.getByText(/已保存（v\d+）/)).toBeVisible();
  const detail = await request.get(`/api/v1/projects/${pid}/scenarios/${sc.id}`);
  const d = (await detail.json()) as {
    data: {
      config: {
        params: {
          constants: { name: string; value: string }[];
          lists: { name: string; values: string[] }[];
          csv: { source: string; inlineText?: string };
        };
      };
    };
  };
  expect(d.data.config.params.constants[0]).toMatchObject({ name: "app_id", value: "rabbit-demo" });
  expect(d.data.config.params.lists[0]!.name).toBe("users");
  expect(d.data.config.params.lists[0]!.values).toEqual(["alice", "bob"]);
  expect(d.data.config.params.csv.source).toBe("inline");
  expect(d.data.config.params.csv.inlineText).toContain("a@demo.io");

  // 变量视图（👁）：常量与列表来源呈现
  await page.getByTestId("btn-vars-view").click();
  await expect(page.getByText("变量视图（渲染优先级自上而下）")).toBeVisible();
  await expect(page.getByText("app_id")).toBeVisible();

  await expectNoConsoleErrors();
});

test("API-007-02 foreach 列表迭代：3 值→3 迭代帧→报告迭代分组+变量终值", async ({
  authedPage,
  page,
  request,
  expectNoConsoleErrors,
}) => {
  const pid = authedPage.projectId;
  const uniq = `S7${Date.now() % 1e7}`;
  const mockUrl = `${MOCK_BASE}/hello`;

  const sc = await createScenario(request, pid, {
    name: `迭代场景-${uniq}`,
    config: { params: { lists: [{ name: "users", values: ["alice", "bob", "carol"] }] } },
  });
  await saveSteps(request, pid, sc.id, [
    loopForeachStep("遍历用户", "users", customStep("按人请求", `${mockUrl}?u=` + "${item}")),
  ]);
  const taskId = await executeScenario(request, pid, sc.id);

  // 接口断言：树迭代分组 3 组 + 变量终值末行
  const tree = await (async () => {
    for (let i = 0; i < 40; i++) {
      const rep = await request.get(`/api/v1/projects/${pid}/reports/${taskId}`);
      const detail = (await rep.json()) as {
        data: { status: string; items: { itemId: string }[] };
      };
      if (detail.data.status === "SUCCESS" || detail.data.status === "FAILED") {
        const res = await request.get(
          `/api/v1/projects/${pid}/reports/${taskId}/items/${detail.data.items[0]!.itemId}/scenario-tree`,
        );
        return (await res.json()) as {
          data: {
            status: string;
            tree: { name: string; kind: string; iterations?: { iteration: number }[] }[];
            varsFinal: Record<string, string> | null;
          };
        };
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error("迭代任务轮询超时");
  })();
  expect(tree.data.status).toBe("SUCCESS");
  const loopNode = tree.data.tree.find((n) => n.kind === "loop");
  expect(loopNode, "树应含 loop 节点").toBeTruthy();
  expect(loopNode!.iterations?.map((g) => g.iteration)).toEqual([1, 2, 3]);
  expect(tree.data.varsFinal?.["item"]).toBe("carol");

  // UI：报告步骤树迭代分组呈现
  await page.goto(`/reports/${taskId}`);
  await expect(page.getByTestId("scenario-tree-card")).toBeVisible();
  await expect(page.locator('[data-testid^="tree-iter-"]').first()).toBeVisible();
  await page.getByTestId("tree-tab-vars").click();
  await expect(page.getByTestId("scenario-vars-final").getByText("item")).toBeVisible();

  await expectNoConsoleErrors();
});

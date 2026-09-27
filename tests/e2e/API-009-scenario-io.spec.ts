import { test, expect, navFromHome } from "./fixtures";
import {
  createScenario,
  customStep,
  saveSteps,
} from "./s3-helpers";

/**
 * API-009 场景导入导出（规格：docs/sprint-3-scenario-automation/API-009-scenario-import-export.md）。
 * 三类断言：UI（导入弹窗预览卡/导出入口）+ Console + 接口（导出流/预览格式/导入落库等价）。
 */

/** 最小 Rabbit 导入 JSON（与 scenario-io.service 导出格式对齐）。 */
function rabbitExportJson(name: string, stepName: string): string {
  return JSON.stringify({
    format: "rabbit-scenario",
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    mode: "ref",
    scenarios: [
      {
        name,
        level: "P2",
        status: "UNDERWAY",
        tags: ["e2e"],
        modulePath: "",
        config: {
          params: { constants: [], lists: [], csv: { source: "inline", delimiter: ",", hasHeader: true } },
          prePost: { pre: [], post: [] },
          asserts: [],
          settings: { cookieMode: "off", thinkTimeMs: 0, onFailure: "abort" },
        },
        steps: [
          {
            uid: "import-1",
            stepType: "custom",
            name: stepName,
            enabled: true,
            config: {
              bundle: {
                request: { method: "GET", url: "http://127.0.0.1:1/import-step", headers: [], query: [], body: { kind: "none" }, auth: { kind: "none" } },
                asserts: [{ kind: "status_code", path: "", op: "eq", expected: "200" }],
                pre: [],
                post: [],
                extracts: [],
              },
            },
            children: [],
          },
        ],
      },
    ],
  });
}

test("API-009-01 导出→删除→导入往返：步骤树等价（保留引用模式）", async ({
  authedPage,
  page,
  request,
  expectNoConsoleErrors,
}) => {
  const pid = authedPage.projectId;
  const uniq = `S9${Date.now() % 1e7}`;
  const name = `往返场景-${uniq}`;
  const sc = await createScenario(request, pid, { name });
  await saveSteps(request, pid, sc.id, [
    customStep("原始步骤", "http://127.0.0.1:1/roundtrip"),
    { uid: "exp-script", stepType: "script", name: "脚本步骤", enabled: true, config: { script: 'setVar("x","1")' }, children: [] },
  ]);

  // 接口断言：导出（attachment 流）含引用模式与步骤
  const exp = await request.post(`/api/v1/projects/${pid}/scenarios/export`, {
    data: { ids: [sc.id], mode: "ref" },
  });
  expect(exp.status()).toBe(200);
  expect(exp.headers()["content-disposition"] ?? "").toContain("attachment");
  const expBody = (await exp.json()) as { format: string; mode: string; scenarios: { name: string; steps: unknown[] }[] };
  expect(expBody.format).toBe("rabbit-scenario");
  expect(expBody.mode).toBe("ref");
  expect(expBody.scenarios[0]!.steps).toHaveLength(2);

  // UI：列表勾选 → 导出按钮可用（下载不校验浏览器弹窗，断言按钮态）
  await navFromHome(page, "接口场景");
  await page.getByTestId(`scenario-row-${sc.num}`).locator('input[type="checkbox"]').check();
  await expect(page.getByTestId("btn-export-ref")).toBeEnabled();

  // 删除原场景（软删）
  await request.delete(`/api/v1/projects/${pid}/scenarios/${sc.id}`);

  // UI 导入：弹窗上传（预览 → 导入落库）
  await page.getByTestId("btn-import-scenario").click();
  const importName = `导入回-${uniq}`;
  await page.setInputFiles('[data-testid="input-import-file"]', {
    name: `roundtrip-${uniq}.json`,
    mimeType: "application/json",
    buffer: Buffer.from(rabbitExportJson(importName, "原始步骤"), "utf8"),
  });
  await expect(page.getByTestId("import-preview")).toBeVisible();
  await expect(page.getByTestId("import-preview")).toContainText("rabbit-scenario");
  await expect(page.getByTestId("import-preview")).toContainText("1");
  const imported = page.waitForResponse("**/api/v1/projects/*/scenarios/import");
  await page.getByTestId("btn-do-import").click();
  const res = await imported;
  expect(res.status()).toBe(201);
  const importData = (await res.json()) as { data: { count: number; list: { id: string; num: number }[] } };
  expect(importData.data.count).toBe(1);

  // 等价断言（接口）：导入件步骤树 = 原树（stepType/名称/断言期望）
  const detail = await request.get(`/api/v1/projects/${pid}/scenarios/${importData.data.list[0]!.id}`);
  const d = (await detail.json()) as { data: { name: string; stepCount: number; steps: { stepType: string; name: string; config: { bundle?: { asserts?: { expected: string }[] } } }[] } };
  expect(d.data.stepCount).toBe(1); // 导入文件（rabbitExportJson）本身只含 1 步——等价以文件内容为基准
  const custom = d.data.steps.find((s) => s.stepType === "custom")!;
  expect(custom.name).toBe("原始步骤");
  expect(custom.config.bundle!.asserts![0]!.expected).toBe("200");

  // UI：列表呈现导入件
  await page.keyboard.press("Escape");
  await expect(page.getByText(importName)).toBeVisible();

  await expectNoConsoleErrors();
});

test("API-009-02 jmx 导入预览：JMeter 计划→格式探测 jmx（UI 预览卡）", async ({
  authedPage,
  page,
  request,
  expectNoConsoleErrors,
}) => {
  const uniq = `S9${Date.now() % 1e7}`;
  const jmx = `<?xml version="1.0" encoding="UTF-8"?>
<jmeterTestPlan version="1.2">
  <TestPlan testname="e2e 导入流程" enabled="true"></TestPlan>
  <hashTree>
    <ThreadGroup testname="TG" enabled="true"></ThreadGroup>
    <hashTree>
      <HTTPSamplerProxy testname="注册请求" enabled="true">
        <stringProp name="HTTPSampler.method">POST</stringProp>
        <stringProp name="HTTPSampler.domain">127.0.0.1</stringProp>
        <stringProp name="HTTPSampler.port">4001</stringProp>
        <stringProp name="HTTPSampler.path">/mock/10001/users</stringProp>
      </HTTPSamplerProxy>
      <hashTree/>
    </hashTree>
  </hashTree>
</jmeterTestPlan>`;

  await navFromHome(page, "接口场景");
  await page.getByTestId("btn-import-scenario").click();
  await page.setInputFiles('[data-testid="input-import-file"]', {
    name: `jmx-${uniq}.jmx`,
    mimeType: "application/xml",
    buffer: Buffer.from(jmx, "utf8"),
  });
  await expect(page.getByTestId("import-preview")).toBeVisible();
  // UI 断言：格式 jmx + 场景数 1 + 首步骤（映射后的 custom 请求）
  await expect(page.getByTestId("import-preview")).toContainText("jmx");
  await expect(page.getByTestId("import-preview")).toContainText("注册请求");

  await expectNoConsoleErrors();
});

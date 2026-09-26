import type { APIRequestContext } from "@playwright/test";
import { test, expect, navFromHome } from "./fixtures";

/**
 * 规格：docs/sprint-1-mvp-test-mgmt/CASE-005-case-review.md §5（T2 multi 聚合+通过率、T3 重新提审、T4 结束只读；T1 的
 * 「失败必填意见」前端禁用路径）
 * 选择器来源（已核对源码）：
 * - apps/web/src/app/(console)/reviews/page.tsx：btn-new-review / input-review-name / select-review-mode /
 *   MemberSelect（评审人，placeholder=选择评审人（可多选），选项 label=`${name}（${email}）`）/ btn-submit-review
 * - apps/web/src/app/(console)/reviews/[id]/page.tsx：review-circle（通过率环形图，AntD Progress circle 文本=百分比）/
 *   btn-add-review-cases → link-cases-modal（模块树+用例多选，btn-confirm-link-cases）/ review-case-item-{num} /
 *   judge-btn-PASS|FAIL|SUGGEST / judge-comment-input / btn-submit-judge（意见空且 FAIL/SUGGEST 时 disabled）/
 *   重新提审徽标（warning Tag 文本「重新提审」，reSubmit=true 时）/ btn-close-review-detail → Popconfirm「确认结束」
 * - 聚合与重新提审语义（已核对 review.service.ts / caseV2.service.ts）：multi 模式 1 评审人全员 PASS → PASS；
 *   用例 name/steps/level/fields 变更（PUT version 乐观锁）→ 未结束评审中 result 重置 PENDING + reSubmit=true
 *   （项目开关 case_review.re_submit 默认开启，无需预置）
 * 数据隔离：authedPage 每用例独立项目；用例/评审均自建（01 走 UI 建评审，02 走 API 建评审聚焦标记交互）。
 */

interface CaseRow {
  id: string;
  num: number;
  name: string;
  precondition: string;
  steps: { desc: string; expect: string }[];
  level: string;
  tags: string[];
  moduleId: string;
  fields: Record<string, unknown>;
  version: number;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** API 造用例（POST /cases → 201，返回全量字段供 PUT 乐观锁复用） */
async function apiCreateCase(
  request: APIRequestContext,
  projectId: string,
  body: { name: string; steps?: { desc: string; expect: string }[] },
): Promise<CaseRow> {
  const res = await request.post(`/api/v1/projects/${projectId}/cases`, {
    data: { precondition: "", level: "P2", tags: [], fields: {}, ...body },
  });
  expect(res.status()).toBe(201);
  const json = (await res.json()) as { code: number; data: CaseRow };
  expect(json.code).toBe(0);
  return json.data;
}

test("CASE-005-01 多人评审聚合与重新提审", async ({
  authedPage,
  page,
  request,
  expectNoConsoleErrors,
  expectApi,
}) => {
  const uniq = `${Date.now() % 100000}`;
  const caseName = `评审用例${uniq}`;
  const reviewName = `多人评审${uniq}`;
  const kase = await apiCreateCase(request, authedPage.projectId, {
    name: caseName,
    steps: [{ desc: "输入账号密码", expect: "登录成功进入工作台" }],
  });

  // 用户路径：首页 → 左侧菜单「用例评审」
  await navFromHome(page, "用例评审");
  await expect(page.getByTestId("input-review-keyword")).toBeVisible();

  // 新建 multi 评审（UI）：名称 + 模式=多人 + 评审人=自己（新项目唯一成员，按 email 定位 MemberSelect 选项）
  await page.getByTestId("btn-new-review").click();
  await page.getByTestId("input-review-name").fill(reviewName);
  await page.getByTestId("select-review-mode").click();
  await page.getByRole("option", { name: "多人（全员通过才通过）" }).click();
  // MemberSelect（crosscut.tsx）已挂 data-testid=select-reviewers（同页多实例由调用方区分）；
  // antd 5.29 多选 Select 的 placeholder 覆盖层会被 selection-overflow 容器拦截点击 → 点击 Select 根节点展开
  await page.getByTestId("select-reviewers").click();
  await page.getByRole("option", { name: new RegExp(escapeRegExp(authedPage.email)) }).click();
  const createApi = expectApi("**/api/v1/projects/*/reviews");
  await page.getByTestId("btn-submit-review").click();
  const created = await createApi;
  // 接口断言：POST /reviews 201 + code=0
  expect(created.status).toBe(201);
  expect(created.code).toBe(0);
  // UI 断言：创建成功后自动进入评审详情
  await expect(page).toHaveURL(/\/reviews\//, { timeout: 8000 });
  await expect(page.getByTestId("review-case-list")).toBeVisible();

  // 详情页关联用例（弹窗勾选该用例 → 关联 1 条）
  await page.getByTestId("btn-add-review-cases").click();
  await expect(page.getByTestId("link-cases-modal")).toBeVisible();
  await page
    .getByRole("row", { name: new RegExp(caseName) })
    .getByRole("checkbox")
    .check();
  const linkApi = expectApi("**/api/v1/projects/*/reviews/*/cases");
  await page.getByTestId("btn-confirm-link-cases").click();
  const linked = await linkApi;
  // 接口断言：批量关联 added=1
  expect(linked.status).toBe(200);
  expect(linked.code).toBe(0);
  expect((linked.data as { added: number }).added).toBe(1);
  // UI 断言：清单出现该用例
  await expect(page.getByText(/已关联 1 条用例/)).toBeVisible({ timeout: 8000 });
  await expect(page.getByTestId(`review-case-item-${kase.num}`)).toBeVisible();

  // 底部操作条：通过 → 提交（multi + 单评审人 = 全员通过 → result=PASS）
  await page.getByTestId("judge-btn-PASS").click();
  const judgeApi = expectApi("**/api/v1/projects/*/reviews/*/cases/*/judge");
  await page.getByTestId("btn-submit-judge").click();
  const judged = await judgeApi;
  // 接口断言：judge 200 + code=0 + result=PASS（服务端聚合结果）
  expect(judged.status).toBe(200);
  expect(judged.code).toBe(0);
  expect((judged.data as { result: string }).result).toBe("PASS");
  // UI 断言：标记 toast + 通过率环 100%（1/1 全通过）
  await expect(page.getByText("已标记「通过」")).toBeVisible({ timeout: 8000 });
  await expect(page.getByTestId("review-circle").getByText("100%")).toBeVisible();

  // 编辑用例（API PUT 改名，version 乐观锁）→ 评审中该用例回 PENDING + 重新提审徽标
  const putRes = await request.put(`/api/v1/projects/${authedPage.projectId}/cases/${kase.id}`, {
    data: {
      name: `${caseName}-改`,
      precondition: kase.precondition,
      steps: kase.steps,
      level: kase.level,
      tags: kase.tags,
      fields: kase.fields,
      moduleId: kase.moduleId,
      version: kase.version,
    },
  });
  expect(putRes.status()).toBe(200);
  // 重新进入评审详情（外部变更需重新加载；录屏路径=刷新当前详情页）
  await page.reload();
  await expect(page.getByTestId("review-case-list")).toBeVisible();
  // UI 断言：橙色「重新提审」徽标 + 通过率环回 0%（result 已重置 PENDING）
  await expect(page.getByText("重新提审")).toBeVisible({ timeout: 8000 });
  await expect(page.getByTestId("review-circle").getByText("0%")).toBeVisible();

  await expectNoConsoleErrors();
});

test("CASE-005-02 失败必填意见与结束只读", async ({
  authedPage,
  page,
  request,
  expectNoConsoleErrors,
  expectApi,
}) => {
  const uniq = `${Date.now() % 100000}`;
  const caseName = `失败意见用例${uniq}`;
  const reviewName = `失败意见评审${uniq}`;
  const kase = await apiCreateCase(request, authedPage.projectId, { name: caseName });

  // API 建评审（multi、评审人=自己、直接关联用例）——本条聚焦标记交互，造数走接口
  const meRes = await request.get("/api/v1/personal/me");
  expect(meRes.status()).toBe(200);
  const me = (await meRes.json()) as { code: number; data: { userId: string } };
  expect(me.code).toBe(0);
  const reviewRes = await request.post(`/api/v1/projects/${authedPage.projectId}/reviews`, {
    data: {
      name: reviewName,
      reviewMode: "MULTI",
      reviewers: [me.data.userId],
      caseIds: [kase.id],
    },
  });
  expect(reviewRes.status()).toBe(201);
  const reviewBody = (await reviewRes.json()) as { code: number; data: { id: string } };
  expect(reviewBody.code).toBe(0);

  // 用户路径：首页 → 用例评审 → 评审名称进入详情
  await navFromHome(page, "用例评审");
  await expect(page.getByTestId("input-review-keyword")).toBeVisible();
  await page.getByRole("link", { name: reviewName }).click();
  await expect(page).toHaveURL(new RegExp(`/reviews/${reviewBody.data.id}`));
  await expect(page.getByTestId(`review-case-item-${kase.num}`)).toBeVisible();

  // 失败：意见为空 → 必填提示 + 提交禁用（前端禁用，rules/testing §3.1 UI 状态断言）
  await page.getByTestId("judge-btn-FAIL").click();
  await expect(page.getByText("选择失败 / 建议时必须填写评审意见")).toBeVisible();
  await expect(page.getByTestId("btn-submit-judge")).toBeDisabled();

  // 填意见 → 提交成功（multi 1 评审人 FAIL → 聚合 FAIL）
  await page.getByTestId("judge-comment-input").fill("步骤预期结果不明确，请补充后再评审");
  await expect(page.getByTestId("btn-submit-judge")).toBeEnabled();
  const judgeApi = expectApi("**/api/v1/projects/*/reviews/*/cases/*/judge");
  await page.getByTestId("btn-submit-judge").click();
  const judged = await judgeApi;
  // 接口断言：judge 200 + code=0 + result=FAIL
  expect(judged.status).toBe(200);
  expect(judged.code).toBe(0);
  expect((judged.data as { result: string }).result).toBe("FAIL");
  // UI 断言：标记 toast + 右侧速览结果 Tag=失败（exact 匹配排除统计行/按钮等含「失败」的长文本）
  await expect(page.getByText("已标记「失败」")).toBeVisible({ timeout: 8000 });
  await expect(page.getByText("失败", { exact: true })).toBeVisible();

  // 结束评审（Popconfirm）→ 操作条消失、头部状态=已结束（只读）
  await page.getByTestId("btn-close-review-detail").click();
  const closeApi = expectApi("**/api/v1/projects/*/reviews/*/close");
  await page.getByRole("button", { name: "确认结束" }).click();
  const closed = await closeApi;
  // 接口断言：close 200 + code=0 + status=ENDED
  expect(closed.status).toBe(200);
  expect(closed.code).toBe(0);
  expect((closed.data as { status: string }).status).toBe("ENDED");
  // UI 断言：结束 toast + 头部「已结束」Tag + 底部操作条与结束按钮消失（只读）
  await expect(page.getByText("评审已结束")).toBeVisible({ timeout: 8000 });
  await expect(page.getByText("已结束", { exact: true })).toBeVisible();
  await expect(page.getByTestId("judge-btn-PASS")).toHaveCount(0);
  await expect(page.getByTestId("judge-btn-FAIL")).toHaveCount(0);
  await expect(page.getByTestId("btn-close-review-detail")).toHaveCount(0);

  await expectNoConsoleErrors();
});

/** coverage-audit 回补：CASE-005 §1.2 行 5 后半「重新提审受项目应用设置开关控制」的**关闭态**（规格 §5 T3
 *  「关闭开关后编辑不重置」声明但从未落地；开启态已由 CASE-005-01 + jmx T1-7 覆盖——开关开/关二态补齐）。
 *  期望值溯源规格 §2：触达条件=用例 update 白名单字段；开关关闭则不触发（不重置 result、不置 reSubmit）。
 *  设置端点：PUT /api/v1/projects/{pid}/settings/case-review（S1 无设置 UI，契约层断言 + UI 验证徽标不出现）。 */
test("CASE-005-03 重新提审开关关闭：编辑用例不重置评审结果", async ({
  authedPage,
  page,
  request,
  expectNoConsoleErrors,
}) => {
  const uniq = `${Date.now() % 100000}`;
  const caseName = `开关关闭用例${uniq}`;
  const reviewName = `开关关闭评审${uniq}`;
  const kase = await apiCreateCase(request, authedPage.projectId, { name: caseName });

  // API 建评审（multi、评审人=自己、直接关联）→ 标记 PASS（受控前置：开启态语义同 05-01，此处只为取得已评状态）
  const meRes = await request.get("/api/v1/personal/me");
  const me = ((await meRes.json()) as { code: number; data: { userId: string } }).data;
  const reviewRes = await request.post(`/api/v1/projects/${authedPage.projectId}/reviews`, {
    data: { name: reviewName, reviewMode: "MULTI", reviewers: [me.userId], caseIds: [kase.id] },
  });
  expect(reviewRes.status()).toBe(201);
  const review = ((await reviewRes.json()) as { data: { id: string } }).data;
  const judgeRes = await request.post(
    `/api/v1/projects/${authedPage.projectId}/reviews/${review.id}/cases/${kase.id}/judge`,
    { data: { result: "PASS", comment: "" } },
  );
  expect(judgeRes.status()).toBe(200);

  // 关闭重新提审开关（接口断言 PUT 200 + 读回 false）
  const offRes = await request.put(
    `/api/v1/projects/${authedPage.projectId}/settings/case-review`,
    { data: { enabled: false } },
  );
  expect(offRes.status()).toBe(200);
  expect(((await offRes.json()) as { data: { reSubmitEnabled: boolean } }).data.reSubmitEnabled).toBe(false);

  // 编辑用例（name 属白名单字段，version 乐观锁）——开关关闭 → 不重置
  const putRes = await request.put(
    `/api/v1/projects/${authedPage.projectId}/cases/${kase.id}`,
    {
      data: {
        name: `${caseName}-改`,
        precondition: kase.precondition,
        steps: kase.steps,
        level: kase.level,
        tags: kase.tags,
        fields: kase.fields,
        moduleId: kase.moduleId,
        version: kase.version,
      },
    },
  );
  expect(putRes.status()).toBe(200);

  // 接口断言：评审结果仍 PASS、reSubmit=false（未重置）
  const detailRes = await request.get(
    `/api/v1/projects/${authedPage.projectId}/reviews/${review.id}`,
  );
  expect(detailRes.status()).toBe(200);
  const detail = (await detailRes.json()) as {
    data: { cases: { caseId: string; result: string; reSubmit: boolean }[] };
  };
  const rc = detail.data.cases.find((c) => c.caseId === kase.id);
  expect(rc?.result).toBe("PASS");
  expect(rc?.reSubmit).toBe(false);

  // 用户路径：首页 → 用例评审 → 进详情——通过率 100%（未回 pending）且无「重新提审」徽标
  await navFromHome(page, "用例评审");
  await expect(page.getByTestId("input-review-keyword")).toBeVisible();
  await page.getByRole("link", { name: reviewName }).click();
  await expect(page).toHaveURL(new RegExp(`/reviews/${review.id}`));
  await expect(page.getByTestId("review-circle").getByText("100%")).toBeVisible();
  await expect(page.getByText("重新提审")).toHaveCount(0);

  await expectNoConsoleErrors();
});

/** coverage-audit 回补：CASE-005 §1.2 行 6「评审历史：每条 ReviewCase 的标记时间线」整行无覆盖 + 行 2 子能力
 *  「自动下一条开关」「按状态筛选」（规格 §3：历史弹窗=人/结果/意见/时间；自动下一条=提交后选中下一条未评用例）。
 *  页面实现：reviews/[id]/page.tsx（btn-review-history → review-history 时间线 / switch-auto-next /
 *  review-filter-result；提交按钮文案「提交并下一条」，autoNext 开启时跳到下一 pending 用例）。 */
test("CASE-005-04 评审历史时间线、自动下一条与状态筛选", async ({
  authedPage,
  page,
  request,
  expectNoConsoleErrors,
  expectApi,
}) => {
  const uniq = `${Date.now() % 100000}`;
  const nameA = `历史用例A${uniq}`;
  const nameB = `历史用例B${uniq}`;
  const caseA = await apiCreateCase(request, authedPage.projectId, { name: nameA });
  const caseB = await apiCreateCase(request, authedPage.projectId, { name: nameB });

  // API 建评审（multi、评审人=自己、关联 2 条）
  const meRes = await request.get("/api/v1/personal/me");
  const me = ((await meRes.json()) as { code: number; data: { userId: string } }).data;
  const reviewRes = await request.post(`/api/v1/projects/${authedPage.projectId}/reviews`, {
    data: {
      name: `历史评审${uniq}`,
      reviewMode: "MULTI",
      reviewers: [me.userId],
      caseIds: [caseA.id, caseB.id],
    },
  });
  expect(reviewRes.status()).toBe(201);
  const review = ((await reviewRes.json()) as { data: { id: string } }).data;

  // 用户路径：首页 → 用例评审 → 进详情；默认选中第 1 条（A）
  await navFromHome(page, "用例评审");
  await expect(page.getByTestId("input-review-keyword")).toBeVisible();
  await page.getByRole("link", { name: `历史评审${uniq}` }).click();
  await expect(page).toHaveURL(new RegExp(`/reviews/${review.id}`));
  // 服务端按 ReviewCase.id（UUID）排序，默认选中不保证是 A——显式选中 A 再断言右侧速览链接
  await page.getByTestId(`review-case-item-${caseA.num}`).click();
  await expect(page.locator(`a[href="/cases/${caseA.id}"]`)).toBeVisible();
  // 自动下一条开关默认开启（reviews/[id]/page.tsx useState(true)）
  await expect(page.getByTestId("switch-auto-next")).toHaveAttribute("aria-checked", "true");

  // 标记 A 为 FAIL（意见必填）→ 提交并下一条：自动跳到 B（右侧速览切换）
  await page.getByTestId("judge-btn-FAIL").click();
  await page.getByTestId("judge-comment-input").fill("步骤预期不明确");
  const judgeApi = expectApi("**/api/v1/projects/*/reviews/*/cases/*/judge");
  await page.getByTestId("btn-submit-judge").click();
  const judged = await judgeApi;
  expect(judged.status).toBe(200);
  expect((judged.data as { result: string }).result).toBe("FAIL");
  await expect(page.locator(`a[href="/cases/${caseB.id}"]`)).toBeVisible({ timeout: 8000 });
  await expect(page.locator(`a[href="/cases/${caseA.id}"]`)).toHaveCount(0);

  // 按状态筛选：未评审 → 仅剩 B；通过 → 空态；全部 → 2 条
  await page.getByTestId("review-filter-result").click();
  await page.getByRole("option", { name: "未评审" }).click();
  await expect(page.getByTestId("review-case-item-" + caseB.num)).toBeVisible();
  await expect(page.getByTestId("review-case-item-" + caseA.num)).toHaveCount(0);
  await page.getByTestId("review-filter-result").click();
  await page.getByRole("option", { name: "通过" }).click();
  await expect(page.getByText("无该状态用例")).toBeVisible();
  // 回「全部状态」并选中 A → 打开评审历史
  await page.getByTestId("review-filter-result").click();
  await page.getByRole("option", { name: "全部状态" }).click();
  await page.getByTestId("review-case-item-" + caseA.num).click();
  await page.getByTestId("btn-review-history").click();
  const historyDialog = page.getByRole("dialog");
  await expect(historyDialog).toContainText("评审历史");
  await expect(page.getByTestId("review-history")).toBeVisible();
  await expect(page.getByTestId("review-history").getByText("失败", { exact: true })).toBeVisible();
  await expect(page.getByTestId("review-history").getByText("步骤预期不明确")).toBeVisible();

  await expectNoConsoleErrors();
});

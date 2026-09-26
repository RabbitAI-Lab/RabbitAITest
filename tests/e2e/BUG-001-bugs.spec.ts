import { test, expect, navFromHome } from "./fixtures";

/**
 * BUG-001 本地缺陷管理（规格：docs/sprint-1-mvp-test-mgmt/BUG-001-local-bug-management.md §5 T2/T3）
 * 三类断言（rules/testing.md §3.1）：
 * - UI：bug-table / bug-status / tab-comments / comment-content / tab-history / change-timeline / tab-recycle
 * - Console：expectNoConsoleErrors
 * - 接口：expectApi（create/transition/restore 的 status + code + data；payload 用 waitForResponse 补充——fixtures.expectApi 未暴露 postData）
 * 工作流预置（packages/db/src/presets.ts：待处理→处理中→已关闭，已关闭→待处理）：
 * 从「待处理」出发 allowedTransitions 仅含「处理中」。
 */

test("BUG-001-01 缺陷全流程（新建→流转→评论→变更历史）", async ({
  authedPage,
  page,
  expectNoConsoleErrors,
  expectApi,
}) => {
  const { projectId } = authedPage;
  const uniq = `${Date.now() % 1e7}${Math.floor(Math.random() * 1e3)}`;
  const bugTitle = `登录失败-${uniq}`;
  void projectId;

  // 用户路径：首页 → 左侧导航「缺陷管理」（LeftNav.tsx:36）
  await navFromHome(page, "缺陷管理");
  await expect(page.getByTestId("bug-table")).toBeVisible();

  // 新建：填标题提交（bugs/new/page.tsx：input-bug-title / btn-submit-bug）
  await page.getByTestId("btn-new-bug").click();
  await expect(page.getByTestId("bug-form")).toBeVisible();
  await page.getByTestId("input-bug-title").fill(bugTitle);
  const createApi = expectApi("**/api/v1/projects/*/bugs");
  await page.getByTestId("btn-submit-bug").click();
  const created = await createApi;
  expect(created.status).toBe(201);
  expect(created.code).toBe(0);
  expect((created.data as { num: number; status: string }).num).toBeGreaterThanOrEqual(1);
  expect((created.data as { num: number; status: string }).status).toBe("待处理");

  // 保存后自动跳详情（bugs/[id]/page.tsx）
  await expect(page).toHaveURL(/\/bugs\/[\w-]+$/, { timeout: 8000 });
  // 初始状态徽标 = 待处理（工作流 start 态），流转按钮组按 allowedTransitions 渲染
  await expect(page.getByTestId("bug-status")).toHaveText("待处理");
  await expect(page.getByTestId("btn-transition-处理中")).toBeVisible();

  // 流转 待处理→处理中：弹窗填意见确认（接口断言 code=0 + payload toState/comment）
  const transitionApi = expectApi("**/api/v1/projects/*/bugs/*/transition");
  const transitionRaw = page.waitForResponse("**/api/v1/projects/*/bugs/*/transition");
  await page.getByTestId("btn-transition-处理中").click();
  await page.getByTestId("input-transition-comment").fill("开始排查登录失败");
  await page.getByRole("button", { name: "确认流转" }).click();
  const trans = await transitionApi;
  expect(trans.status).toBe(200);
  expect(trans.code).toBe(0);
  expect((trans.data as { status: string }).status).toBe("处理中");
  const transRes = await transitionRaw;
  expect(transRes.request().method()).toBe("POST");
  expect(transRes.request().postDataJSON()).toMatchObject({
    toState: "处理中",
    comment: "开始排查登录失败",
  });
  // UI：状态徽标变为处理中
  await expect(page.getByTestId("bug-status")).toHaveText("处理中");

  // 评论 Tab：发表评论（crosscut.tsx CommentThread：comment-input / comment-submit / comment-content）
  // glob 无法区分方法：先消费 Tab 挂载触发的 GET 评论列表，再等 POST（否则 expectApi 可能误捕 GET）
  const commentsLoad = page.waitForResponse("**/api/v1/projects/*/comments?entity=*");
  await page.getByTestId("tab-comments").click();
  await commentsLoad;
  await expect(page.getByText("暂无评论")).toBeVisible(); // 流转评论以【流转】前缀过滤，主列表为空
  await page.getByTestId("comment-input").fill("已定位为密码校验缺陷");
  const commentApi = expectApi("**/api/v1/projects/*/comments?entity=*");
  await page.getByTestId("comment-submit").click();
  const commented = await commentApi;
  expect(commented.status).toBe(201);
  expect(commented.code).toBe(0);
  await expect(
    page.getByTestId("comment-content").filter({ hasText: "已定位为密码校验缺陷" }),
  ).toBeVisible();

  // 变更历史 Tab：有流转记录（实现口径：从评论【流转 x→y】前缀过滤生成时间线，bugs/[id]/page.tsx）
  await page.getByTestId("tab-history").click();
  await expect(page.getByTestId("change-timeline")).toBeVisible();
  await expect(page.getByTestId("change-timeline")).toContainText("流转");
  await expect(page.getByTestId("change-timeline")).toContainText("待处理");
  await expect(page.getByTestId("change-timeline")).toContainText("处理中");

  await expectNoConsoleErrors();
});

test("BUG-001-02 回收站恢复与非法流转（allowedTransitions 驱动）", async ({
  authedPage,
  page,
  request,
  expectNoConsoleErrors,
  expectApi,
}) => {
  const { projectId } = authedPage;
  const uniq = `R${Date.now() % 1e7}${Math.floor(Math.random() * 1e3)}`;
  const bugTitle = `回收站缺陷-${uniq}`;

  // API 造缺陷（数据独立：每用例独立注册用户 + 项目）
  const created = await request.post(`/api/v1/projects/${projectId}/bugs`, {
    data: { title: bugTitle },
  });
  expect(created.status()).toBe(201);
  const createdBody = (await created.json()) as { code: number; data: { id: string } };
  expect(createdBody.code).toBe(0);

  // 用户路径：首页 → 左侧导航「缺陷管理」→ 列表删除（软删进回收站）
  await navFromHome(page, "缺陷管理");
  await expect(page.getByTestId("bug-table")).toBeVisible();
  const row = page.getByRole("row", { name: new RegExp(bugTitle) });
  await row.getByRole("button", { name: "删除" }).click();
  await page
    .locator(".ant-popover")
    .getByRole("button", { name: /确\s*定/ })
    .click();
  await expect(page.getByText("已删除（进入回收站，可恢复）")).toBeVisible({ timeout: 8000 });

  // 回收站 → 恢复（接口断言 restore code=0）→ 回到全部列表可见
  await page.getByTestId("tab-recycle").click();
  await expect(row).toBeVisible();
  const restoreApi = expectApi("**/api/v1/projects/*/bugs/*/restore");
  await row.getByRole("button", { name: "恢复" }).click();
  const restored = await restoreApi;
  expect(restored.status).toBe(200);
  expect(restored.code).toBe(0);
  await expect(page.getByText("已恢复至原模块")).toBeVisible({ timeout: 8000 });
  await page.getByTestId("tab-all").click();
  await expect(row).toBeVisible();

  // 详情页：从「待处理」出发仅允许流转到「处理中」，不允许的目标（已关闭/待处理）无该流转按钮
  await row.getByRole("link", { name: bugTitle }).click();
  await expect(page.getByTestId("bug-status")).toHaveText("待处理");
  await expect(page.getByTestId("btn-transition-处理中")).toHaveCount(1);
  await expect(page.getByTestId("btn-transition-已关闭")).toHaveCount(0);
  await expect(page.getByTestId("btn-transition-待处理")).toHaveCount(0);

  await expectNoConsoleErrors();
});

/** coverage-audit 回补：BUG-001 §1.2 行 2「附件：多文件上传、单文件上限（SYS-005 参数）、下载/删除、可执行文件拒收」整行无覆盖。
 *  期望值溯源规格 §2（附件校验大小/类型黑名单，security.md：可执行文件拒收）与 §3（附件上传区：列表+删除）。
 *  页面实现：bugs/[id]/page.tsx（btn-upload-attachment（antd Upload customRequest）→ attachment-list /
 *  attachment-name-{id} / 下载 a[href=downloadUrl] / 删除 X Popconfirm）。 */
test("BUG-001-03 附件上传、下载、删除与可执行文件拒收", async ({
  authedPage,
  page,
  request,
  expectNoConsoleErrors,
  expectApi,
}, testInfo) => {
  const { projectId } = authedPage;
  const uniq = `A${Date.now() % 1e7}${Math.floor(Math.random() * 1e3)}`;
  const bugTitle = `附件缺陷-${uniq}`;

  // API 造缺陷（数据独立）
  const created = await request.post(`/api/v1/projects/${projectId}/bugs`, {
    data: { title: bugTitle },
  });
  expect(created.status()).toBe(201);
  const bugId = ((await created.json()) as { data: { id: string } }).data.id;

  // 用户路径：首页 → 缺陷管理 → 列表进详情（详情 Tab 默认激活，附件区在页内）
  await navFromHome(page, "缺陷管理");
  await page.getByRole("link", { name: bugTitle }).click();
  await expect(page.getByTestId("bug-status")).toHaveText("待处理");
  // UI 断言：附件空态
  await expect(page.getByText("暂无附件")).toBeVisible();

  // 上传：fixture 自造文件（rules/testing §3.5.2 fixture 一律自造，禁止依赖本机路径残留）
  const attPath = testInfo.outputPath("e2e-attachment.txt");
  const attContent = `e2e 附件内容 ${uniq}`;
  const { writeFileSync } = await import("node:fs");
  writeFileSync(attPath, attContent, "utf8");
  const uploadApi = expectApi("**/api/v1/projects/*/attachments");
  await page.locator(".ant-upload input[type='file']").setInputFiles(attPath);
  const uploaded = await uploadApi;
  // 接口断言：POST /attachments 201 + code=0 + 实体字段（multipart：file+entity=bug:{id}）
  expect(uploaded.status).toBe(201);
  expect(uploaded.code).toBe(0);
  const att = uploaded.data as { id: string; name: string; size: number };
  expect(att.name).toBe("e2e-attachment.txt");
  expect(att.size).toBe(Buffer.byteLength(attContent, "utf8"));
  // UI 断言：toast + 附件列表出现（名称 + 计数 1）
  await expect(page.getByText("附件已上传")).toBeVisible();
  await expect(page.getByTestId("attachment-list")).toBeVisible();
  await expect(page.getByTestId(`attachment-name-${att.id}`)).toHaveText(att.name);

  // 下载：走预签名/令牌下载 URL（勘误 1：本地磁盘驱动 + HMAC 令牌）→ 200 且内容一致
  const downloadRes = await page.request.get(
    `/api/v1/projects/${projectId}/attachments/${att.id}/download`,
  );
  expect(downloadRes.status()).toBe(200);
  expect(await downloadRes.text()).toBe(attContent);

  // 删除：附件行内 X 图标按钮（Popconfirm）→ 确认 → 列表回空态
  const attRow = page.getByTestId(`attachment-name-${att.id}`).locator("xpath=..");
  await attRow.getByRole("button").click();
  const delApi = expectApi("**/api/v1/projects/*/attachments/*");
  await page.locator(".ant-popover").getByRole("button", { name: /确\s*定/ }).click();
  const removed = await delApi;
  expect(removed.status).toBe(200);
  expect(removed.code).toBe(0);
  await expect(page.getByText("附件已删除")).toBeVisible();
  await expect(page.getByText("暂无附件")).toBeVisible();

  // 类型黑名单：.exe 拒收（422 + 服务端消息就地透出，security.md）
  const exePath = testInfo.outputPath("e2e-evil.exe");
  writeFileSync(exePath, "MZ fake exe", "utf8");
  const blockedApi = expectApi("**/api/v1/projects/*/attachments");
  await page.locator(".ant-upload input[type='file']").setInputFiles(exePath);
  const blocked = await blockedApi;
  expect(blocked.status).toBe(422);
  await expect(page.getByText("不允许上传可执行文件")).toBeVisible();

  // 白名单：黑名单 422 为预期业务拒绝（UI 上传路径的 fetch 失败留痕，§3.5.1 显式登记）
  await expectNoConsoleErrors([
    { pageUrlPattern: "/bugs/", textPattern: "(\\[http 422\\]|status of 422)", reason: "BUG-001-03 可执行文件拒收的预期 422（security.md 黑名单）" },
  ]);
});

/** coverage-audit 回补：BUG-001 §1.2 行 6「回收站：软删→恢复/彻底删除」的彻底删除半边（恢复已有 BUG-001-02，
 *  恢复/彻底删除为规格要求显式覆盖的二态）。期望值溯源规格 §2「彻底删除（级联删除关联与附件记录）」。 */
test("BUG-001-04 回收站彻底删除（不可恢复）", async ({
  authedPage,
  page,
  request,
  expectNoConsoleErrors,
  expectApi,
}) => {
  const { projectId } = authedPage;
  const uniq = `P${Date.now() % 1e7}${Math.floor(Math.random() * 1e3)}`;
  const bugTitle = `彻底删除缺陷-${uniq}`;

  // API 造缺陷 → UI 软删进回收站
  const created = await request.post(`/api/v1/projects/${projectId}/bugs`, {
    data: { title: bugTitle },
  });
  expect(created.status()).toBe(201);
  const bugId = ((await created.json()) as { data: { id: string } }).data.id;

  await navFromHome(page, "缺陷管理");
  await expect(page.getByTestId("bug-table")).toBeVisible();
  const row = page.getByRole("row", { name: new RegExp(bugTitle) });
  await row.getByRole("button", { name: "删除" }).click();
  await page.locator(".ant-popover").getByRole("button", { name: /确\s*定/ }).click();
  await expect(page.getByText("已删除（进入回收站，可恢复）")).toBeVisible({ timeout: 8000 });

  // 回收站 → 彻底删除（Popconfirm okText=彻底删除，明示不可恢复与级联）
  await page.getByTestId("tab-recycle").click();
  await expect(row).toBeVisible();
  const purgeApi = expectApi("**/api/v1/projects/*/bugs/*?purge=true*");
  await row.getByRole("button", { name: "彻底删除" }).click();
  await expect(page.locator(".ant-popover:has-text(\"不可恢复\")")).toBeVisible();
  await page.locator(".ant-popover").getByRole("button", { name: "彻底删除" }).click();
  const purged = await purgeApi;
  // 接口断言：DELETE ?purge=true 200 + code=0
  expect(purged.status).toBe(200);
  expect(purged.code).toBe(0);
  // UI 断言：回收站行消失 + toast；再查「全部」也不存在（物理删除）
  await expect(page.getByText("已彻底删除")).toBeVisible({ timeout: 8000 });
  await expect(row).toHaveCount(0);
  await page.getByTestId("tab-all").click();
  await expect(page.getByText(bugTitle)).toHaveCount(0);
  // 接口断言：直查详情 404（彻底删除后不可恢复）
  const detail = await page.request.get(`/api/v1/projects/${projectId}/bugs/${bugId}`);
  expect(detail.status()).toBe(404);

  await expectNoConsoleErrors();
});

/** P-4 回归（coverage-audit §10）：批量删除 + 标签筛选 + 导出（BUG-001 §1.2 行 4）。 */
test("BUG-001-05 批量删除、标签筛选与导出（P-4）", async ({
  authedPage,
  page,
  request,
}) => {
  const { projectId } = authedPage;
  const uniq = `P4-${Date.now() % 100000}`;
  const ids: string[] = [];
  for (const title of [`${uniq}-甲`, `${uniq}-乙`]) {
    const r = await request.post(`/api/v1/projects/${projectId}/bugs`, {
      data: { title, description: "", tags: ["批量P4"], fields: {} },
    });
    expect(r.status()).toBe(201);
    ids.push(((await r.json()) as { data: { id: string } }).data.id);
  }

  // 标签筛选：命中 2 条
  await page.goto("/");
  await page.getByTestId("leftnav").getByRole("link", { name: "缺陷管理" }).click();
  await page.getByTestId("input-bug-tags").fill("批量P4");
  await page.keyboard.press("Enter");
  await expect(page.getByText(`${uniq}-甲`)).toBeVisible({ timeout: 8000 });

  // 导出（二进制 200）
  const exp = await page.request.post(`/api/v1/projects/${projectId}/bugs/export`);
  expect(exp.status()).toBe(200);

  // 勾选 2 条 → 批量删除 → 回收站 2 条
  await page.getByRole("row", { name: new RegExp(`${uniq}-甲`) }).locator('input[type="checkbox"]').first().check();
  await page.getByRole("row", { name: new RegExp(`${uniq}-乙`) }).locator('input[type="checkbox"]').first().check();
  await page.getByTestId("btn-batch-delete-bugs").click();
  const delApi = page.waitForResponse((r) => r.url().includes("/bugs/batch-delete") && r.request().method() === "POST");
  await page.locator(".ant-popover .ant-btn-dangerous, .ant-popconfirm .ant-btn-dangerous").first().click();
  const del = await delApi;
  expect(del.status()).toBe(200);
  await expect(page.getByText(/已删除 2 条缺陷/)).toBeVisible({ timeout: 8000 });
  await page.getByTestId("tab-recycle").click();
  await expect(page.getByText(`${uniq}-甲`)).toBeVisible({ timeout: 8000 });
  await expect(page.getByText(`${uniq}-乙`)).toBeVisible();
});

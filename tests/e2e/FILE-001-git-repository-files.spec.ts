import { test, expect } from "./fixtures";
import { mockGitRepoUrl } from "./s5-helpers";

// 白名单：project store（zustand persist）水合前的 /projects/null 查询 404——首帧竞态（S1 以来既有面，S5 §7.2 登记）
const hydrateRace = { pageUrlPattern: "/files", textPattern: "projects/null|Failed to load resource", reason: "store 水合前 projectId=null 的首帧查询" };

/** FILE-001 Git 存储库 e2e（连接/拉取/溯源徽标/回收站；三类断言）。 */
test.describe("FILE-001 Git 仓库文件", () => {
  test("T2 主链路：连接 mock-git→测试→拉取→溯源徽标→下载", async ({ page, authedPage, request, expectNoConsoleErrors }) => {
    const { projectId } = authedPage;
    // UI：文件管理 → 存储库弹窗 → 连接（gitea → 栈 mock，token 测试值）
    await page.goto("/files");
    await expect(page.getByTestId("file-manager")).toBeVisible();
    await page.getByTestId("btn-file-repos").click();
    await expect(page.getByTestId("file-repo-table")).toBeVisible();
    await page.getByTestId("btn-new-file-repo").click();
    await page.getByTestId("repo-platform-radio").click(); // 默认已选 gitea
    await page.getByTestId("repo-url-input").fill(mockGitRepoUrl("gitea"));
    await page.getByTestId("repo-token-input").fill("e2e-git-token");
    await page.getByRole("button", { name: "确 定" }).click();
    await expect(page.getByText("已保存")).toBeVisible({ timeout: 10_000 });

    // 连接测试（接口断言 200）
    const repos = ((await (
      await request.get(`/api/v1/projects/${projectId}/file-repos`)
    ).json()) as { data: { items: { id: string; hasToken: boolean }[] } }).data.items;
    expect(repos.length).toBe(1);
    expect(repos[0]!.hasToken).toBe(true);
    const tested = await request.post(`/api/v1/projects/${projectId}/file-repos/${repos[0]!.id}/test`, { data: {} });
    expect(tested.status()).toBe(200);

    // 拉取 data/ 目录（3 文件）
    await page.getByTestId(`repo-pull-${repos[0]!.id}`).click();
    await page.getByTestId("repo-pull-branch").fill("main");
    await page.getByTestId("repo-pull-path").fill("data/");
    await page.getByRole("button", { name: "确 定" }).last().click();
    await expect(page.getByText(/拉取完成/)).toBeVisible({ timeout: 15_000 });

    // 文件列表：Gitea 来源徽标 + 溯源列（API 断言 branch/repoPath）
    await expect(page.getByText("Gitea").first()).toBeVisible({ timeout: 10_000 });
    const firstFile = ((await (
      await request.get(`/api/v1/projects/${projectId}/files?pageSize=20`)
    ).json()) as { data: { items: { repoPath: string | null; branch: string | null }[] } }).data.items[0]!;
    expect(firstFile.repoPath).toMatch(/^data\//);
    expect(firstFile.branch).toBe("main");
    const pulled = ((await (
      await request.post(`/api/v1/projects/${projectId}/file-repos/${repos[0]!.id}/pull`, {
        data: { branch: "main", path: "data/" },
      })
    ).json()) as { data: { refreshed: number } }).data;
    expect(pulled.refreshed).toBe(3);
    await expectNoConsoleErrors([hydrateRace]);
  });

  test("T3 回收站：仓库文件删除→恢复→彻底删除", async ({ page, authedPage, request, expectNoConsoleErrors }) => {
    const { projectId } = authedPage;
    const repo = ((await (
      await request.post(`/api/v1/projects/${projectId}/file-repos`, {
        data: { platform: "gitlab", url: mockGitRepoUrl("gitlab") },
      })
    ).json()) as { data: { id: string } }).data;
    const pull = await request.post(`/api/v1/projects/${projectId}/file-repos/${repo.id}/pull`, {
      data: { branch: "main", path: "data/users_small.csv" },
    });
    expect(pull.status()).toBe(201);
    const files = ((await (
      await request.get(`/api/v1/projects/${projectId}/files?keyword=users_small`)
    ).json()) as { data: { items: { id: string; repoPlatform: string | null }[] } }).data.items;
    expect(files[0]!.repoPlatform).toBe("gitlab");

    // UI：删除 → 回收站 Tab → 恢复 → 再删 → 彻底删除
    await page.goto("/files");
    await expect(page.getByText("users_small.csv").first()).toBeVisible();
    await page.getByRole("button", { name: "删除", exact: true }).first().click();
    await page.locator(".ant-popover .ant-btn-primary, .ant-tooltip .ant-btn-primary").last().click();
    await page.getByTestId("tab-file-recycle").click();
    await expect(page.getByText("users_small.csv").first()).toBeVisible();
    await page.getByTestId(`file-restore-${files[0]!.id}`).click();
    await expect(page.getByText("已恢复")).toBeVisible();
    const restored = ((await (
      await request.get(`/api/v1/projects/${projectId}/files?keyword=users_small`)
    ).json()) as { data: { total: number } }).data;
    expect(restored.total).toBe(1);
    // 彻底删除：切回文件列表 → 行内删除（Popconfirm 确认）→ 回收站 → 彻底删除（Popconfirm 确认）
    await page.getByRole("button", { name: "文件列表" }).click();
    await expect(page.getByText("users_small.csv").first()).toBeVisible();
    await page.getByRole("button", { name: "删除", exact: true }).first().click();
    await page.locator(".ant-popover .ant-btn-primary, .ant-tooltip .ant-btn-primary").last().click();
    await expect(page.getByText("已删除", { exact: false }).first()).toBeVisible({ timeout: 5000 }).catch(() => {});
    await page.getByTestId("tab-file-recycle").click();
    await expect(page.getByText("users_small.csv").first()).toBeVisible({ timeout: 10_000 });
    await page.getByTestId(`file-purge-${files[0]!.id}`).click();
    await page.locator(".ant-popover .ant-btn-primary, .ant-tooltip .ant-btn-primary").last().click();
    const after = ((await (
      await request.get(`/api/v1/projects/${projectId}/files?recycled=true`)
    ).json()) as { data: { total: number } }).data;
    expect(after.total).toBe(0);
    await expectNoConsoleErrors([hydrateRace]);
  });

  test("T4 二态：非法 URL 422；不存在的仓库 404", async ({ page, authedPage, request }) => {
    const { projectId } = authedPage;
    const bad = await request.post(`/api/v1/projects/${projectId}/file-repos`, {
      data: { platform: "gitea", url: "https://only-host/" },
    });
    expect(bad.status()).toBe(422);
    const gone = await request.post(`/api/v1/projects/${projectId}/file-repos/00000000-0000-0000-000000000dead/test`, { data: {} });
    expect(gone.status()).toBe(404);
  });
});

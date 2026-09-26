import { defineConfig } from "@playwright/test";

/** rules/testing.md §3.3：录屏 on-with-retry + trace retain-on-failure + 失败截图 + HTML 报告。 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: [["html", { open: "never" }], ["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3100",
    // E2E_VIDEO=on 时保留全部录屏（留档/评审用）；默认 on-with-retry（仅重试用例保留）
    video: {
      mode:
        (process.env.E2E_VIDEO as "on" | "on-with-retry" | "off" | undefined) ?? "on-with-retry",
      size: { width: 1280, height: 720 },
    },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    actionTimeout: 10_000,
  },
  outputDir: "../test-results",
  globalSetup: "./global-setup.mjs",
  globalTeardown: "./global-teardown.mjs",
  webServer: {
    // 全部必需 env 内联注入：E2E_* 来自 CI job env 或 globalSetup（本地分支亦写 process.env），
    // 不依赖 .e2e.env 文件传递（首轮 CI 教训：webServer 独立进程环境不完整）
    command: [
      "bash -c '",
      'export DATABASE_URL="${E2E_DATABASE_URL:-${DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:5434/rabbit_e2e}}"',
      'REDIS_URL="${E2E_REDIS_URL:-redis://127.0.0.1:6381}"',
      "WEB_URL=http://localhost:3100",
      "SESSION_SECRET=e2e-session-secret-32chars-ok!!!!!",
      "INTERNAL_TOKEN=e2e-internal-token",
      "SESSION_COOKIE_SECURE=false",
      "PORT=3100;",
      "pnpm --filter web start'",
    ].join(" "),
    cwd: "..",
    url: "http://localhost:3100/api/v1/system/health",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      PORT: "3100",
      WEB_URL: "http://localhost:3100",
      ...process.env,
    },
  },
});

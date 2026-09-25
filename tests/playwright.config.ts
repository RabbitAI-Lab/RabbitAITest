import { defineConfig } from '@playwright/test';

/** rules/testing.md §3.3：录屏 on-with-retry + trace retain-on-failure + 失败截图 + HTML 报告。 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: [['html', { open: 'never' }], ['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3100',
    video: { mode: 'on-with-retry', size: { width: 1280, height: 720 } },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 10_000,
  },
  outputDir: '../test-results',
  globalSetup: './global-setup.mjs',
  globalTeardown: './global-teardown.mjs',
  webServer: {
    command: "bash -c 'set -a; . tests/.e2e.env; pnpm --filter web start'",
    cwd: '..',
    url: 'http://localhost:3100/api/v1/system/health',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      PORT: '3100',
      WEB_URL: 'http://localhost:3100',
      ...process.env,
    },
  },
});

import { defineConfig } from "@playwright/test";
import { rabbitEnv } from "../scripts/rabbit-env.mjs";

/** rules/testing.md §3.3：录屏 on-with-retry + trace retain-on-failure + 失败截图 + HTML 报告。 */
const E = rabbitEnv();

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  fullyParallel: false,
  // S4 并行改造：用例全隔离（自注册/自造数据/不共享态）支持文件级并行。
  // CI 并发拓扑（2026-09-29 定）：GitHub e2e job 2 分片 × 4 workers = 聚合并发 8——单 runner
  // 直上 8 workers 实测两轮过载（4 核 runner：按钮 disabled 超 10s/列表渲染滞后/ECONNRESET，
  // flaky 6→8 波动）；分片让每 runner 回到 4 并发稳定口径，总墙钟约减半。本机 4。
  workers: 4,
  retries: process.env.CI ? 2 : 0,
  reporter: [["html", { open: "never" }], ["list"]],
  use: {
    // 端口随 worktree 槽位（INFRA-005：主仓/CI slot0=3100，worktree RabbitAITest-s{N}=3100+N）
    baseURL: process.env.E2E_BASE_URL ?? E.e2e.webUrl,
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
    // 不依赖 .e2e.env 文件传递（首轮 CI 教训：webServer 独立进程环境不完整）。
    // 本地并存隔离：槽位专属 web 副本目录（/tmp/rabbit-e2e-root-s{slot}，apps/web 副本 + 根
    // node_modules/tsconfig 软链）存在时优先从副本起 web——并行会话的 next dev 不再写坏生产构建 .next；
    // CI 无副本走仓库内构建。（原共享 /tmp/rabbit-e2e-root 弃用——多 worktree 互相覆盖副本的教训）
    command: [
      "bash -c '",
      `if [ -f ${E.e2e.tmpWebRoot}/apps/web/.next/BUILD_ID ]; then `,
      `cd ${E.e2e.tmpWebRoot}/apps/web && exec env MOCK_PUBLIC_URL=${E.e2e.mockUrl} AI_ALLOW_PRIVATE_BASEURL=1 pnpm exec next start -p ${E.e2e.webPort};`,
      "else ",
      `export DATABASE_URL="\${E2E_DATABASE_URL:-\${DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:${E.e2e.pgPort}/${E.e2e.database}}}"`,
      `REDIS_URL="\${E2E_REDIS_URL:-\${REDIS_URL:-${E.e2e.redisUrl}}}"`,
      `WEB_URL=${E.e2e.webUrl}`,
      "SESSION_SECRET=e2e-session-secret-32chars-ok!!!!!",
      "INTERNAL_TOKEN=e2e-internal-token",
      "SESSION_COOKIE_SECURE=false",
      "RABBIT_USER_LIMIT=1000",
      `MOCK_PUBLIC_URL=${E.e2e.mockUrl}`,
      "AI_ALLOW_PRIVATE_BASEURL=1",
      "RABBIT_INTEGRATION_SECRET=${RABBIT_INTEGRATION_SECRET:-e2e-integration-secret-32chars-ok!!}",
      "OUTBOUND_ALLOW_PRIVATE=1",
      "E2E_PLATFORM_USER=${E2E_PLATFORM_USER:-platform-e2e-user}",
      "E2E_PLATFORM_PASS=${E2E_PLATFORM_PASS:-platform-e2e-pass}",
      `PORT=${E.e2e.webPort};`,
      "pnpm --filter web start;",
      "fi'",
    ].join(" "),
    cwd: "..",
    url: `${E.e2e.webUrl}/api/v1/system/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      DATABASE_URL:
        process.env.E2E_DATABASE_URL ??
        process.env.DATABASE_URL ??
        `postgresql://postgres:postgres@127.0.0.1:${E.e2e.pgPort}/${E.e2e.database}`,
      REDIS_URL: process.env.E2E_REDIS_URL ?? process.env.REDIS_URL ?? E.e2e.redisUrl,
      WEB_URL: E.e2e.webUrl,
      SESSION_SECRET: "e2e-session-secret-32chars-ok!!!!!",
      INTERNAL_TOKEN: "e2e-internal-token",
      SESSION_COOKIE_SECURE: "false",
      // 与 global-setup 同口径 1000：pg-e2e 常驻库累积用户曾 268>200 炸 SYS-004-01（2026-09-27）
      RABBIT_USER_LIMIT: "1000",
      // e2e mock 随槽位（global-setup 以 MOCK_PORT=4100+slot 启动），与开发栈 4000+s 隔离（INFRA-005）
      MOCK_PUBLIC_URL: E.e2e.mockUrl,
      // S7 AI-001：mock 供应商在环回——SSRF 守卫仅豁免环回（私网/元数据仍拦）
      AI_ALLOW_PRIVATE_BASEURL: "1",
      PORT: String(E.e2e.webPort),
      ...process.env,
    },
  },
});

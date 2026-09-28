/**
 * e2e 环境基址单一来源（INFRA-005）：
 * 端口随 worktree 槽位（scripts/rabbit-env.mjs），禁止在 spec 里写死 :4001/:3100——
 * 多 worktree 并行跑 e2e 时各用各的槽位端口，互不串台。
 * CI/本地均从当前目录推导同一槽位，与 global-setup / playwright.config 恒一致；
 * E2E_BASE_URL / E2E_MOCK_URL_BASE 保留为显式覆盖口（CI 特殊口径或远程目标机）。
 */
import { rabbitEnv } from "../../scripts/rabbit-env.mjs";

const E = rabbitEnv();

/** 被测 web 基址（page 走 playwright.config baseURL；API 直打/cookie 域用这里） */
export const E2E_BASE = process.env.E2E_BASE_URL ?? E.e2e.webUrl;

/** e2e 栈 mock 基址（global-setup 以 MOCK_PORT=4100+slot 启动） */
export const MOCK_BASE = process.env.E2E_MOCK_URL_BASE ?? E.e2e.mockUrl;

/** mock HTTP 端口号（环境域名默认卡/导入 jmx 等需要裸端口处用） */
export const MOCK_PORT = Number(new URL(MOCK_BASE).port) || 80;

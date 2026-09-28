#!/usr/bin/env node
/**
 * 并行 worktree 槽位环境——单一事实源（INFRA-005）。
 *
 * 多 worktree 并行联调/自测时，端口、Redis 逻辑库、/tmp 共享路径必须按槽位隔离，
 * 禁止在脚本/测试里硬编码端口（rules/git-workflow.md §9）。
 *
 * 槽位推导（优先级）：
 *   1. RABBIT_SLOT 环境变量（0-9）
 *   2. worktree 目录名 RabbitAITest-s{N} → N
 *   3. 其余（主仓 / CI checkout）→ 0
 *
 * 端口表（base + slot，slot 0-9）：
 *   用途 | web    | mock  | PG    | Redis（逻辑库号 = slot）
 *   dev  | 3000+s | 4000+s| 5440+s| 127.0.0.1:6379/{s}
 *   e2e  | 3100+s | 4100+s| 5450+s| 127.0.0.1:6381/{s}
 *   jm   | 3200+s | 4200+s| 5460+s| 127.0.0.1:6381/{s}
 *
 * 兼容性说明：
 * - slot 0 = 主仓/CI 口径；dev web 3000、e2e web 3100 与历史一致。
 * - 旧固定端口 5433/5434/5438（PG）、4001（e2e mock）、3101/4020（jm）被本表
 *   显式弃用——新值 5440+/5450+/5460+、4100+、3200+/4200+ 与旧 worktree 过渡期并存
 *   互不冲突；唯一例外 slot 1（dev mock 4001 / e2e web 3101 撞旧栈），过渡期避开 s1。
 * - Redis 为共享实例 + 逻辑库号隔离（ioredis/BullMQ 的键空间随 SELECT 完全隔离，
 *   队列与 SSE Stream 不再跨 worktree 串台）。
 *
 * CLI：
 *   node scripts/rabbit-env.mjs            # 打印 JSON
 *   node scripts/rabbit-env.mjs --shell    # 打印 export RABBIT_*=...（bash 脚本 eval 用）
 */
import path from "node:path";

export const MAX_SLOT = 9;

/**
 * 解析当前目录的槽位号。目录名匹配失败的（主仓 RabbitAITest、CI checkout）返回 0；
 * 显式 RABBIT_SLOT 优先；超出 0-9 报错（端口表按 10 槽设计，扩容须重排基址）。
 */
export function resolveSlot(cwd = process.cwd(), env = process.env) {
  const explicit = Number(env.RABBIT_SLOT);
  if (Number.isInteger(explicit)) {
    if (explicit < 0 || explicit > MAX_SLOT) {
      throw new Error(`RABBIT_SLOT=${explicit} 超出 0-${MAX_SLOT}（端口表按 10 槽设计）`);
    }
    return explicit;
  }
  const m = /RabbitAITest-s(\d+)$/.exec(path.basename(path.resolve(cwd)));
  if (m) {
    const n = Number(m[1]);
    if (n > MAX_SLOT) {
      throw new Error(
        `worktree 目录 ${path.basename(cwd)} 槽位 ${n} 超出 0-${MAX_SLOT}（端口表按 10 槽设计）`,
      );
    }
    return n;
  }
  return 0;
}

/** 按槽位计算全部环境资源标识（端口/URL/路径）。 */
export function rabbitEnv(slot = resolveSlot()) {
  if (slot < 0 || slot > MAX_SLOT) {
    throw new Error(`slot=${slot} 超出 0-${MAX_SLOT}`);
  }
  const db = String(slot);
  return {
    slot,
    dev: {
      webPort: 3000 + slot,
      webUrl: `http://localhost:${3000 + slot}`,
      mockPort: 4000 + slot,
      mockUrl: `http://127.0.0.1:${4000 + slot}`,
      pgPort: 5440 + slot,
      database: "rabbit",
      pgDataDir: ".pgdata",
      redisPort: 6379,
      redisUrl: `redis://127.0.0.1:6379/${db}`,
    },
    e2e: {
      webPort: 3100 + slot,
      webUrl: `http://localhost:${3100 + slot}`,
      mockPort: 4100 + slot,
      mockUrl: `http://127.0.0.1:${4100 + slot}`,
      pgPort: 5450 + slot,
      database: "rabbit_e2e",
      pgDataDir: ".pgdata-e2e",
      redisPort: 6381,
      redisUrl: `redis://127.0.0.1:6381/${db}`,
      // e2e web 构建副本目录（并行会话防串台；原共享 /tmp/rabbit-e2e-root 弃用）
      tmpWebRoot: `/tmp/rabbit-e2e-root-s${slot}`,
    },
    jm: {
      webPort: 3200 + slot,
      webUrl: `http://localhost:${3200 + slot}`,
      mockPort: 4200 + slot,
      mockUrl: `http://127.0.0.1:${4200 + slot}`,
      pgPort: 5460 + slot,
      database: "rabbit_jm",
      pgDataDir: ".pgdata-jm",
      redisPort: 6381,
      redisUrl: `redis://127.0.0.1:6381/${db}`,
      // JMeter 栈 pid/日志统一目录（原 /tmp/pg5438.pid、/tmp/jm-*.log 共享路径弃用）
      tmpDir: `/tmp/rabbit-s${slot}-jm`,
    },
  };
}

/** bash 脚本 eval 用：`eval "$(node scripts/rabbit-env.mjs --shell)"`。 */
function shellExports(e) {
  const lines = [
    ["RABBIT_SLOT", e.slot],
    ["RABBIT_DEV_WEB_PORT", e.dev.webPort],
    ["RABBIT_DEV_WEB_URL", e.dev.webUrl],
    ["RABBIT_DEV_MOCK_PORT", e.dev.mockPort],
    ["RABBIT_DEV_PG_PORT", e.dev.pgPort],
    [
      "RABBIT_DEV_DATABASE_URL",
      `postgresql://postgres:postgres@127.0.0.1:${e.dev.pgPort}/${e.dev.database}`,
    ],
    ["RABBIT_DEV_REDIS_URL", e.dev.redisUrl],
    ["RABBIT_DEV_REDIS_PORT", e.dev.redisPort],
    ["RABBIT_E2E_WEB_PORT", e.e2e.webPort],
    ["RABBIT_E2E_WEB_URL", e.e2e.webUrl],
    ["RABBIT_E2E_MOCK_PORT", e.e2e.mockPort],
    ["RABBIT_E2E_MOCK_URL", e.e2e.mockUrl],
    ["RABBIT_E2E_PG_PORT", e.e2e.pgPort],
    [
      "RABBIT_E2E_DATABASE_URL",
      `postgresql://postgres:postgres@127.0.0.1:${e.e2e.pgPort}/${e.e2e.database}`,
    ],
    ["RABBIT_E2E_REDIS_URL", e.e2e.redisUrl],
    ["RABBIT_E2E_REDIS_PORT", e.e2e.redisPort],
    ["RABBIT_E2E_TMP_WEB_ROOT", e.e2e.tmpWebRoot],
    ["RABBIT_JM_WEB_PORT", e.jm.webPort],
    ["RABBIT_JM_WEB_URL", e.jm.webUrl],
    ["RABBIT_JM_MOCK_PORT", e.jm.mockPort],
    ["RABBIT_JM_MOCK_URL", e.jm.mockUrl],
    ["RABBIT_JM_PG_PORT", e.jm.pgPort],
    [
      "RABBIT_JM_DATABASE_URL",
      `postgresql://postgres:postgres@127.0.0.1:${e.jm.pgPort}/${e.jm.database}`,
    ],
    ["RABBIT_JM_REDIS_URL", e.jm.redisUrl],
    ["RABBIT_JM_REDIS_PORT", e.jm.redisPort],
    ["RABBIT_JM_TMP_DIR", e.jm.tmpDir],
  ];
  return lines.map(([k, v]) => `export ${k}=${v}`).join("\n") + "\n";
}

// CLI 入口判定：仅当本模块是启动脚本（playwright.config 的 CJS 编译路径不含 import.meta，故用 argv 判定）
const isMain = typeof process.argv[1] === "string" && process.argv[1].endsWith("rabbit-env.mjs");
if (isMain) {
  const e = rabbitEnv();
  if (process.argv.includes("--shell")) {
    process.stdout.write(shellExports(e));
  } else {
    console.log(JSON.stringify(e, null, 2));
  }
}

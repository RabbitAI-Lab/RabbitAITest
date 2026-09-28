import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_SLOT, rabbitEnv, resolveSlot } from "./rabbit-env.mjs";

test("resolveSlot：RABBIT_SLOT 显式覆盖优先", () => {
  assert.equal(resolveSlot("/anywhere", { RABBIT_SLOT: "7" }), 7);
  assert.equal(resolveSlot("/Users/x/RabbitAITest-s6", { RABBIT_SLOT: "0" }), 0);
});

test("resolveSlot：worktree 目录名推导，主仓/其他目录归 0", () => {
  assert.equal(resolveSlot("/Users/x/GitHub/RabbitAITest-s8", {}), 8);
  assert.equal(resolveSlot("/Users/x/GitHub/RabbitAITest-s2", {}), 2);
  assert.equal(resolveSlot("/Users/x/GitHub/RabbitAITest", {}), 0);
  assert.equal(resolveSlot("/Users/x/GitHub/other-repo", {}), 0);
  // 目录名带尾缀/嵌套不算（只认裸 -s{N} 结尾）
  assert.equal(resolveSlot("/Users/x/GitHub/RabbitAITest-s8-backup", {}), 0);
});

test("resolveSlot：超出 0-9 报错（端口表按 10 槽设计，扩容须重排基址）", () => {
  assert.throws(() => resolveSlot("/x", { RABBIT_SLOT: "10" }), /超出 0-9/);
  assert.throws(() => resolveSlot("/Users/x/GitHub/RabbitAITest-s10", {}), /超出 0-9/);
  assert.throws(() => rabbitEnv(MAX_SLOT + 1), /超出 0-9/);
});

test("rabbitEnv：slot 0 保留历史口径（dev web 3000 / e2e web 3100）", () => {
  const e = rabbitEnv(0);
  assert.equal(e.dev.webPort, 3000);
  assert.equal(e.dev.mockPort, 4000);
  assert.equal(e.e2e.webPort, 3100);
  assert.equal(e.dev.redisUrl, "redis://127.0.0.1:6379/0");
  assert.equal(e.e2e.redisUrl, "redis://127.0.0.1:6381/0");
});

test("rabbitEnv：slot 随槽位线性偏移，Redis 逻辑库号 = slot", () => {
  const e = rabbitEnv(8);
  assert.equal(e.dev.webPort, 3008);
  assert.equal(e.dev.mockPort, 4008);
  assert.equal(e.dev.pgPort, 5448);
  assert.equal(e.e2e.webPort, 3108);
  assert.equal(e.e2e.mockPort, 4108);
  assert.equal(e.e2e.pgPort, 5458);
  assert.equal(e.jm.webPort, 3208);
  assert.equal(e.jm.mockPort, 4208);
  assert.equal(e.jm.pgPort, 5468);
  assert.equal(e.dev.redisUrl, "redis://127.0.0.1:6379/8");
  assert.equal(e.e2e.redisUrl, "redis://127.0.0.1:6381/8");
  assert.equal(e.jm.redisUrl, "redis://127.0.0.1:6381/8");
  assert.equal(e.e2e.tmpWebRoot, "/tmp/rabbit-e2e-root-s8");
  assert.equal(e.jm.tmpDir, "/tmp/rabbit-s8-jm");
});

test("端口表全量唯一：三种用途 × 10 槽无跨用途/跨槽冲突，且避开旧固定端口", () => {
  const legacy = new Set([3000, 3100, 3101, 4000, 4001, 4020, 5432, 5433, 5434, 5438]);
  const all = new Map(); // port -> "用途[s]"
  for (let s = 0; s <= MAX_SLOT; s++) {
    const e = rabbitEnv(s);
    const entries = [
      [e.dev.webPort, "dev.web"],
      [e.dev.mockPort, "dev.mock"],
      [e.dev.pgPort, "dev.pg"],
      [e.e2e.webPort, "e2e.web"],
      [e.e2e.mockPort, "e2e.mock"],
      [e.e2e.pgPort, "e2e.pg"],
      [e.jm.webPort, "jm.web"],
      [e.jm.mockPort, "jm.mock"],
      [e.jm.pgPort, "jm.pg"],
    ];
    for (const [port, label] of entries) {
      const prev = all.get(port);
      assert.equal(prev, undefined, `端口 ${port} 冲突：${prev ?? ""} 与 ${label}[${s}]`);
      all.set(port, `${label}[${s}]`);
    }
  }
  // 旧固定端口里除 slot0 的 3000/3100/4000（历史保留）外不得再被占用；
  // slot1 的 dev.mock 4001 / e2e.web 3101 属已知过渡期例外（rules/git-workflow §9 登记）
  for (const port of legacy) {
    if ([3000, 3100, 4000].includes(port)) continue;
    if (port === 4001) assert.equal(all.get(4001), "dev.mock[1]");
    else if (port === 3101) assert.equal(all.get(3101), "e2e.web[1]");
    else assert.equal(all.get(port), undefined, `旧端口 ${port} 被新表占用`);
  }
});

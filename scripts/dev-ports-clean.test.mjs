import assert from "node:assert/strict";
import { test } from "node:test";
import { rabbitEnv } from "./rabbit-env.mjs";
import { cleanSlotPorts, parseListenerPids, planCleanTargets } from "./dev-ports-clean.mjs";

test("parseListenerPids：多行去重、过滤空行与非数字，None 输出返回空数组", () => {
  assert.deepEqual(parseListenerPids("123\n456\n123\n"), [123, 456]);
  assert.deepEqual(parseListenerPids("\n  \n789\n"), [789]);
  assert.deepEqual(parseListenerPids(""), []);
  assert.deepEqual(parseListenerPids("0\n-1\nabc\n12.5\n"), []);
});

test("planCleanTargets：web/mock/runner 恒定纳入，pg 仅 includePg 时纳入，端口随槽位偏移", () => {
  const e = rabbitEnv(3);
  assert.deepEqual(
    planCleanTargets(e, false).map(([port, name]) => [name, port]),
    [
      ["web", 3003],
      ["mock", 4003],
      ["plugin-runner", 4303],
    ],
  );
  assert.deepEqual(
    planCleanTargets(e, true).map(([port, name]) => [name, port]),
    [
      ["web", 3003],
      ["mock", 4003],
      ["plugin-runner", 4303],
      ["embedded-postgres", 5443],
    ],
  );
});

test("cleanSlotPorts：无监听时不动手；有监听先 TERM，全退即无 KILL", async () => {
  const e = rabbitEnv(0);
  const calls = [];
  const lsof = (port) => (port === e.dev.webPort ? "41000\n41001\n" : "");
  const kill = (pid, signal) => {
    calls.push([pid, signal]);
    return true;
  };
  // 空端口场景：lsof 全空 → 无 kill、无结果
  const idle = await cleanSlotPorts({
    env: e,
    lsof: () => "",
    kill,
    isAlive: () => false,
    waitMs: 10,
  });
  assert.equal(calls.length, 0);
  assert.equal(idle.length, 0);
  // 占用场景：两个 PID 各收到一次 SIGTERM，且全部「已退」→ 无 SIGKILL、killed=true
  const done = await cleanSlotPorts({ env: e, lsof, kill, isAlive: () => false, waitMs: 10 });
  assert.deepEqual(calls, [
    [41000, "SIGTERM"],
    [41001, "SIGTERM"],
  ]);
  assert.equal(done.length, 1);
  assert.equal(done[0].port, e.dev.webPort);
  assert.equal(done[0].killed, true);
});

test("cleanSlotPorts：TERM 后仍存活 → KILL 兜底， survivors 杀不动则 killed=false", async () => {
  const e = rabbitEnv(2);
  const lsof = (port) => (port === e.dev.mockPort ? "42000\n" : "");
  const signals = [];
  // 一个永远杀不死的进程：任何信号后 isAlive 恒 true（模拟外部用户进程/EPERM）
  const result = await cleanSlotPorts({
    env: e,
    lsof,
    kill: (pid, signal) => signals.push(signal),
    isAlive: () => true,
    waitMs: 10,
  });
  assert.deepEqual(signals, ["SIGTERM", "SIGKILL"]);
  assert.equal(result[0].killed, false);
  assert.deepEqual(result[0].survivors, [42000]);
});

test("cleanSlotPorts：只查槽位端口表内的端口（跨槽/Redis 6379 永不触碰）", async () => {
  const e = rabbitEnv(5);
  const probed = [];
  await cleanSlotPorts({
    env: e,
    lsof: () => "",
    kill: () => true,
    isAlive: () => false,
    waitMs: 10,
  });
  // 用带探测的 lsof 再跑一遍，收集实际探测过的端口
  await cleanSlotPorts({
    env: e,
    lsof: (port) => {
      probed.push(port);
      return "";
    },
    kill: () => true,
    isAlive: () => false,
    waitMs: 10,
  });
  assert.deepEqual(probed, [3005, 4005, 4305, 5445]);
  assert.ok(!probed.includes(6379), "Redis 共享实例 6379 不得探测/清理");
});

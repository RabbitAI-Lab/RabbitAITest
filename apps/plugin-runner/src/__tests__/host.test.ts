/** PLUG-001 单测：重启退避序列 + worker 全链路（load/call/unload/内置插件）。 */
import { describe, expect, it } from "vitest";
import {
  restartBackoffMs,
  loadPlugin,
  callPlugin,
  unloadPlugin,
  status,
  registerBuiltin,
} from "../host";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

describe("重启退避序列（1s/4s/16s，3 次后 ERROR）", () => {
  it("backoff 表", () => {
    expect(restartBackoffMs(0)).toBe(1000);
    expect(restartBackoffMs(1)).toBe(4000);
    expect(restartBackoffMs(2)).toBe(16000);
    expect(restartBackoffMs(3)).toBe(16000); // 封顶
    expect(restartBackoffMs(99)).toBe(16000);
  });
});

describe("worker 全链路（真实 worker_threads）", () => {
  const handle = {
    pluginId: "test-echo",
    name: "test-echo",
    kind: "platform",
    version: "1.0.0",
    spiVersion: "1.0",
    builtin: false,
  };

  function makePluginDir(impl: string): string {
    const dir = mkdtempSync(path.join(tmpdir(), "rabbit-plugin-test-"));
    writeFileSync(path.join(dir, "index.js"), `export default function(){ return { ${impl} }; }\n`);
    return dir;
  }

  it("load → call → unload", async () => {
    const dir = makePluginDir(`echo: (m) => ({ method: m, pong: true })`);
    await loadPlugin(handle, dir, "index.js");
    try {
      const r = await callPlugin("test-echo", "echo", ["hello"]);
      expect(r).toEqual({ method: "hello", pong: true });
      // status 可见
      const found = status().plugins.find((p) => p.pluginId === "test-echo");
      expect(found?.workerStatus).toBe("RUNNING");
    } finally {
      await unloadPlugin("test-echo");
    }
    await expect(callPlugin("test-echo", "echo", [])).rejects.toThrow("插件未加载");
    rmSync(dir, { recursive: true, force: true });
  }, 15_000);

  it("入口缺工厂 → load 失败", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "rabbit-plugin-bad-"));
    writeFileSync(path.join(dir, "index.js"), "export const x = 1;\n");
    await expect(loadPlugin(handle, dir, "index.js")).rejects.toThrow("工厂");
    rmSync(dir, { recursive: true, force: true });
  }, 15_000);

  it("内置插件注册与调用（platform-echo 形态）", async () => {
    registerBuiltin({ ...handle, pluginId: "builtin-x", builtin: true }, async (method) => ({
      method,
    }));
    const r = await callPlugin("builtin-x", "testConnection", []);
    expect(r).toEqual({ method: "testConnection" });
    await unloadPlugin("builtin-x");
    await expect(callPlugin("builtin-x", "any", [])).rejects.toThrow();
  });
});

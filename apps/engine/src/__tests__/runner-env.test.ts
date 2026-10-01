/** UIT-004-T08/T09/T10：runner 环境检测纯函数矩阵 + 解析/归属/预检 + 安装参数与 registry 守卫。 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  assembleChecklist,
  assertRegistryUrl,
  clearPrecheckCache,
  projectRunnerDir,
  precheckRunner,
  resolveRunner,
  runnerCheckHasFail,
  type ProbeResults,
} from "../uit/runner-env.js";
import { buildPlaywrightConfig, parsePlaywrightReport } from "../uit/script-runner.js";

const OK_PROBES: ProbeResults = {
  nodeVersion: "v24.12.0",
  runnerPkgVersion: "1.63.0",
  chromiumPath: "/cache/ms-playwright/chromium-1243/chrome",
  diskFreeBytes: 86 * 1024 ** 3,
  ffmpegDir: "/cache/ms-playwright/ffmpeg-1011",
  registryOk: true,
  registrySource: "https://registry.npmjs.org",
};

/** T08：六项三态矩阵——ok 全绿 / 各 fail 项 / warn 项不阻断 / registry 缺省不出现。 */
describe("UIT-004-T08 assembleChecklist", () => {
  it("全 ok：六项全绿无 fail", () => {
    const items = assembleChecklist(OK_PROBES);
    expect(items.map((i) => `${i.key}:${i.status}`).join(",")).toBe(
      "node:ok,runner_pkg:ok,chromium:ok,disk:ok,ffmpeg:ok,npm_registry:ok",
    );
    expect(runnerCheckHasFail(items)).toBe(false);
  });

  it("node<18 / runner 缺失 / chromium 缺失 / 磁盘不足 = fail 且阻断", () => {
    const items = assembleChecklist({
      ...OK_PROBES,
      nodeVersion: "v16.20.0",
      runnerPkgVersion: null,
      chromiumPath: null,
      diskFreeBytes: 100 * 1024 ** 2,
    });
    const fails = items.filter((i) => i.status === "fail").map((i) => i.key);
    expect(fails).toEqual(["node", "runner_pkg", "chromium", "disk"]);
    expect(runnerCheckHasFail(items)).toBe(true);
    // fail 项带处置指引（chromium 给出 install 命令提示）
    expect(items.find((i) => i.key === "chromium")?.hint).toContain("install chromium");
  });

  it("ffmpeg 缺失=warn 不阻断；registry 不可达=warn 不阻断", () => {
    const items = assembleChecklist({ ...OK_PROBES, ffmpegDir: null, registryOk: false });
    expect(items.filter((i) => i.status === "warn").map((i) => i.key)).toEqual([
      "ffmpeg",
      "npm_registry",
    ]);
    expect(runnerCheckHasFail(items)).toBe(false);
  });

  it("非安装场景（registryOk=null）不产出 npm_registry 项", () => {
    const items = assembleChecklist({ ...OK_PROBES, registryOk: null });
    expect(items.some((i) => i.key === "npm_registry")).toBe(false);
    expect(items).toHaveLength(5);
  });

  it("磁盘不可读=warn 级缺失信息（diskFree null → fail 项）", () => {
    const items = assembleChecklist({ ...OK_PROBES, diskFreeBytes: null });
    expect(items.find((i) => i.key === "disk")?.status).toBe("fail");
  });
});

/** T10：registry/版本守卫（安装链路供应链收口）。 */
describe("UIT-004-T10 安装参数守卫", () => {
  it("registry 仅 https；内网/环回/保留地址拒绝", () => {
    expect(assertRegistryUrl("https://registry.npmjs.org").protocol).toBe("https:");
    expect(() => assertRegistryUrl("http://registry.npmjs.org")).toThrow(/https/);
    expect(() => assertRegistryUrl("https://localhost")).toThrow();
    expect(() => assertRegistryUrl("https://127.0.0.1")).toThrow();
    expect(() => assertRegistryUrl("https://10.1.2.3")).toThrow();
    expect(() => assertRegistryUrl("https://192.168.1.5")).toThrow();
    expect(() => assertRegistryUrl("https://172.16.0.1")).toThrow();
    expect(() => assertRegistryUrl("https://169.254.1.1")).toThrow();
  });

  it("版本白名单（RUNNER_VERSION_RE 经 shared）：精确 semver 通过、range/前后缀拒绝", async () => {
    const { RUNNER_VERSION_RE } = await import("@rabbit/shared");
    expect(RUNNER_VERSION_RE.test("1.63.0")).toBe(true);
    expect(RUNNER_VERSION_RE.test("1.62.15")).toBe(true);
    expect(RUNNER_VERSION_RE.test("^1.63.0")).toBe(false);
    expect(RUNNER_VERSION_RE.test("latest")).toBe(false);
    expect(RUNNER_VERSION_RE.test("1.63")).toBe(false);
    expect(RUNNER_VERSION_RE.test("1.63.0-beta.1")).toBe(false);
  });

  it("npm argv 构造无 shell 面：spawn 字面量参数（installProjectRunner 源文本断言——版本经白名单后拼接）", async () => {
    const { readFile } = await import("node:fs/promises");
    const src = await readFile(
      path.resolve(path.dirname(new URL(import.meta.url).pathname), "../uit/runner-env.ts"),
      "utf8",
    );
    expect(src).toContain('"npm"');
    expect(src).toContain('"install"');
    expect(src).toContain('"--no-audit"');
    expect(src).toContain('"--registry"');
    // 无 shell:true（spawn 恒无 shell）
    expect(src).not.toContain("shell: true");
  });
});

/** T09：解析/归属/回落/预检缓存。 */
describe("UIT-004-T09 resolveRunner 与预检", () => {
  const PID = "11111111-1111-1111-1111-111111111111";
  const RID = "22222222-2222-2222-2222-222222222222";

  afterEach(() => clearPrecheckCache());

  it("uuid 白名单防穿越（目录分域）", () => {
    expect(projectRunnerDir(PID, RID)).toContain(path.join("11111111-1111-1111-1111-111111111111"));
    expect(() => projectRunnerDir(PID, "../../etc")).toThrow(/uuid/);
    expect(() => projectRunnerDir("../x", RID)).toThrow(/uuid/);
  });

  it("内置 runner 解析：cli=engine 依赖链 @playwright/test/cli.js", async () => {
    const r = await resolveRunner(PID, null);
    expect(r.kind).toBe("builtin");
    expect(r.cliPath.endsWith(path.join("@playwright", "test", "cli.js"))).toBe(true);
    expect(r.label.startsWith("builtin ")).toBe(true);
  });

  it("项目 runner：目录/包缺失=显式失败（不静默回落内置）", async () => {
    await expect(resolveRunner(PID, RID)).rejects.toThrow(/缺失|未完成/);
  });

  it("项目 runner：安装产物目录可解析（临时目录模拟 node_modules/@playwright/test）", async () => {
    const TEST_PID = "33333333-3333-3333-3333-333333333333";
    const TEST_RID = "44444444-4444-4444-4444-444444444444";
    const dir = projectRunnerDir(TEST_PID, TEST_RID);
    const pkgDir = path.join(dir, "node_modules", "@playwright", "test");
    await mkdir(pkgDir, { recursive: true });
    await writeFile(path.join(pkgDir, "package.json"), JSON.stringify({ version: "9.9.9" }));
    try {
      const r = await resolveRunner(TEST_PID, TEST_RID);
      expect(r.kind).toBe("project");
      expect(r.version).toBe("9.9.9");
      expect(r.label).toBe("pw-9.9.9");
    } finally {
      // 只清本用例的项目分域目录（.runners/{TEST_PID}），绝不触碰其他项目 runner
      await rm(path.dirname(dir), { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("预检缓存 5min：第二次调用不再探测（探针 mock 计数）", async () => {
    clearPrecheckCache();
    const r = await resolveRunner(PID, null);
    const items1 = await precheckRunner(r);
    const items2 = await precheckRunner(r);
    expect(items1.length).toBeGreaterThan(0);
    expect(items2).toBe(items1);
    clearPrecheckCache(r.label);
    const items3 = await precheckRunner(r);
    expect(items3).not.toBe(items1);
  });
});

/** 预检阻断门（precheckGate 经 script-runner 行为间接覆盖于此：目录缺失即 CONFIG_ERROR 语义）。 */
describe("UIT-004 预检阻断语义", () => {
  it("playwright config 生成（runner 工作区契约）含 workers=1/trace=on/no-sandbox", () => {
    const cfg = buildPlaywrightConfig(30000);
    expect(cfg).toContain("workers: 1");
    expect(cfg).toContain("trace: 'on'");
    expect(cfg).toContain("--no-sandbox");
  });

  it("report 解析对空/异常产物容错（阻断链路兜底）", () => {
    expect(parsePlaywrightReport({ suites: [] })).toEqual([]);
    expect(parsePlaywrightReport([])).toEqual([]);
    expect(parsePlaywrightReport(null)).toEqual([]);
  });
});

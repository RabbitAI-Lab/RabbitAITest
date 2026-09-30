import { test, expect, navFromHome } from "./fixtures";
import { uploadPlugin, enablePlugin, newAdminContext } from "./s6-helpers";
import { E2E_REDIS, E2E_BASE } from "./env";
import * as grpcPkg from "@grpc/grpc-js";
const grpc = grpcPkg;
import { loadSync as loadProtoSync } from "@grpc/proto-loader";
import { writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

/**
 * PLUG-005 e2e（规格 §5 T9）：上传启用协议插件 → 调试页协议下拉（数据驱动零改动验证）
 * → redis 对 e2e 栈真实 redis PING → 报告回显 PONG；
 * → grpc 对测试内嵌 gRPC echo server 引擎全链路执行（演示暴露的 bundle interop 缺陷回归——
 *   单测跑插件源码不覆盖 esbuild bundle 形态，protoLoader default interop 曾在引擎侧翻车，勘误 7）。
 * 三类断言：UI（下拉项/执行结果）+ Console（无 error）+ 接口（执行负载含 protocol）。
 * mongodb/amqp 真连：mongodb 豁免（CI 无 mongod）、amqp 由单测契约与规格 §5 登记（CI rabbitmq service 决策）。
 */

/** 测试内嵌 gRPC echo server（grpc-js 同进程真服务，unary Say → got:<text>） */
async function startGrpcEcho(): Promise<{ port: number; close: () => void }> {
  const PROTO = `syntax = "proto3";\npackage e2e;\nservice Echo { rpc Say (Req) returns (Res) {} }\nmessage Req { string text = 1; }\nmessage Res { string text = 1; }`;
  const protoPath = join(tmpdir(), `p5-e2e-${randomUUID()}.proto`);
  writeFileSync(protoPath, PROTO);
  const pkgDef = loadProtoSync(protoPath, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  });
  rmSync(protoPath, { force: true });
  const pkg = grpc.loadPackageDefinition(pkgDef).e2e as unknown as {
    Echo: { service: grpc.ServiceDefinition };
  };
  const server = new grpc.Server();
  server.addService(pkg.Echo.service, {
    Say: (call: grpc.ServerUnaryCall<{ text: string }, { text: string }>, cb: grpc.sendUnaryData<{ text: string }>) =>
      cb(null, { text: `got:${call.request.text}` }),
  } as never);
  const port = await new Promise<number>((res) => {
    server.bindAsync("127.0.0.1:0", grpc.ServerCredentials.createInsecure(), (_e, p) => res(p));
  });
  server.start();
  return { port, close: () => server.forceShutdown() };
}

/** 引擎协议注册表 30s 轮询——启用后执行若 40510 需退避重试（PLUG-003 勘误 2 同型） */
async function executeRedisPingUntilReady(
  page: import("@playwright/test").Page,
  expectApi: (glob: string) => Promise<{ status: number; code: number; body: unknown }>,
  redisUrl: string,
): Promise<void> {
  const u = new URL(redisUrl);
  const cfg = {
    host: u.hostname,
    port: Number(u.port) || 6379,
    ...(u.password ? { password: decodeURIComponent(u.password) } : {}),
    ...(u.pathname && u.pathname !== "/" ? { db: Number(u.pathname.slice(1)) } : {}),
    command: "PING",
    timeoutMs: 5000,
  };
  for (let attempt = 0; attempt < 5; attempt++) {
    if (attempt > 0) await page.waitForTimeout(10_000);
    await navFromHome(page, "接口调试");
    await page.getByTestId("debug-protocol").click();
    await page
      .locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden)")
      .getByText("redis", { exact: true })
      .click();
    await page.getByTestId("req-tab-protocol").click();
    await page
      .getByTestId("req-protocol-config")
      .fill(JSON.stringify(cfg, null, 2));
    const execApi = expectApi("**/api/v1/projects/*/exec-tasks");
    const reqPromise = page
      .waitForResponse("**/api/v1/projects/*/exec-tasks")
      .then((res) => res.request().postData() ?? "");
    await page.getByTestId("btn-execute").click();
    const exec = await execApi;
    expect(exec.status).toBe(201);
    // 接口断言：执行请求负载含 protocol=redis
    expect(await reqPromise).toContain('"redis"');
    await page.waitForURL(/\/reports\//, { timeout: 15_000 });
    const status = await page
      .getByTestId("report-status")
      .textContent({ timeout: 30_000 })
      .catch(() => null);
    if (status === "SUCCESS") return;
  }
  throw new Error("redis 协议执行在引擎注册表两个轮询周期内未成功（40510 未就绪）");
}

test("PLUG-005-T9 上传启用五协议插件 → 下拉五项 → redis PING 对栈 redis 执行成功", async ({
  page,
  context,
  request,
  playwright,
  expectNoConsoleErrors,
  expectApi,
}) => {
  // 前置：管理员独立 context 上传并启用 ssh/redis/grpc（幂等；引擎注册表 30s 轮询退避）
  const admin = await newAdminContext(playwright);
  for (const tgz of ["ssh-1.0.0.tgz", "redis-1.0.0.tgz", "grpc-1.0.0.tgz"]) {
    const id = await uploadPlugin(admin, tgz);
    for (let attempt = 0; ; attempt++) {
      try {
        await enablePlugin(admin, id);
        break;
      } catch (e) {
        if (attempt >= 3) throw e;
        await page.waitForTimeout(5000);
      }
    }
  }
  await admin.dispose();

  // 注册普通用户（浏览器上下文切换为用户会话）
  const email = `e2e-plug005-${Date.now()}@rabbit.test`;
  const reg = await request.post("/api/v1/auth/register", {
    data: { email, password: process.env.E2E_USER_PASSWORD ?? "rabbit-pass-123" },
  });
  expect(reg.status()).toBe(201);
  const ras = (reg.headers()["set-cookie"] ?? "").split("ras=")[1]?.split(";")[0];
  await context.clearCookies();
  if (ras) await context.addCookies([{ name: "ras", value: ras, url: E2E_BASE }]);

  // UI 断言：协议下拉出现 ssh/redis/grpc（数据驱动零改动；mongodb/amqp 未启用不出现）
  await navFromHome(page, "接口调试");
  await page.getByTestId("debug-protocol").click();
  const dropdown = page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden)");
  for (const label of ["ssh", "redis", "grpc"]) {
    await expect(dropdown.getByText(label, { exact: true })).toBeVisible();
  }
  await page.keyboard.press("Escape");

  // redis PING 真执行（e2e 栈真实 redis）
  await executeRedisPingUntilReady(page, expectApi, E2E_REDIS);

  // UI 断言：报告响应回显 PONG
  await expect(page.getByText("PONG")).toBeVisible({ timeout: 15_000 });

  await expectNoConsoleErrors();
});

test("PLUG-005-T10 grpc 引擎全链路：对内嵌 echo server unary 执行（bundle interop 回归）", async ({
  page,
  context,
  request,
  playwright,
  expectNoConsoleErrors,
  expectApi,
}) => {
  // 内嵌真服务（本进程 grpc-js server，engine 同机可达）
  const echo = await startGrpcEcho();

  // 管理员上传+启用 grpc（幂等退避）
  const admin = await newAdminContext(playwright);
  const id = await uploadPlugin(admin, "grpc-1.0.0.tgz");
  for (let attempt = 0; ; attempt++) {
    try {
      await enablePlugin(admin, id);
      break;
    } catch (e) {
      if (attempt >= 3) throw e;
      await page.waitForTimeout(5000);
    }
  }
  await admin.dispose();

  const email = `e2e-plug005-grpc-${Date.now()}@rabbit.test`;
  const reg = await request.post("/api/v1/auth/register", {
    data: { email, password: process.env.E2E_USER_PASSWORD ?? "rabbit-pass-123" },
  });
  expect(reg.status()).toBe(201);
  const ras = (reg.headers()["set-cookie"] ?? "").split("ras=")[1]?.split(";")[0];
  await context.clearCookies();
  if (ras) await context.addCookies([{ name: "ras", value: ras, url: E2E_BASE }]);

  try {
    // 引擎注册表轮询窗口退避（PLUG-003 勘误 2 同型）
    let ok = false;
    for (let attempt = 0; attempt < 5 && !ok; attempt++) {
      if (attempt > 0) await page.waitForTimeout(10_000);
      await navFromHome(page, "接口调试");
      await page.getByTestId("debug-protocol").click();
      await page
        .locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden)")
        .getByText("grpc", { exact: true })
        .click();
      await page.getByTestId("req-tab-protocol").click();
      await page.getByTestId("req-protocol-config").fill(
        JSON.stringify(
          {
            host: "127.0.0.1",
            port: echo.port,
            protoContent: 'syntax = "proto3";\npackage e2e;\nservice Echo { rpc Say (Req) returns (Res) {} }\nmessage Req { string text = 1; }\nmessage Res { string text = 1; }',
            service: "Echo",
            method: "Say",
            requestMessage: { text: "e2e-grpc" },
            timeoutMs: 5000,
          },
          null,
          2,
        ),
      );
      const execApi = expectApi("**/api/v1/projects/*/exec-tasks");
      const reqPromise = page
        .waitForResponse("**/api/v1/projects/*/exec-tasks")
        .then((res) => res.request().postData() ?? "");
      await page.getByTestId("btn-execute").click();
      const exec = await execApi;
      expect(exec.status).toBe(201);
      // 接口断言：执行负载含 protocol=grpc（bundle 形态经引擎装载路径）
      expect(await reqPromise).toContain('"grpc"');
      await page.waitForURL(/\/reports\//, { timeout: 15_000 });
      // 终态轮询（最长 30s）
      for (let i = 0; i < 15; i++) {
        const status = await page
          .getByTestId("report-status")
          .textContent({ timeout: 5000 })
          .catch(() => null);
        if (status === "SUCCESS") {
          ok = true;
          break;
        }
        if (status === "FAILED" || status === "STOPPED") break;
        await page.waitForTimeout(2000);
      }
    }
    expect(ok, "grpc bundle 引擎执行应 SUCCESS（interop 回归）").toBe(true);
    // UI 断言：响应体回显 got:e2e-grpc
    const body = page.getByTestId("report-response-body");
    await body.waitFor({ state: "visible", timeout: 15_000 });
    await expect(body).toContainText("got:e2e-grpc");

    await expectNoConsoleErrors();
  } finally {
    echo.close();
  }
});

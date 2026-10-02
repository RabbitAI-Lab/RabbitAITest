/**
 * PLUG-005（SSH/Redis/MongoDB/gRPC/AMQP 协议插件）验收演示录屏——独立录制脚本，非测试用例。
 * 真实链路：全部五家对**真实目标**执行——redis→docker 容器(6381)、grpc→真实 grpc-js echo server(50051)、
 * amqp→docker RabbitMQ(5672)、mongodb→docker mongod(27017，预置 3 条文档)、ssh→ssh2 起的完整 SSH 协议服务(2222)。
 * 步骤左上角浮层标注；1280×720 webm。
 * 产物：docs/sprint-future-p4/demo/plug005-acceptance-demo.webm（栈脚本录完重命名固定名）
 * 前置：bash /tmp/demo-stack-plug005.sh（web :3103 + engine + PG :5440 + 五个演示目标）
 * 用法：node tests/demo/plug005-demo-record.mjs
 */
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";

const BASE = process.env.DEMO_BASE_URL ?? "http://localhost:3103";
const OUT = path.resolve(import.meta.dirname ?? ".", "../../docs/sprint-future-p4/demo");
const TARBALL_DIR = path.resolve(import.meta.dirname ?? ".", "../../plugins/dist");
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function step(page, title, ms = 2400) {
  await page.evaluate((t) => {
    const old = document.getElementById("__demo_step");
    if (old) old.remove();
    const d = document.createElement("div");
    d.id = "__demo_step";
    d.textContent = t;
    d.style.cssText =
      "position:fixed;top:14px;left:14px;z-index:99999;background:rgba(30,30,40,.88);color:#fff;padding:8px 14px;border-radius:8px;font:600 15px/1.4 system-ui;box-shadow:0 4px 14px rgba(0,0,0,.3);pointer-events:none;max-width:70%";
    document.body.appendChild(d);
    setTimeout(() => d.remove(), 2800);
  }, title);
  await sleep(ms);
}

const GRPC_PROTO = `syntax = "proto3";
package plug005;
service Echo { rpc Say (Req) returns (Res) {} }
message Req { string text = 1; }
message Res { string text = 1; }`;

/** 单协议执行段：选协议→填配置→执行→报告终态轮询+SUCCESS+响应体 */
async function execProtocol(page, label, protocol, config, expectText, overlayTail) {
  await page.goto(`${BASE}/debug`);
  await page.getByTestId("debug-protocol").waitFor({ state: "visible", timeout: 10000 });
  await step(page, label, 2000);
  await page.getByTestId("debug-protocol").click();
  await page
    .locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden)")
    .getByText(protocol, { exact: true })
    .click();
  await sleep(600);
  await page.getByTestId("req-tab-protocol").click();
  await page.getByTestId("req-protocol-config").fill(JSON.stringify(config, null, 2));
  await sleep(500);
  await page.getByTestId("btn-execute").click();
  await page.waitForURL(/\/reports\//, { timeout: 20000 });
  // 终态轮询（PENDING/RUNNING → 每 2s 复查，最长 90s；引擎轮询窗口容错）
  let status = null;
  for (let i = 0; i < 45; i++) {
    status = await page
      .getByTestId("report-status")
      .textContent({ timeout: 10_000 })
      .catch(() => null);
    if (status === "SUCCESS" || status === "FAILED" || status === "STOPPED") break;
    await sleep(2000);
  }
  if (status !== "SUCCESS") {
    throw new Error(`${protocol} 执行终态=${status}（期望 SUCCESS）——演示要求真实通过，不掩饰失败`);
  }
  const body = page.getByTestId("report-response-body");
  await body.waitFor({ state: "visible", timeout: 15_000 }).catch(() => {});
  const bodyText = (await body.textContent().catch(() => "")) ?? "";
  await step(page, overlayTail.replace("__BODY__", bodyText.slice(0, 60)), 3600);
  if (!bodyText.includes(expectText)) {
    throw new Error(
      `${protocol} 响应体不含期望「${expectText}」（实际 ${bodyText.slice(0, 120)}）`,
    );
  }
}

const run = async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    recordVideo: { dir: OUT, size: { width: 1280, height: 720 } },
  });
  const page = await ctx.newPage();

  // ── 0 管理员登录 ──
  await page.goto(`${BASE}/login`);
  await step(
    page,
    "PLUG-005 验收演示 · SSH / Redis / MongoDB / gRPC / AMQP 协议插件（全部真实目标）",
    2600,
  );
  await page.getByTestId("login-email").fill("admin@rabbit.test");
  await page
    .getByTestId("login-password")
    .fill(process.env.DEMO_ADMIN_PASSWORD ?? "rabbit-admin-123");
  await page.getByTestId("login-submit").click();
  await page.waitForURL(`${BASE}/`, { timeout: 15000 });
  await sleep(1000);

  // ── ① 插件管理：上传五家 tarball ──
  const FIVE = ["ssh", "redis", "mongodb", "grpc", "amqp"];
  await page.goto(`${BASE}/system/plugins`);
  await sleep(1200);
  await step(
    page,
    "① 系统设置 → 插件管理：上传五家协议插件 tarball（清单+SPI 校验→MinIO→Plugin 登记）",
    2200,
  );
  for (const name of FIVE) {
    await page.getByTestId("plugin-upload-btn").click();
    await page
      .locator(".ant-modal input[type=file]")
      .setInputFiles(`${TARBALL_DIR}/${name}-1.0.0.tgz`);
    await page.getByText(`${name}-1.0.0.tgz`).waitFor({ state: "visible", timeout: 8000 });
    await sleep(400);
    await page.getByRole("button", { name: "确认上传" }).click();
    await sleep(1800);
    await step(page, `已上传 ${name}（kind=协议 · 驱动内联 CJS tarball）`, 1200);
  }

  // ── ② 启用五家（runner 热加载）──
  await step(
    page,
    "② 逐个启用：plugin-runner worker_threads 隔离热加载（每插件独立 worker）",
    2000,
  );
  for (const name of FIVE) {
    const sw = page.getByTestId(`plugin-toggle-${name}`);
    await sw.waitFor({ state: "visible", timeout: 15000 });
    if ((await sw.getAttribute("aria-checked")) !== "true") {
      await sw.click();
      await sleep(1200);
    }
    await page
      .getByRole("row")
      .filter({ hasText: name })
      .first()
      .getByText("运行中")
      .waitFor({ state: "visible", timeout: 15_000 });
  }
  await step(page, "五家全部「运行中」——引擎协议注册表 30s 轮询装载…", 33_000);

  // ── ③ redis：对 docker 容器真实 redis PING ──
  await execProtocol(
    page,
    "③ Redis：连接 docker 容器真实 redis（:6381）执行 PING",
    "redis",
    { host: "127.0.0.1", port: 6381, command: "PING", timeoutMs: 5000 },
    "PONG",
    "报告 SUCCESS · 响应 __BODY__（ioredis 真实往返）",
  );

  // ── ④ grpc：对真实 grpc-js echo server unary 调用 ──
  await execProtocol(
    page,
    "④ gRPC：对真实 grpc-js echo server（:50051）unary 调用 Echo.Say",
    "grpc",
    {
      host: "127.0.0.1",
      port: 50051,
      protoContent: GRPC_PROTO,
      service: "Echo",
      method: "Say",
      requestMessage: { text: "hello-plug005" },
      timeoutMs: 5000,
    },
    "got:hello-plug005",
    "报告 SUCCESS · 响应 __BODY__（proto 动态加载→uninary 往返）",
  );

  // ── ⑤ amqp：对 docker RabbitMQ 自发自收往返 ──
  await execProtocol(
    page,
    "⑤ AMQP：对 docker RabbitMQ（:5672）临时队列 publish→consume 自发自收",
    "amqp",
    {
      url: "amqp://rabbitmq:rabbitmq@127.0.0.1:5672",
      message: "hello-plug005-amqp",
      timeoutMs: 5000,
    },
    "hello-plug005-amqp",
    "报告 SUCCESS · 收到自发自收消息 __BODY__（真实 broker 路由+消费）",
  );

  // ── ⑥ mongodb：对 docker mongod 只读 count（预置 3 条）──
  await execProtocol(
    page,
    "⑥ MongoDB：对 docker mongod（:27017）count 查询（预置 plug005.items 3 条文档）",
    "mongodb",
    {
      uri: "mongodb://127.0.0.1:27017/plug005",
      operation: "count",
      collection: "items",
      timeoutMs: 5000,
    },
    "count=3",
    "报告 SUCCESS · __BODY__（只读三操作之一，$where 拒绝）",
  );

  // ── ⑦ ssh：对 ssh2 起的完整 SSH 协议服务 exec ──
  await execProtocol(
    page,
    "⑦ SSH：对完整 SSH 协议服务（:2222，密码认证）exec 单命令",
    "ssh",
    {
      host: "127.0.0.1",
      port: 2222,
      username: "demo",
      authType: "password",
      password: "rabbit-demo",
      command: "uptime",
      timeoutMs: 5000,
    },
    "demo-host:uptime",
    "报告 SUCCESS · 远端回显 __BODY__（加密信道 exec→stdout→exit-status）",
  );

  await step(
    page,
    "PLUG-005 验收演示结束 —— 五家协议插件全部对真实目标执行 SUCCESS（MeterSphere 企业版六协议对标清偿）",
    4000,
  );

  await ctx.close();
  await browser.close();
  console.log(`[demo] video saved under ${OUT}/ （栈脚本重命名为 plug005-acceptance-demo.webm）`);
  console.log("[demo] ALL 5 PROTOCOLS PASSED");
};

run().catch((e) => {
  console.error("[demo] FAILED:", e.message);
  process.exit(1);
});

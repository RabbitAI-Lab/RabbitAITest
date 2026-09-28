import { test } from "./fixtures";
import {
  addLicense,
  removeLicense,
  loginSeedAdmin,
  MOCK_URL,
  sweepSsoSources,
  sweepPools,
} from "./s9-helpers";
import { createScenario, saveSteps, scriptStep } from "./s3-helpers";

const E2E_PASSWORD = process.env.E2E_USER_PASSWORD ?? "rabbit-pass-123";

test("debug dingtalk final state", async ({ page, context, request }) => {
  await loginSeedAdmin(request, context);
  await addLicense(request);
  await sweepSsoSources(request);
  const created = await request.post("/api/v1/system/sso", {
    data: {
      type: "DINGTALK",
      name: "dbg-ding",
      enabled: true,
      config: { clientId: "c", agentId: "a", clientSecret: "s" },
    },
  });
  const authId = ((await created.json()) as { data: { id: string } }).data.id;
  await request.patch(`/api/v1/system/sso/${authId}`, {
    data: {
      type: "DINGTALK",
      name: "dbg-ding",
      enabled: true,
      config: {
        clientId: "c",
        agentId: "a",
        clientSecret: "******",
        apiBase: `${MOCK_URL}/sso/dingtalk/${authId}`,
        authorizeBase: `${MOCK_URL}/sso`,
      },
    },
  });
  await request.post(`${MOCK_URL}/sso/_test/config`, {
    data: { authId, userinfo: { openId: `dbg-open-${Date.now()}`, nick: "扫码" } },
  });
  page.on("response", (r) => {
    if (r.url().includes("/auth/sso/") || r.url().includes(":4001/sso/"))
      console.log("RESP", r.status(), r.url().slice(0, 160));
  });
  await context.clearCookies();
  await page.goto("/login");
  await page.getByTestId("sso-method-DINGTALK").click();
  await page.waitForTimeout(5000);
  console.log("FINAL:", page.url());
  console.log("BODY:", (await page.content()).replace(/\s+/g, " ").slice(0, 300));
  await request.delete(`/api/v1/system/sso/${authId}`).catch(() => undefined);
  await removeLicense(request);
});

test("debug engine2 full stderr", async ({ page, context, browser, request }) => {
  void page;
  void context;
  await loginSeedAdmin(request, context);
  await addLicense(request);
  await sweepPools(request);
  const created = await request.post("/api/v1/system/pools", {
    data: {
      name: `dbgPool${Date.now().toString(36)}`,
      type: "NODE",
      maxConcurrency: 4,
      orgScope: "ALL",
    },
  });
  const poolId = ((await created.json()) as { data: { id: string } }).data.id;

  const userCtx = await browser.newContext();
  const userReq = userCtx.request;
  const reg = await userReq.post("/api/v1/auth/register", {
    data: { email: `dbg-pool2-${Date.now()}@rabbit.test`, password: E2E_PASSWORD },
  });
  const projectId = ((await reg.json()) as { data: { projectId: string } }).data.projectId;
  const scenario = await createScenario(userReq, projectId, { name: "dbg场景" });
  await saveSteps(userReq, projectId, scenario.id, [scriptStep("自检", "1 + 1")]);

  const { spawn } = await import("node:child_process");
  const engine2 = spawn("pnpm", ["--filter", "engine", "start"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      POOL_ID: poolId,
      REDIS_URL: "redis://127.0.0.1:6381",
      WEB_URL: "http://localhost:3100",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  engine2.stdout?.on("data", (d: Buffer) =>
    console.log("E2-OUT", d.toString().trim().slice(0, 300)),
  );
  engine2.stderr?.on("data", (d: Buffer) =>
    console.log("E2-ERR", d.toString().trim().slice(0, 500)),
  );
  try {
    await page.waitForTimeout(15_000);
    const after = await request.get(`/api/v1/system/pools/${poolId}`);
    console.log("POOL", JSON.stringify(await after.json()).slice(0, 300));
    const exec = await userReq.post(`/api/v1/projects/${projectId}/scenarios/execute`, {
      data: { scenarioIds: [scenario.id], poolId, stopOnFail: true, mode: "serial" },
    });
    console.log("EXEC", exec.status());
    const taskId = ((await exec.json()) as { data?: { taskId?: string } }).data?.taskId;
    for (let i = 0; i < 20 && taskId; i++) {
      const rep = (
        (await (await userReq.get(`/api/v1/projects/${projectId}/reports/${taskId}`)).json()) as {
          data?: { status: string };
        }
      ).data;
      console.log("STATUS", rep?.status);
      if (rep && ["SUCCESS", "FAILED", "STOPPED"].includes(rep.status)) break;
      await page.waitForTimeout(1000);
    }
  } finally {
    engine2.kill("SIGTERM");
    await userCtx.close().catch(() => undefined);
  }
  await removeLicense(request);
});

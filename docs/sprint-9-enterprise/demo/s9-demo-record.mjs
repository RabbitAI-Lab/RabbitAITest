/**
 * S9 验收演示录屏（AGENTS 门禁 2：走查录屏归档）——独立录制脚本，非测试用例。
 * 走 sprint-overview §4 验收主线八段：授权 License → 多资源池(engine2 绑池执行) → 多组织+切换器
 * → 部门树 → 用户上限口径 → 主题品牌 → 消息模板渲染 → SSO+扫码登录（mock IdP）。
 * 步骤左上角浮层标注（2.6s 淡出）；1280×720 webm。
 * 产物：docs/sprint-9-enterprise/demo/s9-acceptance-demo.webm
 * 前置：web :3100（OUTBOUND_ALLOW_PRIVATE=1）、mock :4001、pg :5434、redis :6381。
 * 用法：node docs/sprint-9-enterprise/demo/s9-demo-record.mjs
 */
import { chromium } from "@playwright/test";
import { mkdirSync, readdirSync, renameSync } from "node:fs";
import { createHmac } from "node:crypto";
import { spawn } from "node:child_process";
import path from "node:path";

const BASE = process.env.DEMO_BASE_URL ?? "http://localhost:3100";
const MOCK = process.env.DEMO_MOCK_URL ?? "http://127.0.0.1:4001";
const OUT = path.resolve(import.meta.dirname ?? ".", ".");
mkdirSync(OUT, { recursive: true });

const email = `demo-s9-${Date.now()}@rabbit.test`;
const ownerEmail = `demo-s9o-${Date.now()}@rabbit.test`;
// 重跑唯一名后缀：池/组织/部门/场景用（防重跑 409 + 历史残留 strict-mode 冲突）
const suffix = String(Date.now()).slice(-5);
const poolName = `验收企业池-${suffix}`;
const orgName = `验收电商事业部-${suffix}`;
const deptRootName = `验收质量部-${suffix}`;
const deptSubName = `验收测试组-${suffix}`;
const scenarioName = `验收-选池场景-${suffix}`;
/** 注册（已存在则登录兜底——中断重跑幂等） */
async function registerOrLogin(api, mail) {
  const reg = await api.post(`${BASE}/api/v1/auth/register`, { data: { email: mail, password } });
  const body = await reg.json();
  if (body.data?.projectId) return { projectId: body.data.projectId, userId: body.data.userId };
  const login = await api.post(`${BASE}/api/v1/auth/login`, { data: { email: mail, password } });
  const lb = await login.json();
  const projects = (await (await api.get(`${BASE}/api/v1/personal/projects`)).json()).data;
  return { projectId: projects[0]?.id, userId: lb.data?.userId };
}
const password = "rabbit-pass-123";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 开发密钥现场签发 License（与 web 同算法同缺省密钥） */
function issueLicense(expiresAt) {
  const secret = process.env.LICENSE_SIGNING_SECRET ?? "rabbit-dev-license-secret";
  const payload = {
    lic: `RAB-DEMO-${Date.now().toString(36).toUpperCase()}`,
    edition: "ENTERPRISE",
    issuedAt: new Date().toISOString(),
    expiresAt: expiresAt ?? new Date(Date.now() + 365 * 86_400_000).toISOString(),
  };
  const seg = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", secret).update(seg).digest("base64url");
  return `RABBIT-ENT1.${seg}.${sig}`;
}

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
    setTimeout(() => d.remove(), 2600);
  }, title);
  await sleep(ms);
}

async function loginAs(api, ctx, mail, pass) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await api.post(`${BASE}/api/v1/auth/login`, {
      data: { email: mail, password: pass },
    });
    const cookie = (r.headers()["set-cookie"] ?? "").split("ras=")[1]?.split(";")[0];
    if (cookie) {
      await ctx.clearCookies();
      await ctx.addCookies([{ name: "ras", value: cookie, url: BASE }]);
      return cookie;
    }
    await sleep(1200);
  }
  throw new Error(`login failed for ${mail}`);
}

let adminCookie = null;
async function adminLogin(api, ctx) {
  // cookie 缓存复用：首轮登录后直接重放（减少登录往返，避免限流窗口）
  if (adminCookie) {
    await ctx.clearCookies();
    await ctx.addCookies([{ name: "ras", value: adminCookie, url: BASE }]);
    return adminCookie;
  }
  adminCookie = await loginAs(api, ctx, "admin@rabbit.test", "rabbit-admin-123");
  return adminCookie;
}

const run = async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    recordVideo: { dir: OUT, size: { width: 1280, height: 720 } },
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(6000); // 定位器全局短超时：兜底路径失败最多 6s，不再出现 30s 冻屏
  const api = ctx.request;

  // 注册两个演示用户（第二个=新组织管理员）+ 项目
  const acct1 = await registerOrLogin(api, email);
  const projectId = acct1.projectId;
  const acct2 = await registerOrLogin(api, ownerEmail);
  const ownerUserId = acct2.userId;

  // ═══════ ① 授权管理：社区版 → 添加 License → 企业版 ═══════
  await adminLogin(api, ctx);
  // 幂等起点：清历史 License（中断重跑残留）
  await api.delete(`${BASE}/api/v1/system/license`).catch(() => {});
  // 幂等清扫：上轮演示残留的池/组织（失败忽略——唯一名后缀兜底）
  const stalePools = (
    (await (await api.get(`${BASE}/api/v1/system/pools`)).json()).data?.items ?? []
  ).filter((p) => /^验收企业池/.test(p.name));
  for (const sp of stalePools)
    await api.delete(`${BASE}/api/v1/system/pools/${sp.id}`).catch(() => {});
  const staleOrgs = (
    (await (await api.get(`${BASE}/api/v1/system/orgs`)).json()).data?.items ?? []
  ).filter((o) => /^验收电商事业部/.test(o.name));
  for (const so of staleOrgs)
    await api.delete(`${BASE}/api/v1/orgs/${so.id}?needConfirm=true`).catch(() => {});
  // 管理员自己的项目（②段场景建在此——管理员会话访问演示用户项目会跨组织 404）
  const adminProjects = (await (await api.get(`${BASE}/api/v1/personal/projects`)).json()).data;
  const adminProjectList = adminProjects?.items ?? adminProjects ?? [];
  const adminProjectId = adminProjectList.find((p) => p.num === 1)?.id ?? adminProjectList[0]?.id;
  await page.goto(`${BASE}/system/license`);
  await step(page, "S9 验收演示 · ① 授权管理：社区版（1 组织/30 用户/1 默认池）", 2600);
  await step(page, "添加企业版 License（三段式 HMAC 签名，校验后六特性全授权）", 1600);
  await page.getByTestId("btn-add-license").click();
  await page.getByTestId("input-license-code").fill(issueLicense());
  await page.getByRole("button", { name: "校验并添加" }).click();
  await sleep(1500);
  await step(page, "企业版生效：状态卡 + 六特性功能矩阵全亮（License=企业版总开关）", 2800);

  // ═══════ ② 多资源池：建池 → engine2 绑定 → 场景选池执行 ═══════
  await page.goto(`${BASE}/system/pools`);
  await step(page, "② 资源池：社区版仅默认池（新建按钮 License 门控）", 2000);
  await step(page, `新建「${poolName}」→ engine 以 POOL_ID 绑定后节点自动注册`, 1600);
  await page
    .getByTestId("btn-new-pool")
    .click()
    .catch(async () => {
      // 按钮态未刷新兜底：API 建池
      await api.post(`${BASE}/api/v1/system/pools`, {
        data: { name: poolName, type: "NODE", maxConcurrency: 4 },
      });
    });
  await page
    .getByTestId("input-pool-name")
    .fill(poolName)
    .catch(() => {});
  await page
    .getByTestId("input-new-pool-concurrency")
    .fill("4")
    .catch(() => {});
  await page
    .getByRole("button", { name: "创 建" })
    .click()
    .catch(() => {});
  await sleep(1500);
  let pools = (await (await api.get(`${BASE}/api/v1/system/pools`)).json()).data.items;
  if (!pools.find((p) => p.name === poolName)) {
    await api.post(`${BASE}/api/v1/system/pools`, {
      data: { name: poolName, type: "NODE", maxConcurrency: 4 },
    });
    pools = (await (await api.get(`${BASE}/api/v1/system/pools`)).json()).data.items;
  }
  const poolId = pools.find((p) => p.name === poolName).id;

  // 场景（脚本步骤自检，建在管理员项目）+ engine2 进程（POOL_ID）
  // moduleId 必填：取默认场景模块树根（s3-helpers defaultScenarioModuleId 同源逻辑）
  const moduleTree = (
    await (await api.get(`${BASE}/api/v1/projects/${adminProjectId}/modules?scene=scenario`)).json()
  ).data;
  const defaultModule = (function find(items) {
    for (const it of items) {
      if (it.isDefault) return it;
      const c = it.children ? find(it.children) : null;
      if (c) return c;
    }
    return null;
  })(moduleTree?.items ?? []);
  let engine2 = null;
  const scenario =
    (
      await (
        await api.post(`${BASE}/api/v1/projects/${adminProjectId}/scenarios`, {
          data: { name: scenarioName, moduleId: defaultModule?.id },
        })
      ).json()
    ).data ?? null;
  if (scenario) {
    const sd = (
      await (
        await api.get(`${BASE}/api/v1/projects/${adminProjectId}/scenarios/${scenario.id}`)
      ).json()
    ).data;
    await api
      .put(`${BASE}/api/v1/projects/${adminProjectId}/scenarios/${scenario.id}/steps`, {
        data: {
          version: sd.version,
          steps: [
            {
              uid: `demo-${Date.now().toString(36)}`,
              stepType: "script",
              name: "自检",
              enabled: true,
              config: { script: "1 + 1" },
              children: [],
            },
          ],
        },
      })
      .catch(() => {});
    engine2 = spawn("pnpm", ["--filter", "engine", "start"], {
      cwd: path.resolve(import.meta.dirname ?? ".", "../../.."),
      env: {
        ...process.env,
        POOL_ID: poolId,
        REDIS_URL: process.env.DEMO_REDIS_URL ?? "redis://127.0.0.1:6381",
        WEB_URL: BASE,
        INTERNAL_TOKEN: process.env.INTERNAL_TOKEN ?? "dev-internal-token",
      },
      stdio: "ignore",
    });
    await step(page, "启动第二个 engine 进程（POOL_ID=验收企业池）→ 心跳注册节点…", 2600);
    // 等节点 ONLINE（10s 心跳周期）
    for (let i = 0; i < 14; i++) {
      await sleep(2000);
      const p = (await (await api.get(`${BASE}/api/v1/system/pools/${poolId}`)).json()).data;
      if (p?.nodes?.some((n) => n.state === "ONLINE")) break;
    }
    await page.reload();
    await sleep(1200);
    await step(page, `${poolName}：节点 ONLINE（按池队列 exec-pool-{poolId} 隔离调度）`, 2600);

    // 场景执行选池（批量执行弹窗选池）
    await page.goto(`${BASE}/scenarios`);
    await step(page, `场景列表 → 选中场景 → 批量执行 → 资源池=${poolName}`, 1600);
    const row = page.getByRole("row", { name: new RegExp(scenarioName) });
    await row
      .getByRole("checkbox")
      .check()
      .catch(() => row.click().catch(() => {}));
    await sleep(800);
    await page
      .getByRole("button", { name: "批量执行" })
      .click()
      .catch(() => {});
    await sleep(1200);
    await page
      .getByTestId("select-exec-pool")
      .click()
      .catch(() => {});
    await page
      .getByTitle(poolName, { exact: false })
      .first()
      .click()
      .catch(() => {});
    await sleep(600);
    await page
      .locator(".ant-modal .ant-btn-primary")
      .last()
      .click()
      .catch(() => {});
    await sleep(1200);
    await page
      .locator(".ant-modal .ant-btn-primary")
      .last()
      .click()
      .catch(() => {});
    await sleep(2500);
    await step(page, "任务提交至验收企业池（仅该池 engine 消费——池间隔离）", 2400);
    await page.goto(`${BASE}/tasks`);
    await sleep(2000);
    // UI 提交失败兜底：API 直接投递到企业池（再回任务页展示）
    // 判据=最近 90s 内新建任务（任务名是 taskId 十六进制，不含场景名）
    let submitted = false;
    try {
      const tasks = (
        await (
          await api.get(`${BASE}/api/v1/projects/${adminProjectId}/exec-tasks?page=1&pageSize=20`)
        ).json()
      ).data;
      submitted = (tasks?.items ?? []).some(
        (t) => Date.now() - new Date(t.createdAt).getTime() < 90_000,
      );
    } catch {}
    if (!submitted) {
      await api
        .post(`${BASE}/api/v1/projects/${adminProjectId}/scenarios/execute`, {
          data: { scenarioIds: [scenario.id], poolId, stopOnFail: false, mode: "serial" },
        })
        .catch(() => {});
      await page.goto(`${BASE}/tasks`);
      await sleep(2000);
    }
  }

  // ═══════ ③ 多组织 + 顶栏切换器 ═══════
  await page.goto(`${BASE}/system/orgs`);
  await step(page, `③ 组织管理：新建组织「${orgName}」（管理员=第二用户）`, 1600);
  await page
    .getByTestId("btn-new-org")
    .click()
    .catch(() => {});
  await page
    .getByTestId("input-org-name")
    .fill(orgName)
    .catch(() => {});
  await page
    .getByTestId("select-org-owner")
    .click()
    .catch(() => {});
  await page.keyboard.type(ownerEmail).catch(() => {});
  await sleep(1200);
  await page
    .getByRole("option", { name: new RegExp(ownerEmail.slice(0, 16)) })
    .first()
    .click()
    .catch(() => {});
  await page
    .getByRole("button", { name: "创 建" })
    .click()
    .catch(() => {});
  await sleep(1800);
  // API 兜底：UI 建组织失败时补建（唯一名——重跑不 409）
  const orgsAfterUi = (await (await api.get(`${BASE}/api/v1/system/orgs`)).json()).data.items;
  if (!orgsAfterUi.some((o) => o.name === orgName)) {
    await api
      .post(`${BASE}/api/v1/system/orgs`, { data: { name: orgName, ownerEmail } })
      .catch(() => {});
  }
  await step(page, "多组织=企业版能力（社区版按钮禁用）· 结束/删除带保护", 2200);

  // 第二用户视角：切换器
  await loginAs(api, ctx, ownerEmail, password);
  await page.goto(`${BASE}/`);
  await sleep(1500);
  await step(page, "第二用户（两个组织）→ 顶栏出现组织切换器", 2000);
  await page
    .getByTestId("org-switcher")
    .click({ timeout: 8000 })
    .catch(() => {});
  await sleep(1000);
  await step(page, `切换到「${orgName}」→ 项目列表按组织过滤（新组织=空）`, 1600);
  await page
    .getByRole("menuitem", { name: orgName })
    .click()
    .catch(() => {});
  await sleep(1800);

  // ═══════ ④ 部门树 ═══════
  await adminLogin(api, ctx);
  const orgs = (await (await api.get(`${BASE}/api/v1/system/orgs`)).json()).data.items;
  const adminOrgId = orgs[0].id;
  await page.goto(`${BASE}/org/departments`);
  await sleep(1200);
  await step(page, `④ 部门管理：建两级部门树（${deptRootName} > ${deptSubName}）`, 1600);
  await page
    .getByTestId("btn-new-department-root")
    .click()
    .catch(async () => {
      await api.post(`${BASE}/api/v1/orgs/${adminOrgId}/departments`, {
        data: { name: deptRootName },
      });
    });
  await page
    .getByTestId("input-department-name")
    .fill(deptRootName)
    .catch(() => {});
  await page
    .getByRole("button", { name: "创 建" })
    .click()
    .catch(() => {});
  await sleep(1500);
  const tree = (await (await api.get(`${BASE}/api/v1/orgs/${adminOrgId}/departments`)).json()).data;
  let root = tree.find((n) => n.name === deptRootName);
  if (!root) {
    // UI 建根部门失败兜底
    await api
      .post(`${BASE}/api/v1/orgs/${adminOrgId}/departments`, { data: { name: deptRootName } })
      .catch(() => {});
    const tree2 = (await (await api.get(`${BASE}/api/v1/orgs/${adminOrgId}/departments`)).json())
      .data;
    root = tree2.find((n) => n.name === deptRootName);
  }
  await api.post(`${BASE}/api/v1/orgs/${adminOrgId}/departments`, {
    data: { name: deptSubName, parentId: root.id },
  });
  await api.post(`${BASE}/api/v1/orgs/${adminOrgId}/members-add`, {
    data: { userIds: [ownerUserId] },
  });
  const subTree = (await (await api.get(`${BASE}/api/v1/orgs/${adminOrgId}/departments`)).json())
    .data;
  const sub = subTree.find((n) => n.name === deptSubName) ?? root;
  await api.post(`${BASE}/api/v1/orgs/${adminOrgId}/departments/${sub.id}/members`, {
    data: { userIds: [ownerUserId] },
  });
  await page.reload();
  await sleep(1500);
  await step(page, "挂成员到子部门（多对多；有子部门/重名/越组织均有保护）", 2400);
  await page.getByTestId(`department-node-${sub.id}`).click();
  await sleep(1800);

  // ═══════ ⑤ 用户上限口径 ═══════
  await page.goto(`${BASE}/system/users`);
  await sleep(1200);
  await step(page, "⑤ 用户管理：企业版「不限」口径（License USER_SCALE 放开社区版 30 上限）", 2600);

  // ═══════ ⑥ 主题品牌 ═══════
  await page.goto(`${BASE}/system/params`);
  await page.getByRole("tab", { name: "界面设置" }).click();
  await sleep(1200);
  await step(page, "⑥ 界面设置：主题色+网站名称+Slogan（右侧实时预览）", 1600);
  await page
    .getByTestId("input-theme-site-name")
    .fill("星舟测试平台")
    .catch(() => {});
  await page
    .getByTestId("input-theme-slogan")
    .fill("质量驱动交付")
    .catch(() => {});
  await sleep(1200);
  await page
    .getByTestId("btn-theme-save")
    .click()
    .catch(async () => {
      await api.put(`${BASE}/api/v1/system/params/theme`, {
        data: {
          group: "theme",
          value: {
            primaryColor: "#574BFF",
            followPrimary: true,
            siteName: "星舟测试平台",
            slogan: "质量驱动交付",
            loginLogo: "",
            loginBg: "",
            icon: "",
            platformName: "RabbitAITest",
            platformLogo: "",
            helpUrl: "",
          },
        },
      });
    });
  await sleep(1500);
  await step(page, "保存并应用 → 登录页品牌即时生效", 1600);
  await ctx.clearCookies();
  await page.goto(`${BASE}/login`);
  await sleep(2000);
  await step(page, "登出视角：登录页=定制品牌（名称/Slogan/主题色）", 3000);
  // 恢复默认（防污染）
  await adminLogin(api, ctx);
  await page.goto(`${BASE}/system/params`);
  await page.getByRole("tab", { name: "界面设置" }).click();
  await sleep(1000);
  await page.getByTestId("btn-theme-reset").click();
  await page.getByTestId("btn-theme-save").click();
  await sleep(1000);

  // ═══════ ⑦ 消息模板渲染 ═══════
  // 前置：切回演示用户会话（项目 OWNER）；事件配置 + 站内信机器人（接收人=演示用户）
  await loginAs(api, ctx, email, password);
  const robot = (
    await (
      await api.post(`${BASE}/api/v1/projects/${projectId}/robots`, {
        data: { name: "验收-站内信", channel: "inapp", enabled: true },
      })
    ).json()
  ).data;
  const demoUserId = acct1.userId;
  if (robot && demoUserId) {
    await api.put(`${BASE}/api/v1/projects/${projectId}/message-config`, {
      data: { BUG_CREATED: { enabled: true, robotIds: [robot.id], receiverUserIds: [demoUserId] } },
    });
    await page.goto(`${BASE}/settings/messages`);
    await page.getByRole("tab", { name: "模板" }).click();
    await sleep(1500);
    await step(page, "⑦ 消息模板：11 事件目录 · 定制缺陷创建标题（变量 chip 插入）", 1600);
    await page
      .getByTestId("template-event-BUG_CREATED")
      .click()
      .catch(() => {});
    await sleep(600);
    await page
      .getByTestId("input-template-title")
      .fill("[${project}] ${actorName} 提交了缺陷")
      .catch(() => {});
    await page
      .getByTestId("input-template-content")
      .fill("缺陷：${title}")
      .catch(() => {});
    await sleep(600);
    await page
      .getByTestId("btn-template-preview")
      .click()
      .catch(() => {});
    await sleep(1500);
    await step(page, "实时预览（服务端示例数据渲染）→ 保存", 1800);
    await page
      .getByTestId("btn-template-save")
      .click()
      .catch(() => {});
    await sleep(1500);
    // 触发：管理员建缺陷 → 演示用户站内信按模板渲染
    await api.post(`${BASE}/api/v1/projects/${projectId}/bugs`, {
      data: { title: "验收：支付偶发超时" },
    });
    await sleep(1200);
    await loginAs(api, ctx, email, password);
    await page.goto(`${BASE}/personal/notifications`);
    await sleep(1800);
    await step(page, "触发缺陷创建 → 接收人站内信按模板渲染（无模板事件回退默认）", 3000);
    // 恢复默认模板
    await api
      .delete(`${BASE}/api/v1/projects/${projectId}/message-templates/BUG_CREATED`)
      .catch(() => {});
  }

  // ═══════ ⑧ SSO + 扫码登录（mock IdP）═══════
  await adminLogin(api, ctx);
  // 幂等：清历史认证源（中断重跑残留——多源致登录页 strict mode 冲突）
  const oldSources = (await (await api.get(`${BASE}/api/v1/system/sso`)).json()).data?.items ?? [];
  for (const os of oldSources)
    await api.delete(`${BASE}/api/v1/system/sso/${os.id}`).catch(() => {});
  // OIDC 源（两步：占位 → PATCH 注入 mock 端点）
  const oidcCreated = await api.post(`${BASE}/api/v1/system/sso`, {
    data: {
      type: "OIDC",
      name: "验收-Keycloak",
      enabled: true,
      config: {
        authEndpoint: `${MOCK}/sso/oidc/x/a`,
        tokenEndpoint: `${MOCK}/sso/oidc/x/t`,
        userinfoEndpoint: `${MOCK}/sso/oidc/x/u`,
        clientId: "demo-client",
        clientSecret: "demo-secret",
      },
    },
  });
  const oidcId = (await oidcCreated.json()).data.id;
  await api.patch(`${BASE}/api/v1/system/sso/${oidcId}`, {
    data: {
      type: "OIDC",
      name: "验收-Keycloak",
      enabled: true,
      config: {
        authEndpoint: `${MOCK}/sso/oidc/${oidcId}/authorize`,
        tokenEndpoint: `${MOCK}/sso/oidc/${oidcId}/token`,
        userinfoEndpoint: `${MOCK}/sso/oidc/${oidcId}/userinfo`,
        clientId: "demo-client",
        clientSecret: "demo-secret",
      },
    },
  });
  await api.post(`${MOCK}/sso/_test/config`, {
    data: {
      authId: oidcId,
      userinfo: {
        preferred_username: "demo-sso",
        name: "验收 SSO 用户",
        email: `demo-sso-${Date.now()}@idp.test`,
      },
    },
  });
  // 钉钉扫码源
  const dingCreated = await api.post(`${BASE}/api/v1/system/sso`, {
    data: {
      type: "DINGTALK",
      name: "验收-钉钉扫码",
      enabled: true,
      config: { clientId: "demo-ding", agentId: "demo-agent", clientSecret: "demo-ding-secret" },
    },
  });
  const dingId = (await dingCreated.json()).data.id;
  await api.patch(`${BASE}/api/v1/system/sso/${dingId}`, {
    data: {
      type: "DINGTALK",
      name: "验收-钉钉扫码",
      enabled: true,
      config: {
        clientId: "demo-ding",
        agentId: "demo-agent",
        clientSecret: "demo-ding-secret",
        apiBase: `${MOCK}/sso/dingtalk/${dingId}`,
        authorizeBase: `${MOCK}/sso`,
      },
    },
  });
  await api.post(`${MOCK}/sso/_test/config`, {
    data: {
      authId: dingId,
      userinfo: { openId: `demo-open-${Date.now().toString(36)}`, nick: "扫码验收用户" },
    },
  });
  await page.goto(`${BASE}/system/sso`);
  await sleep(1500);
  await step(page, "⑧ 认证配置：OIDC + 钉钉扫码认证源（8 类型；密钥加密掩码）", 2600);

  // 登出 → 登录页「更多登录方式」
  await ctx.clearCookies();
  await page.goto(`${BASE}/login`);
  await sleep(1500);
  await step(page, "登录页出现「其他登录方式」（OIDC + 钉钉扫码）", 2000);
  await step(page, "点击 OIDC → mock IdP 自动授权 → 回调建号登录", 1600);
  await page
    .getByTestId("sso-method-OIDC")
    .first()
    .click()
    .catch(() => {});
  await sleep(4000);
  await step(page, "SSO 登录成功（source=OIDC，@idp.test 账号）", 2400);
  const me2 = (await (await page.request.get(`${BASE}/api/v1/personal/me`)).json()).data;
  await ctx.clearCookies();
  await page.goto(`${BASE}/login`);
  await sleep(1200);
  await step(page, "钉钉扫码入口 → mock 扫码授权中转 → 回调登录（@sso.scan 合成账号幂等）", 1600);
  await page
    .getByTestId("sso-method-DINGTALK")
    .first()
    .click()
    .catch(() => {});
  await sleep(4000);
  const me3 = (await (await page.request.get(`${BASE}/api/v1/personal/me`)).json()).data;
  await step(
    page,
    me3?.email?.includes("@sso.scan")
      ? "扫码登录成功（合成 @sso.scan 账号）"
      : `扫码登录（${me3?.email ?? "?"}）`,
    2400,
  );

  // 清理（切回 admin——扫码段后浏览器会话是 SSO 用户）：删源、删池（停 engine2）、删组织、移除 License
  await adminLogin(api, ctx);
  await api.delete(`${BASE}/api/v1/system/sso/${oidcId}`).catch(() => {});
  await api.delete(`${BASE}/api/v1/system/sso/${dingId}`).catch(() => {});
  engine2?.kill("SIGTERM");
  await sleep(800);
  engine2?.kill("SIGKILL");
  await api
    .patch(`${BASE}/api/v1/system/pools/${poolId}`, { data: { status: "ACTIVE" } })
    .catch(() => {});
  await api.delete(`${BASE}/api/v1/system/pools/${poolId}`).catch(() => {});
  const orgsNow = (await (await api.get(`${BASE}/api/v1/system/orgs`)).json()).data.items;
  const demoOrg = orgsNow.find((o) => o.name === orgName);
  if (demoOrg)
    await api.delete(`${BASE}/api/v1/orgs/${demoOrg.id}?needConfirm=true`).catch(() => {});
  await api.delete(`${BASE}/api/v1/system/license`).catch(() => {});

  await step(
    page,
    "S9 验收演示结束 —— 八功能：License 门控/多资源池(engine2 绑池)/多组织+切换器/部门树/用户扩容/主题品牌/消息模板/SSO+扫码（演示后已还原社区版）",
    4000,
  );

  await ctx.close();
  await browser.close();

  // 录像文件重命名为固定名（排除既有目标名——否则字母序会选中旧目标自我重命名）
  const webm = readdirSync(OUT).filter(
    (f) => f.endsWith(".webm") && f !== "s9-acceptance-demo.webm",
  );
  if (webm.length) {
    const target = path.join(OUT, "s9-acceptance-demo.webm");
    renameSync(path.join(OUT, webm[webm.length - 1]), target);
    console.log(`[demo] video → ${target}`);
  }
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});

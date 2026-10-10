#!/usr/bin/env node
/**
 * prep.mjs — 教学视频演示数据准备（scripts/tutor 四件套之三）
 *
 * 用法:
 *   node scripts/tutor/prep.mjs            # 幂等造数：已存在的演示数据跳过
 *   node scripts/tutor/prep.mjs --reset    # 先删旧演示数据（按「演示」命名约定）再全量重建
 *
 * 约定:
 * - 全部演示数据命名带「演示-」前缀（模块/环境/计划组用「演示」前缀），便于识别与 --reset 清理
 * - 不动 seed 数据（管理员/组织/项目/资源池/AI 模型），不造 License，不改任何源码
 * - 请求体形状一律对齐 tests/e2e/*.spec.ts 的真实用例（CASE-002/004/005、BUG-001、PLAN-001/003/004、
 *   API-002/008、PROJ-003/005、UIT-003/004）
 * - 前置：dev 栈在跑（web :3000 / mock :4000 / engine :4300 / PG :5440 / redis :6391）
 * - 可选加分：用仓库根 node_modules 的 prisma（packages/db 工作区）把 createdAt 分散到过去 14 天，
 *   连不上 DB 则跳过不算失败
 *
 * 幂等口径：实体按「精确名称」查列表已存在则跳过；执行类操作（场景/UI 用例 run）只在实体为本轮
 * 新建时触发——重跑不追加任务；要重刷任务用 --reset。
 */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");

// ── 环境开关（默认 dev 栈口径，见 AGENTS.md §4.2）──
const WEB = process.env.TUTOR_WEB_URL ?? "http://localhost:3000";
const MOCK = process.env.TUTOR_MOCK_URL ?? "http://127.0.0.1:4000";
const PG_URL =
  process.env.TUTOR_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:5440/rabbit";
const ADMIN_EMAIL = process.env.TUTOR_ADMIN_EMAIL ?? "admin@rabbit.test";
const ADMIN_PASSWORD = process.env.TUTOR_ADMIN_PASSWORD ?? "rabbit-admin-123";

const RESET = process.argv.includes("--reset");
const PREFIX = "演示";

const log = (...a) => console.log("[prep]", ...a);
const warn = (...a) => console.warn("[prep:warn]", ...a);

// ───────────────────────── HTTP（登录态 ras cookie）─────────────────────────
let ras = "";

/** 瞬态失败重试：dev 栈偶发连接抖动/连接池耗尽 5xx（GET 4 次、变更 2 次）；4xx 业务错误不重试 */
async function raw(method, pathname, body) {
  const maxAttempts = method === "GET" ? 4 : 2;
  let lastErr = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(`${WEB}${pathname}`, {
        method,
        headers: {
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
          ...(ras ? { cookie: `ras=${ras}` } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      const setCookie = res.headers.get("set-cookie") ?? "";
      const m = setCookie.match(/ras=([^;]+)/);
      if (m) ras = m[1];
      const text = await res.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {
        /* 非 JSON 响应（如导出二进制）不进本脚本 */
      }
      // 5xx 视为瞬态（dev 连接池耗尽）：可重试；2xx/4xx 直接返回
      if (res.status >= 500 && attempt < maxAttempts) {
        lastErr = new Error(
          `${method} ${pathname} -> ${res.status}（重试 ${attempt}/${maxAttempts - 1}）`,
        );
        await sleep(1200 * attempt);
        continue;
      }
      return { status: res.status, json, text };
    } catch (err) {
      lastErr = err;
      if (attempt >= maxAttempts) break;
      await sleep(1200 * attempt);
    }
  }
  throw lastErr ?? new Error(`${method} ${pathname} 请求失败`);
}

/** 业务信封解包：非 2xx 或 code!==0 抛错（带响应体，便于按 e2e spec 最小合法 body 修正） */
async function api(method, pathname, body, { ok = [200, 201, 202] } = {}) {
  const r = await raw(method, pathname, body);
  if (!ok.includes(r.status) || !r.json || r.json.code !== 0) {
    throw new Error(`${method} ${pathname} -> ${r.status} ${r.text?.slice(0, 400)}`);
  }
  return r.json.data;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 列表端点信封不一（items / list / groups），统一取数组 */
const asItems = (data) =>
  Array.isArray(data) ? data : (data?.items ?? data?.list ?? data?.groups ?? []);

/** 幂等建实体：列表里精确同名则复用 */
async function ensure(name, list, create) {
  if (!RESET) {
    const hit = await list();
    if (hit) {
      log(`跳过已存在：${name}`);
      return { ...hit, __existed: true };
    }
  }
  const created = await create();
  log(`已创建：${name}`);
  return { ...created, __existed: false };
}

// ───────────────────────── 请求包模板（对齐 s2/s3-helpers.bundle）─────────────────────────
function bundle(method, url, patch = {}) {
  return {
    spec: {
      method,
      url,
      headers: [],
      query: [],
      body: { kind: "none" },
      auth: { kind: "none" },
      timeoutMs: 10000,
      followRedirects: false,
      skipPre: false,
      skipPost: false,
    },
    asserts: [{ kind: "status_code", path: "", op: "eq", expected: "200" }],
    pre: [],
    post: [],
    extracts: [],
    ...patch,
  };
}

const assert = (kind, path_, op, expected) => ({ kind, path: path_, op, expected });

// ───────────────────────── Prisma（--reset 与 createdAt 回填；连不上则降级）─────────────────────────
function loadPrisma() {
  try {
    // 仓库根 node_modules 无 @prisma/client（pnpm 严格布局），经 packages/db 工作区符号链接解析
    const req = createRequire(path.join(ROOT, "packages/db/package.json"));
    const { PrismaClient } = req("@prisma/client");
    return new PrismaClient({ datasources: { db: { url: PG_URL } } });
  } catch (err) {
    warn(`prisma 客户端不可用：${err.message}`);
    return null;
  }
}

async function prismaConnect(prisma) {
  if (!prisma) return false;
  try {
    await prisma.$queryRaw`select 1`;
    return true;
  } catch (err) {
    warn(`PG 直连失败（${PG_URL}）：${err.message?.split("\n")[0]}`);
    return false;
  }
}

/**
 * 空闲连接收割（dev 环境专用）：
 * Next dev 每个编译产物模块组各建一套 tenant PrismaClient（connection_limit=20），
 * 多路由首编译后连接数迅速逼近 embedded PG 的 max_connections（100）→ 全站 500。
 * 只回收 idle 连接（不碰 running），被裁的活跃池会按需重连；旧编译产物僵尸池则永不重连=净释放。
 */
function startReaper(prisma) {
  let reaped = 0;
  const reapOnce = async () => {
    try {
      const rows = await prisma.$queryRaw`
        select pg_terminate_backend(pid) as killed
        from pg_stat_activity
        where usename = 'rabbit_tenant' and state = 'idle'
          and state_change < now() - interval '90 seconds'
          and pid <> pg_backend_pid()`;
      const n = rows.filter((r) => r.killed).length;
      if (n > 0) {
        reaped += n;
        log(`连接收割：终止 ${n} 条 idle rabbit_tenant 连接（累计 ${reaped}）`);
      }
    } catch {
      /* 收割失败不影响主流程 */
    }
  };
  const timer = setInterval(reapOnce, 20_000);
  timer.unref?.();
  reapOnce(); // 开局先收一轮（上一轮脚本/浏览遗留的僵尸池）
  return () => clearInterval(timer);
}

// ───────────────────────── 演示数据定义 ─────────────────────────
const MODULE_DEFS = ["登录", "购物车", "优惠券", "订单"].map((s) => `演示-${s}模块`);

const CASE_DEFS = [
  {
    name: "演示-登录成功校验",
    module: 0,
    level: "P0",
    tags: ["冒烟", "回归"],
    precondition: "用户已注册且账号状态正常",
    steps: [
      { desc: "打开登录页，输入正确账号密码", expect: "登录表单可提交" },
      { desc: "点击登录按钮", expect: "跳转首页且右上角显示用户名" },
    ],
  },
  {
    name: "演示-密码错误提示",
    module: 0,
    level: "P1",
    tags: [],
    precondition: "用户已注册",
    steps: [{ desc: "输入错误密码点击登录", expect: "提示「账号或密码错误」且不跳转" }],
  },
  {
    name: "演示-验证码刷新",
    module: 0,
    level: "P2",
    tags: [],
    steps: [{ desc: "点击验证码图片", expect: "验证码图片刷新且旧码失效" }],
  },
  {
    name: "演示-添加商品到购物车",
    module: 1,
    level: "P1",
    tags: ["回归"],
    precondition: "用户已登录且商品有库存",
    steps: [
      { desc: "在商品详情页点击加入购物车", expect: "提示添加成功" },
      { desc: "打开购物车页面", expect: "购物车列表出现该商品且数量为 1" },
    ],
  },
  {
    name: "演示-修改购物车商品数量",
    module: 1,
    level: "P2",
    tags: [],
    steps: [{ desc: "购物车中把数量改为 2", expect: "小计与总价按 2 件重算" }],
  },
  {
    name: "演示-清空购物车",
    module: 1,
    level: "P3",
    tags: [],
    steps: [{ desc: "点击清空购物车并确认", expect: "购物车为空且显示空态文案" }],
  },
  {
    name: "演示-领取优惠券",
    module: 2,
    level: "P1",
    tags: ["冒烟"],
    precondition: "用户未领取过该券且活动进行中",
    steps: [
      { desc: "进入领券中心点击领取", expect: "提示领取成功" },
      { desc: "打开我的优惠券", expect: "列表出现该券且状态为未使用" },
    ],
  },
  {
    name: "演示-过期优惠券不可用",
    module: 2,
    level: "P2",
    tags: [],
    precondition: "账户持有一张已过期优惠券",
    steps: [{ desc: "下单时选择过期优惠券", expect: "该券置灰不可选并标注已过期" }],
  },
  {
    name: "演示-提交订单成功",
    module: 3,
    level: "P0",
    tags: ["冒烟", "回归"],
    precondition: "购物车有商品且默认收货地址存在",
    steps: [
      { desc: "购物车结算进入订单确认页", expect: "商品/金额/地址信息正确" },
      { desc: "点击提交订单", expect: "生成订单号并跳转支付页" },
    ],
  },
  {
    name: "演示-取消订单并退款",
    module: 3,
    level: "P2",
    tags: [],
    precondition: "存在待支付订单",
    steps: [{ desc: "订单详情点击取消订单", expect: "订单状态变为已取消且退款流程发起" }],
  },
];

const BUG_DEFS = [
  {
    title: "演示-登录页偶发500",
    severity: "致命",
    to: null,
    caseIdx: 0,
    desc: "登录接口偶发 500，高峰期复现率约 5%，影响主链路登录。",
  },
  {
    title: "演示-购物车金额计算错误",
    severity: "严重",
    to: "处理中",
    caseIdx: 3,
    desc: "满减活动下购物车总价未扣除优惠，多收用户款项。",
  },
  {
    title: "演示-优惠券叠加失效",
    severity: "一般",
    to: "已关闭",
    caseIdx: 6,
    desc: "两张优惠券不可叠加为预期行为，运营确认后关闭。",
  },
  {
    title: "演示-订单列表分页错乱",
    severity: "一般",
    to: null,
    caseIdx: null,
    desc: "第 2 页偶现与第 1 页重复数据。",
  },
  {
    title: "演示-头像上传失败",
    severity: "轻微",
    to: "处理中",
    caseIdx: null,
    desc: "上传大于 2MB 头像时偶发失败。",
  },
  {
    title: "演示-深色模式样式错位",
    severity: "轻微",
    to: "已关闭",
    caseIdx: null,
    desc: "深色模式下弹窗按钮错位，已随 v1.2 修复发布。",
  },
];

const API_DEFS = [
  {
    name: "演示-用户登录",
    method: "POST",
    path: "${host}/perf/echo",
    query: [{ key: "verbose", value: "true" }],
    bodyJson: { email: "demo@rabbit.test", password: "rabbit-demo-123" },
    resp: '{"code":0,"data":{"token":"demo-token","userId":"u-1001"}}',
    cases: [
      { name: "演示-登录成功校验（200）", asserts: [assert("status_code", "", "eq", "200")] },
      {
        name: "演示-登录-响应体校验",
        asserts: [
          assert("status_code", "", "eq", "200"),
          assert("body_jsonpath", "$.echo", "eq", "true"),
        ],
      },
    ],
  },
  {
    name: "演示-商品列表",
    method: "GET",
    path: "${host}/hello",
    query: [],
    bodyJson: null,
    resp: '{"code":0,"data":{"items":[{"id":1,"name":"Rabbit 玩偶"},{"id":2,"name":"测试手册"}]}}',
    cases: [
      {
        name: "演示-商品列表-服务状态校验",
        asserts: [assert("body_jsonpath", "$.status", "eq", "UP")],
      },
    ],
  },
  {
    name: "演示-创建订单",
    method: "POST",
    path: "${host}/perf/echo",
    query: [],
    bodyJson: { skuId: "SKU-001", quantity: 2, addressId: "addr-default" },
    resp: '{"code":0,"data":{"orderId":"ORD-20260001","payAmount":199.00}}',
    cases: [
      { name: "演示-创建订单（200）", asserts: [assert("status_code", "", "eq", "200")] },
      {
        name: "演示-创建订单-回显校验",
        asserts: [assert("body_jsonpath", "$.body.skuId", "eq", "SKU-001")],
      },
    ],
  },
  {
    name: "演示-领取优惠券",
    method: "POST",
    path: "${host}/perf/echo",
    query: [],
    bodyJson: { couponCode: "NEW10" },
    resp: '{"code":0,"data":{"couponId":"CPN-01","amount":10}}',
    cases: [{ name: "演示-领取优惠券（200）", asserts: [assert("status_code", "", "eq", "200")] }],
  },
];

const ELEMENT_DEFS = [
  {
    name: "演示-用户名输入框",
    locatorType: "testid",
    locator: "demo-username",
    description: "登录演示页用户名输入框",
  },
  {
    name: "演示-提交按钮",
    locatorType: "testid",
    locator: "demo-submit",
    description: "登录演示页提交按钮",
  },
  {
    name: "演示-结果文案",
    locatorType: "css",
    locator: ".demo-result-text",
    description: "提交后结果文案区域",
  },
];

function okScript() {
  return `import { test, expect } from '@playwright/test';
test('脚本提交成功', async ({ page }) => {
  await page.goto('${MOCK}/uit/demo');
  await page.getByTestId('demo-username').fill('demo-user');
  await page.getByTestId('demo-submit').click();
  await expect(page.getByTestId('demo-result')).toContainText('提交成功，demo-user');
});
test('元素可见', async ({ page }) => {
  await page.goto('${MOCK}/uit/demo');
  await expect(page.getByTestId('demo-username')).toBeVisible();
});`;
}

/** 幂等建模块（CASE-002：POST /modules?scene=xxx {name}；同 scene 精确同名复用） */
async function ensureModule(pid, scene, name) {
  const list = await api("GET", `/api/v1/projects/${pid}/modules?scene=${scene}`);
  const found = asItems(list).find((m) => m.name === name);
  if (found) {
    log(`跳过已存在模块（${scene}）：${name}`);
    return found;
  }
  const m = await api("POST", `/api/v1/projects/${pid}/modules?scene=${scene}`, { name });
  log(`已创建模块（${scene}）：${name}`);
  return m;
}

// ───────────────────────── main ─────────────────────────
const createdTasks = []; // {kind, taskId, name}
let prisma = null;
let prismaOk = false;

async function main() {
  log(`目标：web=${WEB} mock=${MOCK}${RESET ? "（--reset 重建）" : "（幂等）"}`);

  // 1. 登录 + 项目 + 本人
  const login = await raw("POST", "/api/v1/auth/login", {
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
  });
  if (login.status !== 200 || !ras)
    throw new Error(`管理员登录失败：${login.status} ${login.text?.slice(0, 200)}`);
  const projects = await api("GET", "/api/v1/personal/projects");
  const project = projects.find((p) => p.name === "管理项目" && p.role === "OWNER") ?? projects[0];
  if (!project) throw new Error("找不到种子项目「管理项目」");
  const pid = project.id;
  const me = await api("GET", "/api/v1/personal/me");
  log(`登录成功：${ADMIN_EMAIL}，项目「${project.name}」(${pid.slice(0, 8)}…)`);

  const P = (p) => `/api/v1/projects/${pid}${p}`;

  prisma = loadPrisma();
  prismaOk = await prismaConnect(prisma);
  let stopReaper = () => {};
  if (prismaOk) {
    stopReaper = startReaper(prisma);
  }

  // 2. --reset：按「演示」命名约定直连 DB 硬删（FK 安全序）
  if (RESET) {
    if (!prismaOk) throw new Error("--reset 需要 prisma 直连 PG（检查 :5440 是否在跑）");
    await resetDemoData(prisma, pid);
  }

  // 3. 模块树（scene=case；CASE-002：POST /modules?scene=case {name}）
  const moduleIds = {};
  for (const name of MODULE_DEFS) {
    moduleIds[name] = (await ensureModule(pid, "case", name)).id;
  }

  // 4. 功能用例 10 条（CASE-004 apiCreateCase 形状 + moduleId）
  const cases = [];
  for (const def of CASE_DEFS) {
    const c = await ensure(
      def.name,
      async () => {
        const list = await api(
          "GET",
          P(`/cases?keyword=${encodeURIComponent(def.name)}&pageSize=20`),
        );
        return (list.items ?? []).find((i) => i.name === def.name);
      },
      async () =>
        api("POST", P("/cases"), {
          name: def.name,
          precondition: def.precondition ?? "",
          steps: def.steps,
          level: def.level,
          tags: def.tags ?? [],
          fields: {},
          moduleId: moduleIds[MODULE_DEFS[def.module]],
        }),
    );
    cases.push({ id: c.id, def });
  }

  // 5. 缺陷 6 条（BUG-001：POST /bugs {title,description,tags,fields}；fields.severity 为动态字段；
  //    预置工作流：待处理→处理中→已关闭）
  const bugs = [];
  for (const def of BUG_DEFS) {
    const b = await ensure(
      def.title,
      async () => {
        const list = await api("GET", P(`/bugs?pageSize=200`));
        return (list.items ?? []).find((i) => i.title === def.title);
      },
      async () =>
        api("POST", P("/bugs"), {
          title: def.title,
          description: def.desc,
          tags: ["演示"],
          fields: { severity: def.severity },
        }),
    );
    // 状态推进（仅新建时；幂等重跑不重复流转）
    if (!b.__existed && def.to) {
      if (def.to === "处理中") {
        await api("POST", P(`/bugs/${b.id}/transition`), {
          toState: "处理中",
          comment: "开始排查，已指派责任人",
        });
      } else if (def.to === "已关闭") {
        await api("POST", P(`/bugs/${b.id}/transition`), {
          toState: "处理中",
          comment: "已定位根因",
        });
        await api("POST", P(`/bugs/${b.id}/transition`), {
          toState: "已关闭",
          comment: "已修复并验证通过，随版本发布关闭",
        });
      }
    }
    // 关联用例（PLAN-001：POST /bugs/{id}/cases {caseId}）
    if (!b.__existed && def.caseIdx !== null && cases[def.caseIdx]) {
      await api("POST", P(`/bugs/${b.id}/cases`), { caseId: cases[def.caseIdx].id });
    }
    bugs.push(b);
  }

  // 6. 用例评审 1 个（CASE-005：建评审→逐条 judge PASS→close 结束）
  const reviewName = "演示-登录模块用例评审";
  const review = await ensure(
    reviewName,
    async () => {
      const list = await api("GET", P(`/reviews?pageSize=50`));
      return (list.items ?? []).find((i) => i.name === reviewName);
    },
    async () =>
      api("POST", P("/reviews"), {
        name: reviewName,
        reviewMode: "MULTI",
        reviewers: [me.userId],
        caseIds: cases.slice(0, 3).map((c) => c.id),
      }),
  );
  if (!review.__existed) {
    for (const c of cases.slice(0, 3)) {
      await api("POST", P(`/reviews/${review.id}/cases/${c.id}/judge`), {
        result: "PASS",
        comment: "步骤与预期清晰，评审通过",
      });
    }
    await api("POST", P(`/reviews/${review.id}/close`));
    log(`评审已完成标记 + 结束：${reviewName}`);
  }

  // 7. 测试计划 2 个 + 分组 1 个（PLAN-001/004；手填执行结果→状态自动推进 COMPLETED/UNDERWAY）
  const groupName = "演示-回归计划组";
  const group = await ensure(
    groupName,
    async () => {
      const list = await api("GET", P(`/plan-groups?pageSize=50`));
      return asItems(list).find((i) => i.name === groupName);
    },
    async () =>
      api("POST", P("/plan-groups"), { name: groupName, description: "演示用回归计划分组" }),
  );

  const planADefs = [0, 3, 6, 8, 9]; // 回归：登录/购物车/优惠券/订单 混合 5 条
  const planA = await ensure(
    "演示-回归计划（已完成）",
    async () => {
      const list = await api("GET", P(`/plans?pageSize=100`));
      return (list.items ?? []).find((i) => i.name === "演示-回归计划（已完成）");
    },
    async () =>
      api("POST", P("/plans"), { name: "演示-回归计划（已完成）", settings: { threshold: 100 } }),
  );
  const planBDefs = [0, 6, 8]; // 冒烟 3 条
  const planB = await ensure(
    "演示-冒烟计划（进行中）",
    async () => {
      const list = await api("GET", P(`/plans?pageSize=100`));
      return (list.items ?? []).find((i) => i.name === "演示-冒烟计划（进行中）");
    },
    async () =>
      api("POST", P("/plans"), { name: "演示-冒烟计划（进行中）", settings: { threshold: 80 } }),
  );

  if (!planA.__existed) {
    await api("POST", P(`/plans/${planA.id}/cases`), {
      caseIds: planADefs.map((i) => cases[i].id),
    });
    // 执行结果回写（PLAN-001：POST /plans/{id}/cases/{refId}/exec，refId=PlanCaseRef id，
    // 详情 cases[].refId；对应功能用例 id 在 cases[].caseId）——5 条全 PASS → 计划自动 COMPLETED
    const detail = await api("GET", P(`/plans/${planA.id}`));
    for (const ref of asItems(detail.cases)) {
      const c = cases.find((x) => x.id === ref.caseId);
      const steps = (c?.def.steps ?? [{ desc: "执行", expect: "通过" }]).map(() => ({
        status: "PASS",
        result: "与预期一致",
      }));
      await api("POST", P(`/plans/${planA.id}/cases/${ref.refId}/exec`), {
        status: "PASS",
        steps,
      });
    }
    await api("POST", P(`/plans/${planA.id}/move-group`), { groupId: group.id });
  }
  if (!planB.__existed) {
    await api("POST", P(`/plans/${planB.id}/cases`), {
      caseIds: planBDefs.map((i) => cases[i].id),
    });
    const detail = await api("GET", P(`/plans/${planB.id}`));
    // 执行前 2 条（留 1 条未执行 → 计划状态 UNDERWAY 进行中）
    for (const ref of asItems(detail.cases).slice(0, 2)) {
      const c = cases.find((x) => x.id === ref.caseId);
      const steps = (c?.def.steps ?? [{ desc: "执行", expect: "通过" }]).map(() => ({
        status: "PASS",
        result: "冒烟通过",
      }));
      await api("POST", P(`/plans/${planB.id}/cases/${ref.refId}/exec`), { status: "PASS", steps });
    }
  }

  // 8. 环境 1 个（PROJ-003/s2-helpers.createEnv 形状；变量 host=mock）
  const env = await ensure(
    "演示环境",
    async () => {
      const list = await api("GET", P(`/environments`));
      return asItems(list).find((i) => i.name === "演示环境");
    },
    async () =>
      api("POST", P("/environments"), {
        name: "演示环境",
        config: {
          vars: [{ key: "host", value: MOCK, enabled: true }],
          http: [],
          hosts: [],
          database: [],
          pre: [],
          post: [],
          asserts: [],
          extracts: [],
        },
      }),
  );

  // 9. 接口定义 4 个 + 接口用例（API-002 createApiDef / API-003 createApiCase 形状）
  const apiDefs = [];
  const apiModuleId = (await ensureModule(pid, "api", "演示-接口模块")).id;
  for (const def of API_DEFS) {
    const d = await ensure(
      def.name,
      async () => {
        const list = await api(
          "GET",
          P(`/apis?keyword=${encodeURIComponent("演示-")}&pageSize=100`),
        );
        return (list.items ?? []).find((i) => i.name === def.name);
      },
      async () =>
        api("POST", P("/apis"), {
          moduleId: apiModuleId,
          name: def.name,
          request: bundle(def.method, def.path, {
            asserts: [],
            spec: {
              method: def.method,
              url: def.path,
              headers: [],
              query: (def.query ?? []).map((q) => ({
                key: q.key,
                value: q.value,
                enabled: true,
                remark: "",
              })),
              body: def.bodyJson
                ? { kind: "raw_json", content: JSON.stringify(def.bodyJson) }
                : { kind: "none" },
              auth: { kind: "none" },
              timeoutMs: 10000,
              followRedirects: false,
              skipPre: false,
              skipPost: false,
            },
          }),
          response: { status: 200, headers: [], body: def.resp },
        }),
    );
    apiDefs.push({ ...d, def });
    if (!d.__existed) {
      for (const c of def.cases) {
        await api("POST", P(`/apis/${d.id}/cases`), {
          name: c.name,
          level: "P1",
          status: "UNDERWAY",
          tags: ["演示"],
          request: bundle(def.method, def.path, { asserts: c.asserts }),
        });
      }
    }
  }

  // 10. 公共脚本 1 条（PROJ-005：POST /public-scripts → PATCH ENABLED）
  const scriptName = "演示-生成测试账号";
  const script = await ensure(
    scriptName,
    async () => {
      const list = await api("GET", P(`/public-scripts?pageSize=50`));
      return asItems(list).find((i) => i.name === scriptName);
    },
    async () =>
      api("POST", P("/public-scripts"), {
        name: scriptName,
        language: "javascript",
        tags: ["演示"],
        params: [{ name: "length", defaultValue: "8", required: true }],
        content:
          'const n = Number(getVar("param.length")||"8"); setVar("loginUser","demo"+randomInt(1000,9999)); log("账号长度="+n);',
      }),
  );
  if (!script.__existed) {
    await api("PATCH", P(`/public-scripts/${script.id}`), { status: "ENABLED" });
  }

  // 11. 场景 1 个「演示-下单主链路」+ 真实执行 2 次（API-006 saveSteps / API-008 execute）
  const scenarioName = "演示-下单主链路";
  // scene=scenario 无预置默认模块（case/api 有「未规划」根）——先建演示模块
  const scenarioModuleId = (await ensureModule(pid, "scenario", "演示-场景模块")).id;
  const scenario = await ensure(
    scenarioName,
    async () => {
      const list = await api("GET", P(`/scenarios?pageSize=100`));
      return asItems(list).find((i) => i.name === scenarioName);
    },
    async () => api("POST", P("/scenarios"), { name: scenarioName, moduleId: scenarioModuleId }),
  );
  if (!scenario.__existed) {
    const stepUid = (s) => `demo-step-${s}`;
    const customStep = (name, method, url, bodyJson, asserts) => ({
      uid: stepUid(name),
      stepType: "custom",
      name,
      enabled: true,
      config: {
        bundle: {
          request: {
            method,
            url,
            headers: [],
            query: [],
            body: bodyJson
              ? { kind: "raw_json", content: JSON.stringify(bodyJson) }
              : { kind: "none" },
            auth: { kind: "none" },
          },
          asserts,
          pre: [],
          post: [],
          extracts: [],
        },
      },
      children: [],
    });
    const pass = [
      customStep("查询商品列表", "GET", "${host}/hello", null, [
        assert("status_code", "", "eq", "200"),
        assert("body_jsonpath", "$.status", "eq", "UP"),
      ]),
      customStep("提交订单", "POST", "${host}/perf/echo", { skuId: "SKU-001", quantity: 2 }, [
        assert("status_code", "", "eq", "200"),
      ]),
    ];
    // 第 1 次执行：2 步全过 → SUCCESS
    let detail = await api("GET", P(`/scenarios/${scenario.id}`));
    await api("PUT", P(`/scenarios/${scenario.id}/steps`), {
      version: detail.version,
      steps: pass,
    });
    let exec = await api("POST", P("/scenarios/execute"), {
      scenarioIds: [scenario.id],
      mode: "serial",
      stopOnFail: false,
      envId: env.id,
    });
    createdTasks.push({ kind: "scenario", name: `${scenarioName}#1`, taskId: exec.taskId });
    const rep1 = await pollReport(P, exec.taskId, 60_000);
    log(
      `场景执行#1：task=${exec.taskId.slice(0, 8)}… ${rep1.status}（total=${rep1.summary?.total} passed=${rep1.summary?.passed}）`,
    );

    // 第 2 次执行：3 步留 1 条失败断言（教学演示报告的未通过项）→ FAILED/部分失败
    const withFail = [
      ...pass,
      customStep(
        "领取优惠券（断言失败演示）",
        "POST",
        "${host}/perf/echo",
        { couponCode: "NEW10" },
        [assert("body_jsonpath", "$.body.couponCode", "eq", "USED")],
      ),
    ];
    detail = await api("GET", P(`/scenarios/${scenario.id}`));
    await api("PUT", P(`/scenarios/${scenario.id}/steps`), {
      version: detail.version,
      steps: withFail,
    });
    exec = await api("POST", P("/scenarios/execute"), {
      scenarioIds: [scenario.id],
      mode: "serial",
      stopOnFail: false,
      envId: env.id,
    });
    createdTasks.push({ kind: "scenario", name: `${scenarioName}#2`, taskId: exec.taskId });
    const rep2 = await pollReport(P, exec.taskId, 60_000);
    log(
      `场景执行#2：task=${exec.taskId.slice(0, 8)}… ${rep2.status}（total=${rep2.summary?.total} passed=${rep2.summary?.passed} failed=${rep2.summary?.failed}）`,
    );
  }

  // 12. UI 元素 3 + 步骤用例 1 + 脚本用例 1，各跑 1 次（UIT-003/004）
  const elements = {};
  for (const def of ELEMENT_DEFS) {
    const e = await ensure(
      def.name,
      async () => {
        const list = await api("GET", P(`/ui-elements?pageSize=100`));
        return asItems(list).find((i) => i.name === def.name);
      },
      async () => api("POST", P("/ui-elements"), def),
    );
    elements[def.name] = e;
  }

  const stepCaseName = "演示-登录表单提交（步骤）";
  const stepCase = await ensure(
    stepCaseName,
    async () => {
      const list = await api("GET", P(`/ui-cases?pageSize=100`));
      return asItems(list).find((i) => i.name === stepCaseName);
    },
    async () =>
      api("POST", P("/ui-cases"), {
        name: stepCaseName,
        steps: [
          { op: "goto", url: `${MOCK}/uit/demo` },
          { op: "fill", elementId: elements["演示-用户名输入框"].id, value: "demo-user" },
          { op: "click", elementId: elements["演示-提交按钮"].id },
          { op: "assert-text", elementId: elements["演示-结果文案"].id, expected: "提交成功" },
        ],
      }),
  );
  if (!stepCase.__existed) {
    const run = await api("POST", P(`/ui-cases/${stepCase.id}/run`));
    createdTasks.push({ kind: "ui", name: stepCaseName, taskId: run.taskId });
    const t = await pollUiTask(P, run.taskId, 180_000);
    log(`UI 步骤用例执行：task=${run.taskId.slice(0, 8)}… ${t.status}`);
  }

  const scriptCaseName = "演示-登录表单提交（脚本）";
  const scriptCase = await ensure(
    scriptCaseName,
    async () => {
      const list = await api("GET", P(`/ui-cases?pageSize=100`));
      return asItems(list).find((i) => i.name === scriptCaseName);
    },
    async () =>
      api("POST", P("/ui-cases"), {
        name: scriptCaseName,
        mode: "script",
        steps: [],
        script: okScript(),
        params: [],
        timeoutMs: 60_000,
      }),
  );
  if (!scriptCase.__existed) {
    const run = await api("POST", P(`/ui-cases/${scriptCase.id}/run`));
    createdTasks.push({ kind: "ui", name: scriptCaseName, taskId: run.taskId });
    const t = await pollUiTask(P, run.taskId, 180_000);
    log(`UI 脚本用例执行：task=${run.taskId.slice(0, 8)}… ${t.status}`);
  }

  // 13. 趋势美化（可选加分）：createdAt 分散到过去 14 天
  let backfilled = 0;
  if (prismaOk) {
    backfilled = await backfillCreatedAt(prisma, pid, createdTasks);
    log(`createdAt 回填完成：${backfilled} 行分散到过去 14 天`);
  } else {
    warn("prisma/PG 不可用，跳过趋势回填（不算失败）");
  }

  // 14. 验收核对：逐类 GET 列表计数
  stopReaper();
  await verifyCounts(P, pid, createdTasks);

  log("全部完成 ✓");
}

// ───────────────────────── 轮询 ─────────────────────────
/**
 * 兼容 5xx：dev 模式下 Next 首编译会膨胀 Prisma 连接数（多模块实例各持连接池），
 * 高峰请求可能瞬时报 500（连接池耗尽）——轮询按「忽略单次失败、超时为准」处理，
 * 且终态兜底改查 /exec-tasks 列表里的行状态，避免把栈轮挂死。
 */
async function pollWith(listStatusFn, timeoutMs, intervalMs) {
  const deadline = Date.now() + timeoutMs;
  let lastErr = null;
  for (;;) {
    try {
      const st = await listStatusFn();
      if (st && !["PENDING", "RUNNING"].includes(st)) return st;
      lastErr = null;
    } catch (err) {
      lastErr = err;
    }
    if (Date.now() > deadline) {
      throw new Error(`任务轮询超时（last=${lastErr ? lastErr.message : "still running"}）`);
    }
    await sleep(intervalMs);
  }
}

async function pollReport(P, taskId, timeoutMs) {
  const st = await pollWith(
    async () => {
      const d = await api("GET", P(`/reports/${taskId}`));
      return d.status;
    },
    timeoutMs,
    800,
  );
  const d = await api("GET", P(`/reports/${taskId}`));
  return { ...d, status: st };
}

async function pollUiTask(P, taskId, timeoutMs) {
  const st = await pollWith(
    async () => {
      const d = await api("GET", P(`/ui-tasks/${taskId}`));
      return d.status;
    },
    timeoutMs,
    1500,
  );
  const d = await api("GET", P(`/ui-tasks/${taskId}`));
  return { ...d, status: st };
}

// ───────────────────────── --reset：直连 DB 硬删演示数据 ─────────────────────────
async function resetDemoData(prisma, pid) {
  const demoScenarioIds = (
    await prisma.scenario.findMany({
      where: { projectId: pid, name: { startsWith: `${PREFIX}` } },
      select: { id: true },
    })
  ).map((s) => s.id);
  const demoUiCaseIds = (
    await prisma.uiTestCase.findMany({
      where: { projectId: pid, name: { startsWith: `${PREFIX}` } },
      select: { id: true },
    })
  ).map((s) => s.id);
  const demoPlanIds = (
    await prisma.testPlan.findMany({
      where: { projectId: pid, name: { startsWith: `${PREFIX}` } },
      select: { id: true },
    })
  ).map((s) => s.id);

  // 执行任务（scenario 按 payload.scenarioIds 命中；ui 按 refId；plan 占位任务按 refId）
  const scenarioTasks = await prisma.execTask.findMany({
    where: { projectId: pid, type: "scenario" },
    select: { id: true, payload: true },
  });
  const taskIds = scenarioTasks
    .filter((t) => {
      const ids = t.payload?.scenarioIds ?? [];
      return Array.isArray(ids) && ids.some((i) => demoScenarioIds.includes(i));
    })
    .map((t) => t.id);
  taskIds.push(
    ...(
      await prisma.execTask.findMany({
        where: { projectId: pid, refType: "ui_test_case", refId: { in: demoUiCaseIds } },
        select: { id: true },
      })
    ).map((t) => t.id),
    ...(
      await prisma.execTask.findMany({
        where: { projectId: pid, type: "plan", refId: { in: demoPlanIds } },
        select: { id: true },
      })
    ).map((t) => t.id),
  );

  let deleted = 0;
  const del = async (n, r) => {
    const d = await r;
    deleted += d.count;
    return d.count;
  };

  // FK 安全序：报告/执行域子表先删（report_shares/false_alarm_hits → reports →
  // exec_step_results → exec_items → exec_tasks）
  await del(
    "report_shares",
    prisma.reportShare.deleteMany({ where: { report: { taskId: { in: taskIds } } } }),
  );
  await del(
    "false_alarm_hits",
    prisma.falseAlarmHit.deleteMany({ where: { taskId: { in: taskIds } } }),
  );
  await del("reports", prisma.report.deleteMany({ where: { taskId: { in: taskIds } } }));
  await del(
    "exec_step_results",
    prisma.execStepResult.deleteMany({ where: { item: { taskId: { in: taskIds } } } }),
  );
  await del("exec_items", prisma.execItem.deleteMany({ where: { taskId: { in: taskIds } } }));
  await del("exec_tasks", prisma.execTask.deleteMany({ where: { id: { in: taskIds } } }));
  const demoReviewIds = (
    await prisma.caseReview.findMany({
      where: { projectId: pid, name: { startsWith: `${PREFIX}` } },
      select: { id: true },
    })
  ).map((r) => r.id);
  await del(
    "review_cases",
    prisma.reviewCase.deleteMany({ where: { reviewId: { in: demoReviewIds } } }),
  );
  await del("case_reviews", prisma.caseReview.deleteMany({ where: { id: { in: demoReviewIds } } }));
  await del(
    "plan_case_refs",
    prisma.planCaseRef.deleteMany({ where: { planId: { in: demoPlanIds } } }),
  );
  await del("test_plans", prisma.testPlan.deleteMany({ where: { id: { in: demoPlanIds } } }));
  const demoBugIds = (
    await prisma.bug.findMany({
      where: { projectId: pid, title: { startsWith: `${PREFIX}` } },
      select: { id: true },
    })
  ).map((b) => b.id);
  await del(
    "bug_case_refs",
    prisma.bugCaseRef.deleteMany({ where: { bugId: { in: demoBugIds } } }),
  );
  await del("bugs", prisma.bug.deleteMany({ where: { id: { in: demoBugIds } } }));
  const demoApiIds = (
    await prisma.apiDefinition.findMany({
      where: { projectId: pid, name: { startsWith: `${PREFIX}` } },
      select: { id: true },
    })
  ).map((a) => a.id);
  await del("api_cases", prisma.apiCase.deleteMany({ where: { apiId: { in: demoApiIds } } }));
  await del(
    "api_definitions",
    prisma.apiDefinition.deleteMany({ where: { id: { in: demoApiIds } } }),
  );
  await del(
    "functional_cases",
    prisma.functionalCase.deleteMany({
      where: { projectId: pid, name: { startsWith: `${PREFIX}` } },
    }),
  );
  await del(
    "environments",
    prisma.environment.deleteMany({
      where: { projectId: pid, name: { startsWith: `${PREFIX}` } },
    }),
  );
  await del(
    "scenario_steps",
    prisma.scenarioStep.deleteMany({ where: { scenarioId: { in: demoScenarioIds } } }),
  );
  await del("scenarios", prisma.scenario.deleteMany({ where: { id: { in: demoScenarioIds } } }));
  // module_nodes 最后删（functional_cases/api_definitions/scenarios 的 moduleId FK 均先清）
  await del(
    "module_nodes",
    prisma.moduleNode.deleteMany({
      where: { projectId: pid, name: { startsWith: `${PREFIX}` } },
    }),
  );
  await del(
    "public_scripts",
    prisma.publicScript.deleteMany({
      where: { projectId: pid, name: { startsWith: `${PREFIX}` } },
    }),
  );
  await del(
    "ui_test_cases",
    prisma.uiTestCase.deleteMany({ where: { id: { in: demoUiCaseIds } } }),
  );
  await del(
    "ui_elements",
    prisma.uiElement.deleteMany({
      where: { projectId: pid, name: { startsWith: `${PREFIX}` } },
    }),
  );
  log(`--reset 完成：共清理 ${deleted} 行演示数据`);
}

// ───────────────────────── createdAt 回填（趋势美化）─────────────────────────
function hashDaysAgo(key, maxDays = 14) {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  const day = h % maxDays;
  const hour = h % 24;
  const min = (h >> 3) % 60;
  const d = new Date(Date.now() - day * 86_400_000 - hour * 3_600_000 - min * 60_000);
  return d;
}

async function backfillCreatedAt(prisma, pid, tasks) {
  let n = 0;
  const touch = async (rows, fn) => {
    for (const r of rows) {
      await fn(r);
      n += 1;
    }
  };
  const cases = await prisma.functionalCase.findMany({
    where: { projectId: pid, name: { startsWith: `${PREFIX}` } },
    select: { id: true, name: true },
  });
  await touch(cases, (r) =>
    prisma.functionalCase.update({ where: { id: r.id }, data: { createdAt: hashDaysAgo(r.name) } }),
  );
  const bugs = await prisma.bug.findMany({
    where: { projectId: pid, title: { startsWith: `${PREFIX}` } },
    select: { id: true, title: true },
  });
  await touch(bugs, (r) =>
    prisma.bug.update({ where: { id: r.id }, data: { createdAt: hashDaysAgo(r.title) } }),
  );
  const reviews = await prisma.caseReview.findMany({
    where: { projectId: pid, name: { startsWith: `${PREFIX}` } },
    select: { id: true, name: true },
  });
  await touch(reviews, (r) =>
    prisma.caseReview.update({ where: { id: r.id }, data: { createdAt: hashDaysAgo(r.name) } }),
  );
  const plans = await prisma.testPlan.findMany({
    where: { projectId: pid, name: { startsWith: `${PREFIX}` } },
    select: { id: true, name: true },
  });
  await touch(plans, (r) =>
    prisma.testPlan.update({ where: { id: r.id }, data: { createdAt: hashDaysAgo(r.name) } }),
  );
  const apis = await prisma.apiDefinition.findMany({
    where: { projectId: pid, name: { startsWith: `${PREFIX}` } },
    select: { id: true, name: true },
  });
  await touch(apis, (r) =>
    prisma.apiDefinition.update({ where: { id: r.id }, data: { createdAt: hashDaysAgo(r.name) } }),
  );
  const apiCases = await prisma.apiCase.findMany({
    where: { projectId: pid, name: { startsWith: `${PREFIX}` } },
    select: { id: true, name: true },
  });
  await touch(apiCases, (r) =>
    prisma.apiCase.update({ where: { id: r.id }, data: { createdAt: hashDaysAgo(r.name) } }),
  );
  const envs = await prisma.environment.findMany({
    where: { projectId: pid, name: { startsWith: `${PREFIX}` } },
    select: { id: true, name: true },
  });
  await touch(envs, (r) =>
    prisma.environment.update({ where: { id: r.id }, data: { createdAt: hashDaysAgo(r.name) } }),
  );
  const scenarios = await prisma.scenario.findMany({
    where: { projectId: pid, name: { startsWith: `${PREFIX}` } },
    select: { id: true, name: true },
  });
  await touch(scenarios, (r) =>
    prisma.scenario.update({ where: { id: r.id }, data: { createdAt: hashDaysAgo(r.name) } }),
  );
  const scripts = await prisma.publicScript.findMany({
    where: { projectId: pid, name: { startsWith: `${PREFIX}` } },
    select: { id: true, name: true },
  });
  await touch(scripts, (r) =>
    prisma.publicScript.update({ where: { id: r.id }, data: { createdAt: hashDaysAgo(r.name) } }),
  );
  const uiElements = await prisma.uiElement.findMany({
    where: { projectId: pid, name: { startsWith: `${PREFIX}` } },
    select: { id: true, name: true },
  });
  await touch(uiElements, (r) =>
    prisma.uiElement.update({ where: { id: r.id }, data: { createdAt: hashDaysAgo(r.name) } }),
  );
  const uiCases = await prisma.uiTestCase.findMany({
    where: { projectId: pid, name: { startsWith: `${PREFIX}` } },
    select: { id: true, name: true },
  });
  await touch(uiCases, (r) =>
    prisma.uiTestCase.update({ where: { id: r.id }, data: { createdAt: hashDaysAgo(r.name) } }),
  );
  // 执行任务与报告（执行趋势图数据源）：本轮真实产生的任务按序分散
  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    const d = new Date(Date.now() - (2 + i * 3) * 86_400_000 - i * 3_600_000); // 2/5/8/11 天前
    await prisma.execTask.update({ where: { id: t.taskId }, data: { createdAt: d } });
    await prisma.report.updateMany({ where: { taskId: t.taskId }, data: { createdAt: d } });
    n += 2;
  }
  return n;
}

// ───────────────────────── 验收核对 ─────────────────────────
async function verifyCounts(P, pid, tasks) {
  const results = [];
  const check = (label, actual, expected) => {
    results.push({ label, actual, expected, pass: actual === expected });
  };

  const caseList = await api("GET", P(`/cases?keyword=${encodeURIComponent(PREFIX)}&pageSize=100`));
  check(
    "功能用例",
    (caseList.items ?? []).filter((i) => i.name.startsWith(`${PREFIX}-`)).length,
    10,
  );

  const bugList = await api("GET", P(`/bugs?pageSize=200`));
  check("缺陷", (bugList.items ?? []).filter((i) => i.title.startsWith(`${PREFIX}-`)).length, 6);

  const reviewList = await api("GET", P(`/reviews?pageSize=50`));
  const demoReviews = (reviewList.items ?? []).filter((i) => i.name.startsWith(`${PREFIX}-`));
  check("用例评审", demoReviews.length, 1);
  for (const r of demoReviews) log(`  评审「${r.name}」状态：${r.status ?? "?"}`);

  const planList = await api("GET", P(`/plans?pageSize=100`));
  // /plans 列表混入计划组行（type 未透出）——按名称排除「…计划组」
  const demoPlans = asItems(planList).filter(
    (i) => i.name.startsWith(`${PREFIX}-`) && !i.name.endsWith("计划组"),
  );
  check("测试计划", demoPlans.length, 2);
  for (const p of demoPlans) log(`  计划「${p.name}」状态：${p.status ?? "?"}`);

  const groupList = await api("GET", P(`/plan-groups?pageSize=50`));
  check("计划分组", asItems(groupList).filter((i) => i.name.startsWith(`${PREFIX}`)).length, 1);

  const apiList = await api("GET", P(`/apis?keyword=${encodeURIComponent(PREFIX)}&pageSize=100`));
  const demoApis = (apiList.items ?? []).filter((i) => i.name.startsWith(`${PREFIX}-`));
  check("接口定义", demoApis.length, 4);
  let apiCaseCount = 0;
  for (const d of demoApis) {
    const cl = await api("GET", P(`/apis/${d.id}/cases?pageSize=50`));
    apiCaseCount += (cl.items ?? []).filter((i) => i.name.startsWith(`${PREFIX}-`)).length;
  }
  log(`  接口用例共 ${apiCaseCount} 条（每个定义 1~2 条）`);

  const envList = await api("GET", P(`/environments`));
  check("环境", asItems(envList).filter((i) => i.name.startsWith(`${PREFIX}`)).length, 1);

  const scenarioList = await api("GET", P(`/scenarios?pageSize=100`));
  check("场景", asItems(scenarioList).filter((i) => i.name.startsWith(`${PREFIX}-`)).length, 1);

  const uiCaseList = await api("GET", P(`/ui-cases?pageSize=100`));
  check("UI 用例", asItems(uiCaseList).filter((i) => i.name.startsWith(`${PREFIX}-`)).length, 2);

  const elementList = await api("GET", P(`/ui-elements?pageSize=100`));
  check("UI 元素", asItems(elementList).filter((i) => i.name.startsWith(`${PREFIX}-`)).length, 3);

  const scriptList = await api("GET", P(`/public-scripts?pageSize=50`));
  check("公共脚本", asItems(scriptList).filter((i) => i.name.startsWith(`${PREFIX}-`)).length, 1);

  const execTasks = await api("GET", P(`/exec-tasks?page=1&pageSize=100`));
  const demoTaskRows = asItems(execTasks).filter((t) => tasks.some((x) => x.taskId === t.id));
  if (tasks.length > 0) {
    check("执行任务（本轮真实产生）", demoTaskRows.length, tasks.length);
  } else {
    log("  （幂等重跑：本轮未新建执行任务，沿用既有任务）");
  }
  for (const t of demoTaskRows) {
    log(`  任务 ${t.id.slice(0, 8)}… type=${t.type} status=${t.status}`);
  }
  log(`  exec-tasks 列表总数（含历史）：${execTasks.total ?? asItems(execTasks).length}`);

  // 报告通过率（喂工作台）——单条 5xx 不至于让整轮造数失败
  for (const t of tasks) {
    try {
      if (t.kind === "scenario") {
        const rep = await api("GET", P(`/reports/${t.taskId}`));
        log(
          `  场景报告 ${t.taskId.slice(0, 8)}…：${rep.status}，通过率 ${rep.summary?.passed ?? 0}/${rep.summary?.total ?? 0}`,
        );
      } else {
        const ut = await api("GET", P(`/ui-tasks/${t.taskId}`));
        log(`  UI 报告 ${t.taskId.slice(0, 8)}…：${ut.status}`);
      }
    } catch (err) {
      warn(`报告读取失败 ${t.name}：${err.message?.slice(0, 120)}`);
    }
  }

  log("── 验收计数 ──");
  let failed = false;
  for (const r of results) {
    const mark = r.pass ? "✓" : "✗";
    if (!r.pass) failed = true;
    log(`  ${mark} ${r.label}：${r.actual}（期望 ${r.expected}）`);
  }
  if (failed) throw new Error("验收计数不符，见上方 ✗ 行");
}

main()
  .catch((err) => {
    console.error("[prep:fatal]", err.message ?? err);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (prisma) await prisma.$disconnect().catch(() => {});
  });

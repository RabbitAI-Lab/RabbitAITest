/** S9 单测（ENTP-002/003）：state 生命周期 / OIDC·CAS 换身份（safeFetch stub）/ find-or-create 三分支 / LDAP fake 矩阵。 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { DomainError } from "@rabbit/shared";

// redis mock（state 存储）
vi.mock("@/server/redis", () => {
  const store = new Map<string, string>();
  return {
    redis: () => ({
      set: vi.fn(async (k: string, v: string) => {
        store.set(k, v);
      }),
      get: vi.fn(async (k: string) => store.get(k) ?? null),
      del: vi.fn(async (k: string) => {
        store.delete(k);
      }),
    }),
    __stateStore: store,
  };
});

// safeFetch stub（按 URL 匹配路由响应；__addRoute 追加、__resetRoutes 清空）
vi.mock("@/server/safe-fetch", () => ({
  // v0.7.1 根治形态：outboundDispatcher 工厂（单测哑实例；真实出站拦截走全局 fetch stub）
  outboundDispatcher: () => ({}),
}));

// 全局 fetch stub：按 URL 路由响应（替代原 safeFetch mock 的路由职责）
const routes: { match: (url: string, init?: RequestInit) => boolean; respond: () => Response }[] =
  [];
vi.stubGlobal(
  "fetch",
  vi.fn(async (url: string | URL, init: RequestInit = {}) => {
    const u = String(url);
    const route = routes.find((r) => r.match(u, init));
    if (route) return route.respond();
    return new Response("{}", { status: 404 });
  }),
);

// param.service：callbackUrl 用 siteUrl —— stub
vi.mock("@/server/domains/system/param.service", () => ({
  siteUrl: async () => "http://web.test",
  encryptSecret: (v: string) => `enc:${v}`,
  decryptSecret: (v: string) => (v.startsWith("enc:") ? v.slice(4) : null),
  publicTheme: async () => ({}),
}));

// auth.service：hashPassword stub（避免 argon2 开销）
vi.mock("@/server/domains/system/auth.service", () => ({
  hashPassword: async (p: string) => `hash(${p})`,
}));

vi.mock("@rabbit/db", () => {
  const state: Record<string, unknown> = {};
  const prisma = {
    __setState: (k: string, v: unknown) => {
      state[k] = v;
    },
    __state: state,
    user: {
      findFirst: vi.fn(
        async ({ where }: { where: { email: string } }) => state[`user:${where.email}`] ?? null,
      ),
      create: vi.fn(async ({ data }: { data: { email: string; name: string } }) => ({
        id: `new-${data.email}`,
        email: data.email,
        name: data.name,
      })),
      update: vi.fn(async () => ({})),
    },
  };
  return { prisma, __state: state };
});

import {
  issueState,
  consumeState,
  exchangeOidc,
  exchangeCas,
  findOrCreateSsoUser,
} from "../sso-flow.service";
import { setLdapAdapter, ldapAuthenticate, type LdapAdapter } from "../ldap-client";
// 路由辅助（全局 fetch stub 挂载，见上方 stubGlobal）
const addRoute = (match: (url: string, init?: RequestInit) => boolean, respond: () => Response) => {
  routes.push({ match, respond });
};
const __resetRoutes = () => {
  routes.length = 0;
};

beforeEach(() => {
  __resetRoutes();
});

beforeEach(async () => {
  const store = (
    (await import("@/server/redis")) as unknown as { __stateStore: Map<string, string> }
  ).__stateStore;
  store.clear();
  const prisma = (await import("@rabbit/db")) as unknown as { __state: Record<string, unknown> };
  for (const k of Object.keys(prisma.__state)) delete prisma.__state[k];
});

describe("state 生命周期（Redis 5 分钟）", () => {
  it("issue → consume 命中并删除（一次性）", async () => {
    const st = await issueState("auth-1");
    expect(await consumeState(st)).toBe("auth-1");
    await expect(consumeState(st)).rejects.toMatchObject({ code: 90012 });
  });
  it("缺失 state → 90012", async () => {
    await expect(consumeState(null)).rejects.toMatchObject({ code: 90012 });
  });
});

describe("exchangeOidc（mock IdP 形态）", () => {
  const src = {
    id: "a1",
    type: "OIDC",
    name: "n",
    enabled: true,
    config: {
      tokenEndpoint: "http://idp.test/token",
      userinfoEndpoint: "http://idp.test/userinfo",
      clientId: "cid",
      clientSecret: "sec",
      propMapping: { username: "preferred_username", name: "name", email: "email" },
    },
  } as Parameters<typeof exchangeOidc>[0];

  it("token+userinfo 成功 → 属性映射", async () => {
    addRoute(
      (u: string) => u.includes("/token"),
      () => new Response(JSON.stringify({ access_token: "tk" }), { status: 200 }),
    );
    addRoute(
      (u: string) => u.includes("/userinfo"),
      () =>
        new Response(JSON.stringify({ preferred_username: "u1", name: "张三", email: "u1@t.cn" }), {
          status: 200,
        }),
    );
    const id = await exchangeOidc(src, "code-1", "http://web.test");
    expect(id).toEqual({ providerUserId: "u1", name: "张三", email: "u1@t.cn" });
  });

  it("token 端点 500 → 90013", async () => {
    addRoute(
      (u: string) => u.includes("/token"),
      () => new Response("err", { status: 500 }),
    );
    await expect(exchangeOidc(src, "code-1", "http://web.test")).rejects.toMatchObject({
      code: 90013,
    });
  });

  it("userinfo 缺映射值 → 90014", async () => {
    addRoute(
      (u: string) => u.includes("/token"),
      () => new Response(JSON.stringify({ access_token: "tk" }), { status: 200 }),
    );
    addRoute(
      (u: string) => u.includes("/userinfo"),
      () => new Response(JSON.stringify({ unrelated: 1 }), { status: 200 }),
    );
    await expect(exchangeOidc(src, "code-1", "http://web.test")).rejects.toMatchObject({
      code: 90014,
    });
  });
});

describe("exchangeCas（XML 解析）", () => {
  const src = {
    id: "a2",
    type: "CAS",
    name: "n",
    enabled: true,
    config: {
      serverUrl: "http://cas.test",
      propMapping: { username: "username", name: "name", email: "email" },
    },
  } as Parameters<typeof exchangeCas>[0];
  it("成功 XML → 映射", async () => {
    addRoute(
      (u: string) => u.includes("serviceValidate"),
      () =>
        new Response(
          `<cas:serviceResponse><cas:authenticationSuccess><cas:user>cas-u</cas:user><cas:attributes><cas:name>王五</cas:name><cas:email>cas@t.cn</cas:email></cas:attributes></cas:authenticationSuccess></cas:serviceResponse>`,
          { status: 200 },
        ),
    );
    const id = await exchangeCas(src, "ticket-1", "http://web.test/cb");
    expect(id.providerUserId).toBe("cas-u");
    expect(id.email).toBe("cas@t.cn");
  });
  it("authenticationFailure → 90013", async () => {
    addRoute(
      (u: string) => u.includes("serviceValidate"),
      () =>
        new Response(
          `<cas:serviceResponse><cas:authenticationFailure code="INVALID_TICKET">bad</cas:authenticationFailure></cas:serviceResponse>`,
          { status: 200 },
        ),
    );
    await expect(exchangeCas(src, "bad", "http://web.test/cb")).rejects.toMatchObject({
      code: 90013,
    });
  });
});

describe("findOrCreateSsoUser 三分支", () => {
  it("不存在 → 创建（source=SSO 类型）", async () => {
    const r = await findOrCreateSsoUser(
      { providerUserId: "x1", name: "N", email: "x1@t.cn" },
      "OIDC",
    );
    expect(r.userId).toBe("new-x1@t.cn");
  });
  it("LOCAL 既有账号 → 绑定（复用）", async () => {
    const prisma = (await import("@rabbit/db")) as unknown as { __state: Record<string, unknown> };
    prisma.__state["user:local@t.cn"] = { id: "uid-1", email: "local@t.cn", source: "LOCAL" };
    const r = await findOrCreateSsoUser(
      { providerUserId: "l", name: "L", email: "local@t.cn" },
      "OIDC",
    );
    expect(r.userId).toBe("uid-1");
  });
  it("其他 SSO 类型绑定 → 409 90016", async () => {
    const prisma = (await import("@rabbit/db")) as unknown as { __state: Record<string, unknown> };
    prisma.__state["user:s@t.cn"] = { id: "uid-2", email: "s@t.cn", source: "DINGTALK" };
    await expect(
      findOrCreateSsoUser({ providerUserId: "s", email: "s@t.cn" }, "OIDC"),
    ).rejects.toMatchObject({ code: 90016 });
  });
  it("无 email → 合成 @sso.scan 幂等账号", async () => {
    const r = await findOrCreateSsoUser({ providerUserId: "open-123" }, "FEISHU");
    expect(r.email).toBe("open-123@sso.scan");
  });
});

describe("LDAP adapter（注入式 fake）", () => {
  const cfg = {
    host: "h",
    port: 389,
    bindDn: "dn",
    bindPassword: "p",
    userOu: "ou",
    filterKey: "uid",
    propMapping: { username: "uid", name: "cn", email: "mail" },
  };

  function fakeAdapter(over: Partial<LdapAdapter> = {}): LdapAdapter {
    return {
      bindAndSearch: async (c) =>
        c.username === "zhang"
          ? [
              {
                dn: `uid=zhang,${c.userOu}`,
                attrs: { uid: "zhang", cn: "张三", mail: "zhang@corp.cn" },
              },
            ]
          : [],
      bindAsUser: async () => true,
      ...over,
    };
  }

  it("全链成功 → 映射", async () => {
    setLdapAdapter(fakeAdapter());
    const r = await ldapAuthenticate(cfg, "zhang", "pw");
    expect(r).toEqual({ username: "zhang", name: "张三", email: "zhang@corp.cn" });
  });
  it("搜索空 → null", async () => {
    setLdapAdapter(fakeAdapter());
    expect(await ldapAuthenticate(cfg, "nobody", "pw")).toBeNull();
  });
  it("二次 bind 密码错 → null", async () => {
    setLdapAdapter(fakeAdapter({ bindAsUser: async () => false }));
    expect(await ldapAuthenticate(cfg, "zhang", "bad")).toBeNull();
  });
});

void DomainError;

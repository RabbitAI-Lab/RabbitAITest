/** S9 单测（ENTP-005）：dispatch 模板渲染挂钩（模板→渲染/无模板→defaults 回退 S5 零回归）+ 模板服务。 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { DomainError, ErrCode , setFeatureGateEnabled } from "@rabbit/shared";

// prisma mock：appSetting/robot/notification/user + messageTemplate + license
vi.mock("@rabbit/db", () => {
  const state: Record<string, unknown> = {};
  const prisma = {
    __setState: (k: string, v: unknown) => {
      state[k] = v;
    },
    __state: state,
    appSetting: {
      findUnique: vi.fn(
        async ({ where }: { where: { projectId_key: { projectId: string; key: string } } }) => {
          const v = state[`${where.projectId_key.projectId}:${where.projectId_key.key}`];
          return v === undefined ? null : { value: v };
        },
      ),
      upsert: vi.fn(async () => ({})),
    },
    robot: {
      findMany: vi.fn(
        async ({
          where,
        }: {
          where: { id?: { in: string[] }; projectId?: string; enabled?: boolean };
        }) =>
          (
            (state.robots as
              | {
                  id: string;
                  projectId: string;
                  channel: string;
                  enabled: boolean;
                  webhook: string | null;
                }[]
              | undefined) ?? []
          ).filter(
            (r) =>
              (!where.id || where.id.in.includes(r.id)) &&
              (!where.projectId || r.projectId === where.projectId),
          ),
      ),
    },
    notification: {
      createMany: vi.fn(
        async ({ data }: { data: { userId: string; title: string; content: string }[] }) => {
          state.created = [...((state.created as unknown[]) ?? []), ...data];
          return { count: data.length };
        },
      ),
    },
    user: {
      findMany: vi.fn(async () => []),
    },
    messageTemplate: {
      findUnique: vi.fn(async () => (state.template as object | undefined) ?? null),
      findMany: vi.fn(async () => (state.templates as object[] | undefined) ?? []),
      upsert: vi.fn(
        async ({ data }: { data: { event: string; title: string; content: string } }) => {
          state.saved = data;
          return data;
        },
      ),
      deleteMany: vi.fn(async () => ({ count: 1 })),
    },
    license: {
      findFirst: vi.fn(async () => state.license ?? null),
      update: vi.fn(async () => ({})),
    },
  };
  return { prisma };
});

import { prisma } from "@rabbit/db";
import { dispatch } from "../../message/notify.service";
import { upsertTemplate, listTemplates, previewTemplate } from "../../message/template.service";

const P = "99999999-9999-9999-9999-999999999999";
const ACTOR = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const RECEIVER = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

const __setState = (k: string, v: unknown) =>
  (prisma as unknown as { __setState: (k: string, v: unknown) => void }).__setState(k, v);

beforeEach(() => {
  __setState("created", []);
  __setState("template", null);
  __setState("license", null);
  // 事件配置：BUG_CREATED 开 + inapp 机器人 + 接收人
  __setState(`${P}:message.events`, {
    BUG_CREATED: {
      enabled: true,
      robotIds: ["cccccccc-cccc-cccc-cccc-cccccccccccc"],
      receiverUserIds: [RECEIVER],
    },
  });
  __setState("robots", [
    {
      id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
      projectId: P,
      channel: "inapp",
      enabled: true,
      webhook: null,
    },
  ]);
});

const licensePayload = (features?: string[]) => ({
  lic: "RAB-TEST",
  edition: "ENTERPRISE",
  issuedAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  ...(features ? { features } : {}),
});

describe("dispatch 模板渲染挂钩（ENTP-005 §2）", () => {
  it("模板存在 + License MSG_TEMPLATE 有效 → 按模板渲染", async () => {
    __setState("license", { status: "VALID", payload: licensePayload() });
    __setState("template", {
      title: "[${project}] ${actorName} 提交了缺陷 ${title}",
      content: "时间 ${time}",
    });
    await dispatch({
      projectId: P,
      event: "BUG_CREATED",
      vars: { project: "演示项目", actorName: "张三", time: "T1", title: "支付 500" },
      defaults: { title: "[缺陷] 支付 500 新建", content: "操作人：张三" },
      actorId: ACTOR,
    });
    const created = (prisma as unknown as { __state: Record<string, unknown> }).__state.created as {
      title: string;
      content: string;
    }[];
    expect(created).toHaveLength(1);
    expect(created[0]!.title).toBe("[演示项目] 张三 提交了缺陷 支付 500");
    expect(created[0]!.content).toBe("时间 T1");
  });

  it("无模板 → 回退 defaults（S5 固定文案零回归）", async () => {
    __setState("license", { status: "VALID", payload: licensePayload() });
    await dispatch({
      projectId: P,
      event: "BUG_CREATED",
      vars: { project: "P", actorName: "张三" },
      defaults: { title: "[缺陷] 支付 500 新建", content: "操作人：张三\n时间：T" },
      actorId: ACTOR,
    });
    const created = (prisma as unknown as { __state: Record<string, unknown> }).__state.created as {
      title: string;
    }[];
    expect(created).toHaveLength(1);
    expect(created[0]!.title).toBe("[缺陷] 支付 500 新建");
  });

  it("模板存在但 License 未含 MSG_TEMPLATE：开源态用模板（ENTP-009）；门控恢复态回退 defaults", async () => {
    __setState("license", { status: "VALID", payload: licensePayload(["MULTI_ORG"]) }); // 未含 MSG_TEMPLATE
    __setState("template", { title: "TPL", content: "TPL" });
    const created = () =>
      (prisma as unknown as { __state: Record<string, unknown> }).__state.created as {
        title: string;
      }[];
    // 开源全功能（默认）：License 未含特性不拦截，自定义模板生效
    await dispatch({
      projectId: P,
      event: "BUG_CREATED",
      vars: { a: 1 },
      defaults: { title: "DEFAULT", content: "DEFAULT" },
      actorId: ACTOR,
    });
    expect(created()).toHaveLength(1);
    expect(created()[0]!.title).toBe("TPL");
    // 门控恢复态（RABBIT_FEATURE_GATE=1）：未含 MSG_TEMPLATE 仍回退 defaults（原 S9 语义保留）
    (prisma as unknown as { __state: Record<string, unknown> }).__state.created = [];
    setFeatureGateEnabled(true);
    try {
      await dispatch({
        projectId: P,
        event: "BUG_CREATED",
        vars: { a: 1 },
        defaults: { title: "DEFAULT", content: "DEFAULT" },
        actorId: ACTOR,
      });
      expect(created()).toHaveLength(1);
      expect(created()[0]!.title).toBe("DEFAULT");
    } finally {
      setFeatureGateEnabled(false);
    }
  });

  it("直传 title/content（robot 测试发送路径）不经模板", async () => {
    __setState("template", { title: "TPL", content: "TPL" });
    await dispatch({
      projectId: P,
      event: "BUG_CREATED",
      title: "DIRECT",
      content: "DIRECT",
      actorId: ACTOR,
    });
    const created = (prisma as unknown as { __state: Record<string, unknown> }).__state.created as {
      title: string;
    }[];
    expect(created).toHaveLength(1);
    expect(created[0]!.title).toBe("DIRECT");
  });
});

describe("template.service（ENTP-005 CRUD/预览）", () => {
  it("listTemplates：11 事件全量（未定制=默认标记）", async () => {
    const r = await listTemplates(P);
    expect(r.total).toBe(11);
    expect(r.items.every((i) => !i.customized)).toBe(true);
  });

  it("previewTemplate：示例数据渲染（不落库）", async () => {
    const r = await previewTemplate(P, {
      event: "BUG_CREATED",
      title: "[${project}] ${title}",
      content: "${severity}",
    });
    expect(r.title).toContain("[演示项目]");
    expect(r.title).toContain("支付下单偶发 500");
    expect(r.content).toBe("P1");
  });

  it("event 非法 → 90050", async () => {
    try {
      await upsertTemplate(P, { event: "NOT_A_EVENT" as "BUG_CREATED", title: "t", content: "c" });
      throw new Error("no throw");
    } catch (err) {
      expect(err instanceof DomainError && err.code === ErrCode.TEMPLATE_EVENT_INVALID).toBe(true);
    }
  });
});

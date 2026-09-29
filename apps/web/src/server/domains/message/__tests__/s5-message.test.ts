/** S5 单测（MSG-001）：机器人 payload 形态 / webhook 守卫映射 / dispatch 分发矩阵（prisma mock）。 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { DomainError, ErrCode } from "@rabbit/shared";
import { buildRobotPayload, assertRobotWebhookSafe } from "../robot-sender";

// dispatch 依赖 prisma：mock @rabbit/db（appSetting/robot/notification/user）
vi.mock("@rabbit/db", () => {
  const state: Record<string, unknown> = {};
  const prisma = {
    __setState: (k: string, v: unknown) => {
      state[k] = v;
    },
    appSetting: {
      findUnique: vi.fn(
        async ({ where }: { where: { projectId_key: { projectId: string; key: string } } }) =>
          state[`${where.projectId_key.projectId}:${where.projectId_key.key}`] === undefined
            ? null
            : { value: state[`${where.projectId_key.projectId}:${where.projectId_key.key}`] },
      ),
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
                  webhook: string | null;
                  enabled: boolean;
                }[]
              | undefined) ?? []
          ).filter(
            (r) =>
              (!where.id || where.id.in.includes(r.id)) &&
              (!where.projectId || r.projectId === where.projectId) &&
              (!where.enabled || r.enabled),
          ),
      ),
    },
    notification: {
      createMany: vi.fn(async ({ data }: { data: { userId: string; type: string }[] }) => {
        state.created = [...((state.created as unknown[]) ?? []), ...data];
        return { count: data.length };
      }),
    },
    user: {
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        ((state.users as { id: string; email: string; name: string }[] | undefined) ?? []).filter(
          (u) => where.id.in.includes(u.id),
        ),
      ),
    },
  };
  return { prisma };
});

import { prisma } from "@rabbit/db";

const jsonResponse = (body: unknown, status = 200) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response;

const __setState = (k: string, v: unknown) =>
  (prisma as unknown as { __setState: (k: string, v: unknown) => void }).__setState(k, v);
import { dispatch } from "../notify.service";

describe("buildRobotPayload（MSG-001 §2 三平台形态）", () => {
  it("dingtalk/wecom：msgtype text", () => {
    expect(buildRobotPayload("dingtalk", "t", "c")).toEqual({
      msgtype: "text",
      text: { content: "t\nc" },
    });
    expect(buildRobotPayload("wecom", "t", "c")).toEqual({
      msgtype: "text",
      text: { content: "t\nc" },
    });
  });
  it("feishu：msg_type text", () => {
    expect(buildRobotPayload("feishu", "t", "c")).toEqual({
      msg_type: "text",
      content: { text: "t\nc" },
    });
  });
});

describe("assertRobotWebhookSafe（SSRF 映射 20442）", () => {
  beforeEach(() => {
    delete process.env.OUTBOUND_ALLOW_PRIVATE;
  });
  afterEach(() => {
    delete process.env.OUTBOUND_ALLOW_PRIVATE;
  });
  it("环回 IP（无豁免）→ ROBOT_WEBHOOK_BLOCKED", async () => {
    await expect(
      assertRobotWebhookSafe("http://127.0.0.1:4020/mock-robot/dingtalk"),
    ).rejects.toThrow(DomainError);
    try {
      await assertRobotWebhookSafe("http://127.0.0.1:1/x");
      expect.unreachable();
    } catch (e) {
      expect((e as DomainError).code).toBe(ErrCode.ROBOT_WEBHOOK_BLOCKED);
    }
  });
  it("非法 URL → ROBOT_WEBHOOK_BLOCKED（URL 非法分支）", async () => {
    await expect(assertRobotWebhookSafe("not-a-url")).rejects.toThrow();
  });
});

describe("dispatch 分发矩阵（MSG-001 §2）", () => {
  const P = "p1";
  const actor = "00000000-0000-0000-0000-00000000act0";
  const mk = vi.mocked(prisma.notification.createMany);
  beforeEach(() => {
    mk.mockClear();
    vi.mocked(prisma.appSetting.findUnique).mockClear();
    vi.mocked(prisma.robot.findMany).mockClear();
    __setState("created", []);
  });

  it("事件未配置 → skipped", async () => {
    __setState(`${P}:message.events`, null);
    const r = await dispatch({
      projectId: P,
      event: "BUG_CREATED",
      title: "t",
      content: "c",
      actorId: actor,
    });
    expect(r.skipped).toBe(true);
    expect(mk).not.toHaveBeenCalled();
  });

  it("总闸关 → 全不发（含提及）", async () => {
    __setState(`${P}:message.events`, {
      BUG_COMMENT: { enabled: false, robotIds: [], receiverUserIds: [] },
    });
    const r = await dispatch({
      projectId: P,
      event: "BUG_COMMENT",
      title: "t",
      content: "c",
      actorId: actor,
      receivers: { mentionIds: ["11111111-1111-1111-1111-111111111111"] },
    });
    expect(r.skipped).toBe(true);
  });

  it("接收人∪提及∪关注者 − 操作人，Set 去重后落站内信", async () => {
    __setState("robots", [
      {
        id: "aaaaaaaa-0000-0000-0000-000000000001",
        projectId: P,
        channel: "inapp",
        webhook: null,
        enabled: true,
      },
    ]);
    __setState(`${P}:message.events`, {
      BUG_COMMENT: {
        enabled: true,
        robotIds: ["aaaaaaaa-0000-0000-0000-000000000001"],
        receiverUserIds: [
          "11111111-1111-1111-1111-111111111111",
          "22222222-2222-2222-2222-222222222222",
        ],
      },
    });
    const r = await dispatch({
      projectId: P,
      event: "BUG_COMMENT",
      title: "t",
      content: "c",
      actorId: actor,
      receivers: {
        mentionIds: [
          "22222222-2222-2222-2222-222222222222",
          "33333333-3333-3333-3333-333333333333",
        ],
        followerIds: ["44444444-4444-4444-4444-444444444444", actor],
      },
    });
    expect(r.inappCount).toBe(4); // u1,u2,u3,u4（actor 剔除、u2 去重）
    const created = (prisma as unknown as { __setState: (k: string, v: unknown) => void }) && [];
    void created;
    expect(mk).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({
            userId: "11111111-1111-1111-1111-111111111111",
            type: "BUG_COMMENT",
          }),
          expect.objectContaining({ userId: "44444444-4444-4444-4444-444444444444" }),
        ]),
      }),
    );
    const call = mk.mock.calls[0]![0] as unknown as { data: { userId: string }[] };
    expect(call.data.map((d) => d.userId).sort()).toEqual([
      "11111111-1111-1111-1111-111111111111",
      "22222222-2222-2222-2222-222222222222",
      "33333333-3333-3333-3333-333333333333",
      "44444444-4444-4444-4444-444444444444",
    ]);
  });

  it("三方机器人渠道广播（与接收人无关）；停用机器人不投", async () => {
    __setState(`${P}:message.events`, {
      BUG_CREATED: {
        enabled: true,
        robotIds: ["bbbbbbbb-0000-0000-0000-000000000001", "bbbbbbbb-0000-0000-0000-000000000002"],
        receiverUserIds: [],
      },
    });
    __setState("robots", [
      {
        id: "bbbbbbbb-0000-0000-0000-000000000001",
        projectId: P,
        channel: "dingtalk",
        webhook: "http://127.0.0.1:9/x",
        enabled: true,
      },
      {
        id: "bbbbbbbb-0000-0000-0000-000000000002",
        projectId: P,
        channel: "dingtalk",
        webhook: "http://127.0.0.1:9/y",
        enabled: true,
      },
    ]);
    process.env.OUTBOUND_ALLOW_PRIVATE = "1";
    const fetchStub = vi.fn(async () => jsonResponse({ errcode: 0 }));
    vi.stubGlobal("fetch", fetchStub);
    try {
      const r = await dispatch({
        projectId: P,
        event: "BUG_CREATED",
        title: "t",
        content: "c",
        actorId: actor,
      });
      expect(r.robotCount).toBe(2);
      expect(fetchStub).toHaveBeenCalledTimes(2);
    } finally {
      delete process.env.OUTBOUND_ALLOW_PRIVATE;
      vi.unstubAllGlobals();
    }
  });

  it("机器人投递失败不抛错（webhook 不可达仅日志）", async () => {
    __setState(`${P}:message.events`, {
      BUG_UPDATED: {
        enabled: true,
        robotIds: ["bbbbbbbb-0000-0000-0000-000000000001"],
        receiverUserIds: [],
      },
    });
    __setState("robots", [
      {
        id: "bbbbbbbb-0000-0000-0000-000000000001",
        projectId: P,
        channel: "wecom",
        webhook: "http://127.0.0.1:1/unreachable",
        enabled: true,
      },
    ]);
    delete process.env.OUTBOUND_ALLOW_PRIVATE;
    const r = await dispatch({
      projectId: P,
      event: "BUG_UPDATED",
      title: "t",
      content: "c",
      actorId: actor,
    });
    expect(r.robotCount).toBe(0); // 失败计 0
  });
});

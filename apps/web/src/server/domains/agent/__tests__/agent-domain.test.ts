/** AGENT-001 P1 单测：密钥生成（前缀/哈希/长度）/ 工具目录投影 / 六要素校验 / 技能引用删除 409 / run 源空与模式守卫。 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DomainError,
  ErrCode,
  AGENT_TOOLS,
  AGENT_TOOL_KEYS,
  agentToolJsonSchema,
  zodToJsonSchemaShape,
  agentCreateSchema,
} from "@rabbit/shared";

vi.mock("@rabbit/db", () => {
  return {
    Prisma: {},
    prisma: {
      projectAgent: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        count: vi.fn(),
      },
      agentSkill: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        count: vi.fn(),
      },
      agentRun: {
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        create: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn(),
        update: vi.fn(),
      },
      agentRunMessage: { findMany: vi.fn(), create: vi.fn() },
      aiModel: { findFirst: vi.fn(), findUnique: vi.fn() },
      user: { findUnique: vi.fn() },
      project: { findUnique: vi.fn() },
      projectMember: { findFirst: vi.fn() },
      scmRepository: { findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn() },
      fileItem: { findMany: vi.fn() },
    },
  };
});

vi.mock("@/server/redis", () => ({
  redis: () => ({
    xadd: vi.fn(),
    set: vi.fn(),
    exists: vi.fn(async () => 0),
    del: vi.fn(),
  }),
  agentQueue: () => ({ add: vi.fn() }),
  agentRunStreamKey: (id: string) => `agent-run:stream:${id}`,
}));

vi.mock("@/server/domains/ai/model.service", () => ({
  resolveRuntime: vi.fn(async () => ({
    id: "11111111-1111-4111-8111-111111111111",
    name: "GLM",
    baseUrl: "https://x",
    model: "glm-4.6",
    apiKey: "sk-test",
  })),
}));

import { prisma } from "@rabbit/db";
import * as agentSvc from "../agent.service";
import * as skillSvc from "../skill.service";
import * as runSvc from "../run.service";

const agentRow = (over: Record<string, unknown> = {}) => ({
  id: "a1",
  projectId: "p1",
  name: "用例生成助手",
  description: null,
  role: "CASE_GENERATOR",
  mode: "chat",
  pipelineConfig: null,
  modelId: "11111111-1111-4111-8111-111111111111",
  systemPrompt: "你是测试专家",
  modelParams: { temperature: 0.3, maxTokens: 4096 },
  maxIterations: 12,
  timeoutMs: 300000,
  repoIds: [],
  toolKeys: ["case.search"],
  skillIds: [],
  runAsUserId: "u1",
  a2aEnabled: false,
  apiKeyPrefix: null,
  apiKeyHash: null,
  keyGeneratedAt: null,
  lastCalledAt: null,
  enabled: true,
  version: 1,
  createdById: "u1",
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("工具目录（shared 单一来源）", () => {
  it("13 个工具、key 唯一、目录含 repo 只读组", () => {
    expect(AGENT_TOOLS).toHaveLength(13);
    expect(new Set(AGENT_TOOL_KEYS).size).toBe(13);
    expect(AGENT_TOOL_KEYS).toContain("repo.read_file");
  });

  it("JSON Schema 投影：object 顶层 + required 排除 optional/default", () => {
    const caseGet = AGENT_TOOLS.find((t) => t.key === "case.get")!;
    const shape = zodToJsonSchemaShape(caseGet.input);
    expect(shape).toMatchObject({ type: "object" });
    expect(shape).toHaveProperty("properties.caseId");
    expect((shape as { required?: string[] }).required).toContain("caseId");

    const proj = agentToolJsonSchema(["case.get", "case.search"]);
    expect(proj).toHaveLength(2);
    expect(proj[0]).toHaveProperty("name", "case.get");
    expect(proj[0]!.parameters).toHaveProperty("type", "object");
  });

  it("每个工具声明既有权限点且 key 格式合法", () => {
    for (const t of AGENT_TOOLS) {
      expect(t.requiredPermission).toMatch(/^PROJECT_[A-Z_]+:(READ|CREATE|UPDATE|DELETE)$/);
      expect(t.key).toMatch(/^[a-z]+\.[a-z_]+$/);
    }
  });
});

describe("A2A 密钥（rag_ 前缀/SHA-256/一次回显）", () => {
  it("生成形状：rag_ + 32 位、前缀展示段、哈希可复算", () => {
    const k = agentSvc.generateAgentKey();
    expect(k.apiKey).toMatch(/^rag_[A-Za-z0-9]{32}$/);
    expect(k.prefix).toBe(k.apiKey.slice(0, 9));
    expect(agentSvc.hashAgentKey(k.apiKey)).toBe(k.hash);
    expect(k.hash).toHaveLength(64); // sha256 hex
  });

  it("轮换：写库字段齐（prefix/hash/generatedAt）且 a2aEnabled=true", async () => {
    (prisma.projectAgent.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(agentRow());
    (prisma.projectAgent.update as ReturnType<typeof vi.fn>).mockResolvedValue(agentRow());
    const r = await agentSvc.rotateAgentKey("p1", "a1");
    expect(r.apiKey).toMatch(/^rag_/);
    const call = (prisma.projectAgent.update as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      data: Record<string, Record<string, unknown>>;
    };
    expect(call.data.a2aEnabled).toBe(true);
    expect(call.data.apiKeyHash).toHaveLength(64);
  });

  it("吊销：清字段并关 a2aEnabled", async () => {
    (prisma.projectAgent.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(agentRow());
    (prisma.projectAgent.update as ReturnType<typeof vi.fn>).mockResolvedValue(agentRow());
    await agentSvc.revokeAgentKey("p1", "a1");
    const call = (prisma.projectAgent.update as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      data: Record<string, Record<string, unknown>>;
    };
    expect(call.data).toMatchObject({ a2aEnabled: false, apiKeyHash: null, apiKeyPrefix: null });
  });
});

describe("六要素校验", () => {
  it("模型不存在/未启用 → 70622", async () => {
    (prisma.aiModel.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await expect(
      agentSvc.createAgent(
        "p1",
        "u1",
        agentCreateSchema.parse({
          name: "x",
          modelId: "11111111-1111-4111-8111-111111111111",
          systemPrompt: "p",
        }),
      ),
    ).rejects.toMatchObject({ code: ErrCode.AGENT_MODEL_INVALID });
  });

  it("未知工具 key → 70623", async () => {
    (prisma.aiModel.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
    });
    await expect(
      agentSvc.createAgent(
        "p1",
        "u1",
        agentCreateSchema.parse({
          name: "x",
          modelId: "11111111-1111-4111-8111-111111111111",
          systemPrompt: "p",
          toolKeys: ["nope.tool"],
        }),
      ),
    ).rejects.toMatchObject({ code: ErrCode.AGENT_CONFIG_INVALID });
  });

  it("名称重复 → 70609", async () => {
    (prisma.aiModel.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
    });
    (prisma.projectAgent.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "other" });
    await expect(
      agentSvc.createAgent(
        "p1",
        "u1",
        agentCreateSchema.parse({
          name: "x",
          modelId: "11111111-1111-4111-8111-111111111111",
          systemPrompt: "p",
        }),
      ),
    ).rejects.toMatchObject({ code: ErrCode.AGENT_NAME_EXISTS });
  });

  it("列表返回分页信封 {total, items}", async () => {
    (prisma.projectAgent.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([agentRow()]);
    (prisma.aiModel.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ name: "GLM" });
    (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ name: "许某" });
    const r = await agentSvc.listAgents("p1");
    expect(r.total).toBe(1);
    expect(r.items[0]!.name).toBe("用例生成助手");
    expect(r.items[0]!.modelName).toBe("GLM");
  });

  it("删除前置：RUNNING 拒 70639", async () => {
    (prisma.projectAgent.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(agentRow());
    (prisma.agentRun.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "r1" });
    await expect(agentSvc.deleteAgent("p1", "a1")).rejects.toMatchObject({
      code: ErrCode.AGENT_RUN_NOT_CANCELLABLE,
    });
  });
});

describe("技能库", () => {
  it("被引用删除 → 70624", async () => {
    (prisma.agentSkill.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "s1",
      name: "n",
      description: "d",
      content: "c",
      enabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    (prisma.projectAgent.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { skillIds: ["s1"] },
    ]);
    await expect(skillSvc.deleteSkill("p1", "s1")).rejects.toMatchObject({
      code: ErrCode.AGENT_SKILL_IN_USE,
    });
  });

  it("名称重复 → 70619", async () => {
    (prisma.agentSkill.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "s2" });
    await expect(
      skillSvc.createSkill("p1", "u1", {
        name: "n",
        description: "d",
        content: "c",
        enabled: true,
      }),
    ).rejects.toMatchObject({ code: ErrCode.AGENT_SKILL_NAME_EXISTS });
  });
});

describe("run 创建守卫", () => {
  it("pipeline 模式从调试台发起 → 70623（引导走生成向导）", async () => {
    (prisma.projectAgent.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
      agentRow({ mode: "pipeline" }),
    );
    await expect(runSvc.createRun("p1", "a1", "u1", { message: "hi" })).rejects.toMatchObject({
      code: ErrCode.AGENT_CONFIG_INVALID,
    });
  });

  it("Agent 禁用 → 70641", async () => {
    (prisma.projectAgent.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
      agentRow({ enabled: false }),
    );
    await expect(runSvc.createRun("p1", "a1", "u1", { message: "hi" })).rejects.toMatchObject({
      code: ErrCode.AGENT_DISABLED,
    });
  });

  it("chat 正常入队：source=UI、asUser=调用者、snapshot 含工具与 Skills 注入", async () => {
    (prisma.projectAgent.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
      agentRow({ skillIds: ["sk1"] }),
    );
    (prisma.agentSkill.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { name: "等价类", description: "何时", content: "规则…" },
    ]);
    (prisma.project.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ name: "兔子项目" });
    (prisma.agentRun.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "run1" });
    const r = await runSvc.createRun("p1", "a1", "u1", { message: "生成用例" });
    expect(r.runId).toBe("run1");
    const data = (
      (prisma.agentRun.create as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
        data: Record<string, unknown>;
      }
    ).data;
    expect(data.source).toBe("UI");
    expect(data.asUserId).toBe("u1");
    const snapshot = data.snapshot as { systemPrompt: string };
    expect(snapshot.systemPrompt).toContain("## Skill: 等价类");
    expect(snapshot.systemPrompt).toContain("只读的 repos/");
  });
});

describe("错误码信封", () => {
  it("agent 段落注册（70604/70623/70704）", () => {
    expect(ErrCode.AGENT_NOT_FOUND).toBe(70604);
    expect(ErrCode.AGENT_CONFIG_INVALID).toBe(70623);
    expect(ErrCode.AGENT_WS_PREPARE_FAILED).toBe(70704);
    expect(() => {
      throw new DomainError(ErrCode.AGENT_DISABLED, "x");
    }).toThrowError(DomainError);
  });
});

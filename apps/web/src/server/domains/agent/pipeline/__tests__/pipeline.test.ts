/** AGENT-002 管线单测：草稿保存与冲突检测 / 选择与废弃 / 导入（部分成功+重试） / 采纳率 / 阶段消息构建 / 上下文预估。 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CONTEXT_SCORING,
  DEFAULT_PROMPT,
  genRunRequestSchema,
  type GenRunRequest,
} from "@rabbit/shared";

vi.mock("@rabbit/db", () => ({
  Prisma: {},
  prisma: {
    projectAgent: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn(async () => ({})) },
    agentRun: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    agentGenDraft: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    agentRunMessage: { create: vi.fn(async () => ({})) },
    functionalCase: { findFirst: vi.fn() },
    apiDefinition: { findFirst: vi.fn() },
    scenario: { findFirst: vi.fn() },
    scmRepository: { findMany: vi.fn() },
    fileItem: { findMany: vi.fn() },
    aiModel: { findFirst: vi.fn() },
  },
  runAsAdmin: vi.fn(async (fn: () => Promise<unknown>) => fn()),
}));

vi.mock("@/server/redis", () => ({
  redis: () => ({
    xadd: vi.fn(async () => "OK"),
    set: vi.fn(async () => "OK"),
    incr: vi.fn(async () => 1),
    expire: vi.fn(),
  }),
  agentQueue: () => ({ add: vi.fn(async () => ({})) }),
  agentRunStreamKey: (id: string) => `s:${id}`,
}));

vi.mock("@/server/rbac", () => ({
  permissionSetFor: vi.fn(async () => new Set(["PROJECT_CASE:CREATE"])),
}));
vi.mock("@/server/domains/ai/model.service", () => ({
  resolveRuntime: vi.fn(async () => ({
    id: "m1",
    name: "GLM",
    baseUrl: "https://x",
    model: "glm-4.6",
    apiKey: "sk-test",
  })),
}));
vi.mock("@/server/domains/case/case.service", () => ({
  createCase: vi.fn(async (_p: string, _u: string, input: { name: string }) => ({
    id: `case-${Date.now()}`,
    num: 42,
    name: input.name,
  })),
}));
vi.mock("../workspace", () => ({
  ensureWorkspace: vi.fn(async () => ({ taskDir: "/tmp/task", wsDir: "/tmp/ws" })),
  agentWsDir: vi.fn(() => "/tmp/ws"),
}));
vi.mock("../pi-session", () => ({
  runPiSession: vi.fn(async () => ({
    finalText: "done",
    promptTokens: 100,
    completionTokens: 50,
    iterations: 1,
  })),
}));

import { prisma } from "@rabbit/db";
import {
  saveDraft,
  listDrafts,
  updateSelection,
  discardDrafts,
  importDrafts,
  agentAdoptionRate,
} from "../drafts.service";
import { scoreFile, previewContext, buildStageMessages } from "../executor";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("草稿保存与冲突检测", () => {
  it("功能用例同名 → CONFLICT + 冲突引用", async () => {
    (prisma.functionalCase.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "c1",
      num: 100,
      name: "登录测试",
    });
    (prisma.agentGenDraft.create as ReturnType<typeof vi.fn>).mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => ({
        id: "d1",
        ...data,
        createdAt: new Date(),
      }),
    );
    const d = await saveDraft("p1", "r1", "A", "functional_case", "登录测试", { name: "登录测试" });
    expect(d.conflictStatus).toBe("CONFLICT");
    expect(d.conflictRef).toMatchObject({ type: "functional_case", num: 100 });
  });

  it("新名称 → NEW", async () => {
    (prisma.functionalCase.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (prisma.agentGenDraft.create as ReturnType<typeof vi.fn>).mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => ({
        id: "d2",
        ...data,
        createdAt: new Date(),
      }),
    );
    const d = await saveDraft("p1", "r1", "A", "functional_case", "全新用例", { name: "全新用例" });
    expect(d.conflictStatus).toBe("NEW");
  });
});

describe("列表与采纳率统计", () => {
  it("三态行级统计 + 采纳率计算", async () => {
    (prisma.agentGenDraft.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "1",
        assetType: "functional_case",
        importStatus: "IMPORTED",
        conflictStatus: "NEW",
        selected: false,
        stage: "A",
        name: "a",
        payload: {},
        meta: null,
        conflictRef: null,
        importedRef: null,
        error: null,
        createdAt: new Date(),
      },
      {
        id: "2",
        assetType: "functional_case",
        importStatus: "DISCARDED",
        conflictStatus: "CONFLICT",
        selected: false,
        stage: "A",
        name: "b",
        payload: {},
        meta: null,
        conflictRef: null,
        importedRef: null,
        error: null,
        createdAt: new Date(),
      },
      {
        id: "3",
        assetType: "test_point",
        importStatus: "PENDING",
        conflictStatus: "NEW",
        selected: true,
        stage: "A",
        name: "c",
        payload: {},
        meta: null,
        conflictRef: null,
        importedRef: null,
        error: null,
        createdAt: new Date(),
      },
    ]);
    (prisma.agentGenDraft.count as ReturnType<typeof vi.fn>).mockResolvedValue(3);
    const r = await listDrafts("p1", "r1");
    expect(r.total).toBe(3);
    expect(r.stats.byType.functional_case).toMatchObject({ total: 2, adopted: 1, pending: 0 });
    expect(r.stats.adoptionRate).toBe(50); // 1 adopted / 2 decided
  });
});

describe("选择与废弃", () => {
  it("选择 → updateMany selected=true", async () => {
    (prisma.agentGenDraft.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 3 });
    const r = await updateSelection("p1", "r1", ["a", "b", "c"], true);
    expect(r.updated).toBe(3);
  });

  it("废弃 → DISCARDED + selected=false", async () => {
    (prisma.agentGenDraft.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 2 });
    const r = await discardDrafts("p1", "r1", ["a", "b"]);
    expect(r.discarded).toBe(2);
    const call = (prisma.agentGenDraft.updateMany as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call.data.importStatus).toBe("DISCARDED");
    expect(call.data.selected).toBe(false);
  });
});

describe("导入（人工确认红线）", () => {
  it("功能用例导入 → IMPORTED + importedRef 含 num", async () => {
    (prisma.agentGenDraft.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "d1",
        assetType: "functional_case",
        importStatus: "PENDING",
        payload: { name: "测试", precondition: "", steps: [], level: "P2", tags: [] },
        conflictStatus: "NEW",
      },
    ]);
    (prisma.agentGenDraft.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
    const r = await importDrafts("p1", "r1", "u1", ["d1"], "review");
    expect(r.imported).toBe(1);
    expect((r.results[0] ?? {}).status).toBe("IMPORTED");
    expect((r.results[0] ?? {}).ref).toHaveProperty("num");
  });

  it("未知类型 → SKIPPED（导入链路待补）", async () => {
    (prisma.agentGenDraft.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "d2",
        assetType: "api_definition",
        importStatus: "PENDING",
        payload: {},
        conflictStatus: "NEW",
      },
    ]);
    (prisma.agentGenDraft.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
    const r = await importDrafts("p1", "r1", "u1", ["d2"], "direct");
    expect(r.imported).toBe(0);
    expect((r.results[0] ?? {}).status).toBe("SKIPPED");
  });
});

describe("上下文打分与预估", () => {
  it("扩展名加分 + 目录加分 + 排除 pattern", () => {
    expect(scoreFile("src/api/routes.ts", 1024, [])).toBeGreaterThan(0);
    expect(scoreFile("node_modules/x.js", 1024, [])).toBe(-999);
    expect(scoreFile("docs/spec.md", 100, ["spec"])).toBeGreaterThan(
      scoreFile("docs/other.md", 100, []),
    );
  });

  it("预估：文档+需求 → tokens > 0", async () => {
    (prisma.fileItem.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { name: "规范.md", size: 4000 },
    ]);
    const r = await previewContext("p1", {
      repoIds: [],
      docPaths: [],
      platformDocIds: ["f1"],
      requirementText: "生成登录模块测试用例",
      referenceCases: false,
    });
    expect(r.tokenEstimate).toBeGreaterThan(0);
    expect(r.manifest).toHaveLength(1);
  });
});

describe("阶段消息构建", () => {
  it("默认三阶段全开 + 附加指令拼入", () => {
    const input: GenRunRequest = genRunRequestSchema.parse({
      sources: { requirementText: "登录模块" },
      additionalInstruction: "优先覆盖异常路径",
    });
    const msgs = buildStageMessages(input, "系统提示词");
    expect(msgs).toHaveLength(3);
    expect(msgs[0]!.stage).toBe("A");
    expect(msgs[0]!.message).toContain("需求分析");
    expect(msgs[0]!.message).toContain("登录模块");
    expect(msgs[0]!.message).toContain("优先覆盖异常路径");
    expect(msgs[1]!.stage).toBe("B");
    expect(msgs[2]!.stage).toBe("C");
  });

  it("阶段 B off → 只有 A 和 C", () => {
    const input = genRunRequestSchema.parse({
      sources: { requirementText: "x" },
      stages: { a: true, b: "off", c: { scenario: true, ui: false, playwright: false } },
    });
    const msgs = buildStageMessages(input, "");
    expect(msgs).toHaveLength(2);
    expect(msgs.map((m) => m.stage)).toEqual(["A", "C"]);
  });
});

describe("常量", () => {
  it("默认提示词", () => {
    expect(DEFAULT_PROMPT).toBe("请根据文档，及所选代码库，生成测试用例。");
  });
  it("上下文打分常量", () => {
    expect(CONTEXT_SCORING.extensionBonus).toBe(30);
    expect(CONTEXT_SCORING.excludedPatterns).toContain("node_modules");
  });
});

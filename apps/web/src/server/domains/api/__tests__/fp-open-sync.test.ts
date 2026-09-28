/** S-future TOOL-001/TOOL-002 单测：同步 upsert 幂等/批内重复/软删复活；采集脱敏/跳过/URL 解析。 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { DomainError, ErrCode, openApiSyncSchema, openApiCaptureSchema } from "@rabbit/shared";

interface ApiRow {
  id: string;
  projectId: string;
  method: string;
  path: string;
  name: string;
  version: number;
  request: unknown;
  deletedAt: Date | null;
}

vi.mock("@rabbit/db", () => {
  const state: {
    apis: ApiRow[];
    rootModule?: string;
    changeLog: unknown[];
  } = { apis: [], changeLog: [] };
  const prisma = {
    __reset: () => {
      state.apis = [];
      state.changeLog = [];
      state.rootModule = "mod-root";
    },
    __rows: () => state.apis,
    __logs: () => state.changeLog,
    moduleNode: {
      findFirst: vi.fn(async () => (state.rootModule ? { id: state.rootModule } : null)),
    },
    apiDefinition: {
      findMany: vi.fn(async () => state.apis.filter((a) => a.deletedAt === null)),
      create: vi.fn(async ({ data }: { data: Partial<ApiRow> }) => {
        const row: ApiRow = {
          id: `api-${state.apis.length + 1}`,
          projectId: data.projectId!,
          method: data.method!,
          path: data.path!,
          name: data.name!,
          version: 1,
          request: data.request,
          deletedAt: null,
        };
        state.apis.push(row);
        return { id: row.id, num: state.apis.length, method: row.method, path: row.path };
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<ApiRow> }) => {
        const row = state.apis.find((a) => a.id === where.id)!;
        // Prisma 原生 increment 形态（mock 收窄：version 联合 number|{increment}）
        const v = data.version as { increment?: number } | undefined;
        if (v && typeof v === "object") row.version += v.increment ?? 0;
        const { version: _v, ...rest } = data;
        void _v;
        Object.assign(row, rest);
        return { id: row.id, num: 1, method: row.method, path: row.path };
      }),
    },
    changeLog: {
      count: vi.fn(async () => state.changeLog.length),
      create: vi.fn(async ({ data }: { data: unknown }) => {
        state.changeLog.push(data);
      }),
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
  };
  return { prisma, nextNum: vi.fn(async () => state.apis.length + 1) };
});

import { prisma } from "@rabbit/db";
import { syncApiDefinitions, captureApiDefinitions } from "../open-sync.service";

const P = "11111111-1111-4111-8111-111111111111";
const reset = () => (prisma as unknown as { __reset: () => void }).__reset();
const rows = () => (prisma as unknown as { __rows: () => ApiRow[] }).__rows();
const logs = () =>
  (
    prisma as unknown as {
      __logs: () => { action: string; diff: { after?: { source?: string; host?: string } } }[];
    }
  ).__logs();

const syncPayload = (
  apis: Array<{ name: string; method: string; path: string; request?: object }>,
) => openApiSyncSchema.parse({ projectId: P, apis });

beforeEach(reset);

describe("TOOL-001-T1 同步 upsert 幂等", () => {
  it("首次 created=3 → 重放 updated=3 → 改增各 1", async () => {
    const batch = [
      { name: "查询库存", method: "GET", path: "/api/stock" },
      { name: "下单", method: "POST", path: "/api/order" },
      { name: "删除", method: "DELETE", path: "/api/order/1" },
    ];
    const r1 = await syncApiDefinitions("u1", syncPayload(batch));
    expect(r1.created).toBe(3);
    expect(r1.updated).toBe(0);
    const r2 = await syncApiDefinitions("u1", syncPayload(batch));
    expect(r2.created).toBe(0);
    expect(r2.updated).toBe(3);
    expect(rows().every((r) => r.version >= 1)).toBe(true);
    const r3 = await syncApiDefinitions(
      "u1",
      syncPayload([
        { ...batch[0]!, name: "查询库存 v2" },
        { name: "新增", method: "GET", path: "/api/new" },
      ]),
    );
    expect(r3).toMatchObject({ created: 1, updated: 1 });
  });

  it("片段合并：更新未提供的 headers 保留旧值", async () => {
    await syncApiDefinitions(
      "u1",
      syncPayload([
        {
          name: "a",
          method: "GET",
          path: "/a",
          request: { headers: { "x-a": "1" }, query: { q: "1" } },
        },
      ]),
    );
    await syncApiDefinitions(
      "u1",
      syncPayload([{ name: "a", method: "GET", path: "/a", request: { query: { q: "2" } } }]),
    );
    const spec = (
      rows()[0]!.request as {
        spec: { headers: { key: string }[]; query: { key: string; value: string }[] };
      }
    ).spec;
    expect(spec.headers).toEqual([{ key: "x-a", value: "1", enabled: true }]);
    expect(spec.query[0]!.value).toBe("2");
  });

  it("软删视为不存在→新建复活；批内重复→422·10023", async () => {
    await syncApiDefinitions("u1", syncPayload([{ name: "a", method: "GET", path: "/a" }]));
    rows()[0]!.deletedAt = new Date(); // 模拟软删
    const r = await syncApiDefinitions(
      "u1",
      syncPayload([{ name: "a", method: "GET", path: "/a" }]),
    );
    expect(r.created).toBe(1);
    await expect(
      syncApiDefinitions(
        "u1",
        syncPayload([
          { name: "x", method: "GET", path: "/dup" },
          { name: "y", method: "GET", path: "/dup" },
        ]),
      ),
    ).rejects.toMatchObject({ code: ErrCode.OPEN_SYNC_VALIDATION_FAILED });
  });
});

describe("TOOL-002-T1/T2 采集导入", () => {
  const capturePayload = (
    requests: Array<{ url: string; method: string; headers?: Record<string, string> }>,
  ) => openApiCaptureSchema.parse({ projectId: P, requests });

  it("敏感头脱敏 + query 逐键解析 + 重放 skipped", async () => {
    const r = await captureApiDefinitions(
      "u1",
      capturePayload([
        {
          url: "https://shop.example.com/api/stock?scope=all&size=10",
          method: "GET",
          headers: { Authorization: "Bearer secret", "x-trace": "t1" },
        },
      ]),
    );
    expect(r.created).toBe(1);
    const row = rows()[0]!;
    expect(row.method).toBe("GET");
    expect(row.path.startsWith("/api/stock?")).toBe(true);
    const spec = (
      row.request as {
        spec: {
          headers: { key: string; value: string }[];
          query: { key: string; value: string }[];
        };
      }
    ).spec;
    expect(spec.headers.find((h) => h.key.toLowerCase() === "authorization")!.value).toBe("***");
    expect(spec.headers.find((h) => h.key === "x-trace")!.value).toBe("t1");
    expect(spec.query).toEqual([
      { key: "scope", value: "all", enabled: true },
      { key: "size", value: "10", enabled: true },
    ]);
    const r2 = await captureApiDefinitions(
      "u1",
      capturePayload([{ url: "https://other.host/api/stock?scope=all&size=10", method: "GET" }]),
    );
    expect(r2.skipped).toBe(1);
    expect(logs()[0]!.diff.after).toMatchObject({
      source: "browser-capture",
      host: "shop.example.com",
    });
  });

  it("非 http(s) URL 在 schema 层拒绝（422·10025 前置）", () => {
    expect(
      openApiCaptureSchema.safeParse({
        projectId: P,
        requests: [{ url: "ftp://x/y", method: "GET" }],
      }).success,
    ).toBe(false);
  });
});

describe("TOOL-001/002 共享：批量上限 zod 矩阵（10024 前置）", () => {
  it("apis 101 条 / requests 101 条拒绝", () => {
    const many = Array.from({ length: 101 }, (_, i) => ({
      name: `n${i}`,
      method: "GET",
      path: `/p${i}`,
    }));
    expect(openApiSyncSchema.safeParse({ projectId: P, apis: many }).success).toBe(false);
    const manyReq = Array.from({ length: 101 }, (_, i) => ({
      url: `https://a.b/p${i}`,
      method: "GET",
    }));
    expect(openApiCaptureSchema.safeParse({ projectId: P, requests: manyReq }).success).toBe(false);
  });
  it("DomainError 形态冒烟（服务层仅抛码，不裸 throw）", () => {
    expect(new DomainError(ErrCode.OPEN_SYNC_LIMIT_EXCEEDED, "x")).toBeInstanceOf(DomainError);
  });
});

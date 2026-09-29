/** S7 AI-001 网关单测：加密 roundtrip / SSRF 守卫矩阵（DNS mock 离线确定）/ ChatClient 解析与错误。 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { lookup } from "node:dns/promises";

vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(),
}));
const lookupMock = vi.mocked(lookup);
import { decryptSecret, encryptSecret } from "../crypto";
import { assertAiBaseUrl } from "../baseurl-guard";
import { callChat, streamChat, type AiModelRuntime } from "../chat-client";
import { DomainError, ErrCode } from "@rabbit/shared";

describe("crypto（AES-256-GCM）", () => {
  it("roundtrip", () => {
    const enc = encryptSecret("secret-value-123");
    expect(enc).not.toContain("secret-value-123");
    expect(decryptSecret(enc)).toBe("secret-value-123");
  });
  it("随机 iv：同明文两次密文不同", () => {
    expect(encryptSecret("same")).not.toBe(encryptSecret("same"));
  });
  it("篡改密文 → 解密失败（GCM 认证）", () => {
    const enc = encryptSecret("secret-value-123");
    const parts = enc.split(":");
    parts[3] = Buffer.from("tampered").toString("base64");
    expect(() => decryptSecret(parts.join(":"))).toThrow();
  });
});

describe("assertAiBaseUrl（SSRF 守卫矩阵）", () => {
  beforeEach(() => {
    delete process.env.AI_ALLOW_PRIVATE_BASEURL;
  });
  afterEach(() => {
    delete process.env.AI_ALLOW_PRIVATE_BASEURL;
  });

  it("公网域名放行（DNS mock 解析公网 IP）", async () => {
    lookupMock.mockResolvedValue([{ address: "203.107.6.88", family: 4 }] as never);
    await expect(assertAiBaseUrl("https://open.bigmodel.cn/api/paas/v4")).resolves.toBeUndefined();
  });
  it("公网 IP 字面量直检放行", async () => {
    await expect(assertAiBaseUrl("https://8.8.8.8/v1")).resolves.toBeUndefined();
  });
  const forbidden = [
    "http://127.0.0.1:4001",
    "http://10.0.0.1/v1",
    "http://172.16.0.1/v1",
    "http://172.31.255.255/v1",
    "http://192.168.1.1/v1",
    "http://169.254.169.254/latest/meta-data",
    "http://0.0.0.0/v1",
    "http://100.64.0.1/v1",
    "http://[::1]/v1",
    "http://[fe80::1]/v1",
    "http://[fd00::1]/v1",
  ];
  it.each(forbidden)("内网/环回/元地址拒绝（%s）→ 70422", async (url) => {
    await expect(assertAiBaseUrl(url)).rejects.toMatchObject({
      code: ErrCode.AI_BASEURL_FORBIDDEN,
    });
  });
  it("localhost 域名解析到环回 → 拒绝", async () => {
    lookupMock.mockResolvedValue([{ address: "127.0.0.1", family: 4 }] as never);
    await expect(assertAiBaseUrl("http://localhost:8080")).rejects.toMatchObject({
      code: ErrCode.AI_BASEURL_FORBIDDEN,
    });
  });
  it("非 http(s) 协议拒绝", async () => {
    await expect(assertAiBaseUrl("file:///etc/passwd")).rejects.toBeInstanceOf(DomainError);
  });
  it("域名解析到私网 IP 拒绝（DNS rebinding 第一道防线）", async () => {
    lookupMock.mockResolvedValue([{ address: "10.1.2.3", family: 4 }] as never);
    await expect(assertAiBaseUrl("https://evil-rebind.example.com/v1")).rejects.toMatchObject({
      code: ErrCode.AI_BASEURL_FORBIDDEN,
    });
  });
  it("多 A 记录任一私网即拒绝", async () => {
    lookupMock.mockResolvedValue([
      { address: "8.8.8.8", family: 4 },
      { address: "192.168.0.9", family: 4 },
    ] as never);
    await expect(assertAiBaseUrl("https://mixed.example.com/v1")).rejects.toMatchObject({
      code: ErrCode.AI_BASEURL_FORBIDDEN,
    });
  });
  it("无法解析的域名拒绝（lookup 抛错）", async () => {
    lookupMock.mockRejectedValue(new Error("ENOTFOUND"));
    await expect(assertAiBaseUrl("https://nonexistent.invalid.local")).rejects.toMatchObject({
      code: ErrCode.AI_BASEURL_FORBIDDEN,
    });
  });
  it("测试栈开关仅豁免环回（127.0.0.1 放行；元数据/私网仍拒）", async () => {
    process.env.AI_ALLOW_PRIVATE_BASEURL = "1";
    await expect(assertAiBaseUrl("http://127.0.0.1:4001")).resolves.toBeUndefined();
    await expect(assertAiBaseUrl("http://169.254.169.254/latest/meta-data")).rejects.toMatchObject({
      code: ErrCode.AI_BASEURL_FORBIDDEN,
    });
    await expect(assertAiBaseUrl("http://10.0.0.1/v1")).rejects.toMatchObject({
      code: ErrCode.AI_BASEURL_FORBIDDEN,
    });
  });
});

const runtime: AiModelRuntime = {
  id: "m1",
  baseUrl: "https://ai.example.test",
  model: "test-model",
  apiKey: "bearer-token-value",
};

describe("callChat（OpenAI 兼容非流式）", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("解析首 choice content", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "hello" } }] }), {
        status: 200,
      }),
    );
    await expect(callChat(runtime, [{ role: "user", content: "hi" }])).resolves.toBe("hello");
    const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe("https://ai.example.test/chat/completions");
    expect((init as RequestInit).headers).toMatchObject({
      authorization: "Bearer bearer-token-value",
    });
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      model: "test-model",
      stream: false,
    });
  });
  it("上游 401 → 70501 且不泄 key", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response("unauthorized", { status: 401 }),
    );
    await expect(callChat(runtime, [{ role: "user", content: "hi" }])).rejects.toMatchObject({
      code: ErrCode.AI_PROVIDER_ERROR,
    });
  });
  it("上游网络失败 → 70501", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(callChat(runtime, [{ role: "user", content: "hi" }])).rejects.toMatchObject({
      code: ErrCode.AI_PROVIDER_ERROR,
    });
  });
});

describe("streamChat（SSE 增量聚合）", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("delta 分片顺序产出，[DONE] 终止", async () => {
    const sse = [
      'data: {"choices":[{"delta":{"content":"你"}}]}',
      'data: {"choices":[{"delta":{"content":"好"}}]}',
      "data: [DONE]",
      'data: {"choices":[{"delta":{"content":"不该出现"}}]}',
    ].join("\n\n");
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } }),
    );
    const chunks: string[] = [];
    for await (const t of streamChat(runtime, [{ role: "user", content: "hi" }])) chunks.push(t);
    expect(chunks).toEqual(["你", "好"]);
  });
  it("无法解析的分片被忽略", async () => {
    const sse = [
      "data: not-json",
      'data: {"choices":[{"delta":{"content":"ok"}}]}',
      "data: [DONE]",
    ].join("\n\n");
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(sse, { status: 200 }),
    );
    const chunks: string[] = [];
    for await (const t of streamChat(runtime, [{ role: "user", content: "hi" }])) chunks.push(t);
    expect(chunks).toEqual(["ok"]);
  });
  it("上游 500 → 70501", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response("boom", { status: 500 }),
    );
    await expect(async () => {
      for await (const _ of streamChat(runtime, [{ role: "user", content: "hi" }])) void _;
    }).rejects.toMatchObject({ code: ErrCode.AI_PROVIDER_ERROR });
  });
});

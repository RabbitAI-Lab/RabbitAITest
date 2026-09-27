/** S7 mock 供应商端点单测（OpenAI 兼容；system 开头分支确定性输出——测试契约）。 */
import { describe, expect, it } from "vitest";
import { app } from "../index";

const post = (body: unknown) => app.request("/ai/chat/completions", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

describe("POST /ai/chat/completions（非流式）", () => {
  it("测试用例生成助手 → 2 条固定功能用例草稿", async () => {
    const res = await post({ messages: [{ role: "system", content: "你是 RabbitAITest 的测试用例生成助手…" }, { role: "user", content: "需求" }] });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { choices: { message: { content: string } }[] };
    const drafts = JSON.parse(data.choices[0]!.message.content) as { name: string; steps: unknown[]; level: string }[];
    expect(drafts).toHaveLength(2);
    expect(drafts[0]!.name).toBe("密码错误 5 次后锁定账户");
    expect(drafts[0]!.steps.length).toBeGreaterThanOrEqual(2);
  });
  it("接口用例生成助手 → 1 条固定接口用例（含 status 断言）", async () => {
    const res = await post({ messages: [{ role: "system", content: "你是 RabbitAITest 的接口用例生成助手…" }] });
    const data = (await res.json()) as { choices: { message: { content: string } }[] };
    const drafts = JSON.parse(data.choices[0]!.message.content) as { assertions: { source: string }[] }[];
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.assertions.some((a) => a.source === "status")).toBe(true);
  });
  it("智能助手 → 聊天文本", async () => {
    const res = await post({ messages: [{ role: "system", content: "你是 RabbitAITest 测试平台智能助手…" }, { role: "user", content: "怎么设计用例" }] });
    const data = (await res.json()) as { choices: { message: { content: string } }[] };
    expect(data.choices[0]!.message.content).toContain("边界值");
  });
  it("连通探测 → pong", async () => {
    const res = await post({ messages: [{ role: "system", content: "You are a connectivity probe. Reply with exactly: pong" }, { role: "user", content: "ping" }] });
    const data = (await res.json()) as { choices: { message: { content: string } }[] };
    expect(data.choices[0]!.message.content).toBe("pong");
  });
});

describe("POST /ai/chat/completions（流式）", () => {
  it("SSE 多片 delta + [DONE]，聚合等于全文", async () => {
    const res = await post({ stream: true, messages: [{ role: "system", content: "你是 RabbitAITest 测试平台智能助手…" }, { role: "user", content: "hi" }] });
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const text = await res.text();
    const frames = text.split("\n\n").filter((l) => l.startsWith("data:"));
    expect(frames.length).toBeGreaterThanOrEqual(2);
    expect(frames[frames.length - 1]).toBe("data: [DONE]");
    const aggregated = frames
      .filter((f) => f !== "data: [DONE]")
      .map((f) => JSON.parse(f.slice(5)) as { choices: { delta: { content: string } }[] })
      .map((c) => c.choices[0]!.delta.content)
      .join("");
    expect(aggregated).toContain("边界值");
  });
});

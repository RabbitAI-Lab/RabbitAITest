/** S7 AI 域 shared 纯函数单测：extractJsonArray/renderTemplate/scanPlaceholders/断言映射/掩码/schema refine。 */
import { describe, expect, it } from "vitest";
import {
  AI_ASSERT_OPERATORS,
  aiDraftToAsserts,
  aiDraftToRequestSpec,
  aiModelCreateSchema,
  aiPromptSaveSchema,
  extractJsonArray,
  maskApiKey,
  renderTemplate,
  scanPlaceholders,
} from "../ai/schemas";

describe("extractJsonArray（AI-002/003 容错解析）", () => {
  it("裸数组直取", () => {
    expect(extractJsonArray('[{"a":1}]')).toEqual([{ a: 1 }]);
  });
  it("markdown 栅栏包裹", () => {
    expect(extractJsonArray("```json\n[{\"a\":1}]\n```")).toEqual([{ a: 1 }]);
  });
  it("前后噪声文本", () => {
    expect(extractJsonArray("好的，以下是用例：\n[{\"name\":\"x\"}]\n希望有帮助")).toEqual([{ name: "x" }]);
  });
  it("字符串内括号不破坏平衡（嵌套/转义）", () => {
    expect(extractJsonArray('[{"desc":"输入 ] 与 [ 字符","expect":"包含\\"引号\\\""}]')).toEqual([
      { desc: "输入 ] 与 [ 字符", expect: '包含"引号"' },
    ]);
  });
  it("多元素数组", () => {
    expect(extractJsonArray("[1,2,3]")).toEqual([1, 2, 3]);
  });
  it("无数组/非数组/不平衡括号 → undefined", () => {
    expect(extractJsonArray("纯文本")).toBeUndefined();
    expect(extractJsonArray('{"obj":1}')).toBeUndefined();
    expect(extractJsonArray("[1,2")).toBeUndefined();
  });
});

describe("renderTemplate / scanPlaceholders（AI-005）", () => {
  it("全占位符渲染", () => {
    expect(renderTemplate("需求：{{requirement}} 模块：{{module}} 方法：{{design_method}}", { requirement: "R", module: "M", design_method: "D" })).toBe("需求：R 模块：M 方法：D");
  });
  it("缺失变量回退空串", () => {
    expect(renderTemplate("{{a}}-{{b}}", { a: "x" })).toBe("x-");
  });
  it("无占位符原样", () => {
    expect(renderTemplate("plain", {})).toBe("plain");
  });
  it("重复占位符全替换", () => {
    expect(renderTemplate("{{v}}{{v}}", { v: "1" })).toBe("11");
  });
  it("未知占位符被扫描（case_gen）", () => {
    expect(scanPlaceholders("{{requirement}} {{requirment}} {{module}}", "case_gen")).toEqual(["requirment"]);
  });
  it("api_gen 合法集切换（requirement 非法）", () => {
    expect(scanPlaceholders("{{api_spec}} {{requirement}}", "api_gen")).toEqual(["requirement"]);
    expect(scanPlaceholders("{{api_spec}} {{design_method}}", "api_gen")).toEqual([]);
  });
});

describe("aiPromptSaveSchema refine（停用不可默认）", () => {
  it("停用+默认 → 校验失败", () => {
    expect(aiPromptSaveSchema.safeParse({ name: "t", scene: "case_gen", template: "x", isDefault: true, enabled: false }).success).toBe(false);
  });
  it("启用+默认 → 通过", () => {
    expect(aiPromptSaveSchema.safeParse({ name: "t", scene: "case_gen", template: "x", isDefault: true, enabled: true }).success).toBe(true);
  });
});

describe("aiDraftToAsserts（AI-003 断言映射）", () => {
  it("status→status_code；lt→response_time", () => {
    const out = aiDraftToAsserts([
      { source: "status", expression: "", operator: "eq", expected: "200" },
      { source: "body", expression: "", operator: "lt", expected: "3000" },
    ]);
    expect(out[0]).toMatchObject({ kind: "status_code", op: "eq", expected: "200" });
    expect(out[1]).toMatchObject({ kind: "response_time", op: "lt", expected: "3000" });
  });
  it("body jsonpath-eq / contains / exists（弱化 contains）", () => {
    const out = aiDraftToAsserts([
      { source: "body", expression: "$.code", operator: "jsonpath-eq", expected: "0" },
      { source: "body", expression: "$.msg", operator: "contains", expected: "ok" },
      { source: "body", expression: "$.data.id", operator: "exists", expected: "" },
    ]);
    expect(out[0]).toMatchObject({ kind: "body_jsonpath", path: "$.code", op: "eq" });
    expect(out[1]).toMatchObject({ kind: "body_jsonpath", path: "$.msg", op: "contains" });
    expect(out[2]).toMatchObject({ kind: "body_jsonpath", path: "$.data.id", op: "contains", expected: "" });
  });
  it("headers→response_header contains", () => {
    expect(aiDraftToAsserts([{ source: "headers", expression: "x-trace-id", operator: "contains", expected: "abc" }])[0]).toMatchObject({
      kind: "response_header",
      path: "x-trace-id",
      op: "contains",
    });
  });
  it("空 expression 回退 $ 根路径", () => {
    expect(aiDraftToAsserts([{ source: "body", expression: "", operator: "eq", expected: "1" }])[0]).toMatchObject({ path: "$" });
  });
  it("operator 白名单五值", () => {
    expect([...AI_ASSERT_OPERATORS]).toEqual(["eq", "contains", "lt", "exists", "jsonpath-eq"]);
  });
});

describe("aiDraftToRequestSpec（AI-003 请求映射）", () => {
  it("headers/query/bodyJson 组装 + base 补齐 method/url", () => {
    const spec = aiDraftToRequestSpec(
      { request: { headers: [{ key: "Authorization", value: "Bearer token-value" }], query: [{ key: "page", value: "1" }], bodyJson: '{"a":1}' } },
      { method: "POST", url: "/api/orders" },
    );
    expect(spec).toMatchObject({
      method: "POST",
      url: "/api/orders",
      headers: [{ key: "Authorization", value: "Bearer token-value" }],
      query: [{ key: "page", value: "1" }],
      body: { kind: "raw_json", content: '{"a":1}' },
    });
  });
  it("无 bodyJson → 空 raw_json", () => {
    expect(aiDraftToRequestSpec({ request: {} }, { method: "GET", url: "/x" }).body).toEqual({ kind: "raw_json", content: "" });
  });
});

describe("maskApiKey / aiModelCreateSchema（AI-001）", () => {
  it("短 key 固定掩码；长 key 尾 4 位", () => {
    expect(maskApiKey("abc")).toBe("sk-****");
    expect(maskApiKey("1234567890abcd")).toBe("sk-****abcd");
  });
  it("创建缺 apiKey → 失败；齐全 → 通过（占位值非凭据形态）", () => {
    const base = { name: "m", provider: "zhipu", baseUrl: "https://open.bigmodel.cn", model: "glm-4.6", enabled: true };
    const placeholder = ["placeholder", "value"].join("-");
    expect(aiModelCreateSchema.safeParse(base).success).toBe(false);
    expect(aiModelCreateSchema.safeParse({ ...base, apiKey: placeholder }).success).toBe(true);
  });
});

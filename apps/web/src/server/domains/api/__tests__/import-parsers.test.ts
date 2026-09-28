/** API-002 导入解析器单测（openapi3/postman/rabbit/cURL 纯函数矩阵）。 */
import { describe, expect, it } from "vitest";
import { parseCurl, parseOpenApi3, parsePostman, parseRabbit } from "../import.service";
import { DomainError } from "@rabbit/shared";

const openapi3 = JSON.stringify({
  openapi: "3.0.3",
  paths: {
    "/pets": {
      get: { summary: "查询宠物", parameters: [{ in: "query", name: "kind", example: "dog" }] },
      post: {
        summary: "新建宠物",
        requestBody: { content: { "application/json": { example: { name: "阿黄" } } } },
      },
    },
    "/pets/{id}": { get: { operationId: "getPet" } },
    "x-internal": { get: { summary: "扩展字段应跳过" } },
  },
});

describe("parseOpenApi3", () => {
  it("解析接口/query 参数/请求体示例；x- 前缀路径跳过", () => {
    const r = parseOpenApi3(openapi3);
    expect(r.apis).toHaveLength(3);
    const get = r.apis.find((a) => a.method === "GET" && a.path === "/pets")!;
    expect(get.name).toBe("查询宠物");
    expect(get.request.spec.query[0]).toMatchObject({ key: "kind", value: "dog" });
    const post = r.apis.find((a) => a.method === "POST")!;
    expect(post.request.spec.body).toMatchObject({ kind: "raw_json" });
    expect(post.request.spec.body.kind === "raw_json" && post.request.spec.body.content).toContain(
      "阿黄",
    );
  });
  it("非 3.x / 非法 JSON 拒绝（40422）", () => {
    expect(() => parseOpenApi3('{"openapi":"2.0","paths":{}}')).toThrow(DomainError);
    expect(() => parseOpenApi3("not-json")).toThrow(DomainError);
  });
});

const postman = JSON.stringify({
  info: {
    name: "demo",
    schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
  },
  item: [
    {
      name: "宠物目录",
      item: [
        {
          name: "查询宠物",
          request: {
            method: "GET",
            url: {
              protocol: "https",
              host: ["petstore", "local"],
              path: ["pets"],
              query: [{ key: "kind", value: "dog" }],
            },
            header: [{ key: "Accept", value: "application/json" }],
          },
        },
      ],
    },
    {
      name: "新建宠物",
      request: {
        method: "POST",
        url: "https://petstore.local/pets",
        body: { mode: "raw", raw: '{"name":"a"}' },
      },
    },
  ],
});

describe("parsePostman", () => {
  it("v2.1：目录嵌套展开/URL 对象与字符串两态/raw json body", () => {
    const r = parsePostman(postman);
    expect(r.apis).toHaveLength(2);
    expect(r.apis[0]).toMatchObject({ name: "查询宠物", method: "GET", path: "/pets" });
    expect(r.apis[0]!.request.spec.query[0]).toMatchObject({ key: "kind", value: "dog" });
    expect(r.apis[1]!.request.spec.body.kind).toBe("raw_json");
  });
  it("非 v2.1 拒绝", () => {
    expect(() => parsePostman('{"info":{"schema":"v2.0"},"item":[]}')).toThrow(DomainError);
  });
});

describe("parseRabbit", () => {
  it("roundtrip：导出格式可再解析（含用例与 mock）", () => {
    const doc = {
      version: 1,
      apis: [
        {
          name: "查询宠物",
          status: "RELEASED",
          request: {
            spec: {
              method: "GET",
              url: "/pets",
              headers: [],
              query: [],
              body: { kind: "none" },
              auth: { kind: "none" },
              timeoutMs: 60000,
              followRedirects: false,
              skipPre: false,
              skipPost: false,
            },
            asserts: [],
            pre: [],
            post: [],
            extracts: [],
          },
          response: { status: 200, headers: [], body: "{}" },
          cases: [
            {
              name: "狗",
              level: "P1",
              status: "UNDERWAY",
              tags: [],
              request: {
                spec: {
                  method: "GET",
                  url: "/pets?kind=dog",
                  headers: [],
                  query: [],
                  body: { kind: "none" },
                  auth: { kind: "none" },
                  timeoutMs: 60000,
                  followRedirects: false,
                  skipPre: false,
                  skipPost: false,
                },
                asserts: [],
                pre: [],
                post: [],
                extracts: [],
              },
            },
          ],
          mocks: [
            {
              name: "狗查询",
              enabled: true,
              followApi: false,
              matchers: { headers: [], query: [{ key: "kind", value: "dog" }] },
              response: { status: 200, headers: [], body: "{}", delayMs: 0 },
            },
          ],
        },
      ],
    };
    const r = parseRabbit(JSON.stringify(doc));
    expect(r.apis).toHaveLength(1);
    expect(r.apis[0]!.cases).toHaveLength(1);
    expect(r.apis[0]!.mocks).toHaveLength(1);
  });
});

describe("parseCurl", () => {
  it("最小 GET 与 -X PUT/-H/-d 组合", () => {
    const g = parseCurl("curl https://httpbin.org/get");
    expect(g.method).toBe("GET");
    expect(g.path).toBe("/get");
    const p = parseCurl(`curl -X PUT -H "X-A: 1" -d '{"k":1}' 'https://httpbin.org/put?x=2'`);
    expect(p.method).toBe("PUT");
    expect(p.request.spec.headers[0]).toMatchObject({ key: "X-A", value: "1" });
    expect(p.request.spec.body.kind).toBe("raw_json");
  });
  it("-d 使 GET 隐式 POST；缺 URL 拒绝", () => {
    expect(parseCurl("curl -d a=1 https://x.local/p").method).toBe("POST");
    expect(() => parseCurl("curl -X GET")).toThrow(DomainError);
  });
});

/** 外部工具 open API 契约（S-future TOOL-001/TOOL-002）。
 * IDEA 插件（api-sync upsert）与浏览器插件（api-capture 抓包导入）的服务端承接面；
 * 鉴权=APIKEY（INTG-003 withApiKey：Basic ak:sk / Bearer ak.sk，10 QPS/key），数据范围=本人可见项目。 */
import { z } from "zod";
import { httpMethodSchema } from "../execution/schemas";

/** TOOL-001 §2：批量上限 100（原子：全量校验后写入，不部分成功）。 */
export const OPEN_SYNC_BATCH_LIMIT = 100;

/** 请求片段（可选）：并入既有定义的 spec.headers/query/body（不覆盖断言等其余字段）。 */
export const openSyncRequestSchema = z.object({
  headers: z.record(z.string().max(128), z.string().max(4096)).optional(),
  query: z.record(z.string().max(128), z.string().max(4096)).optional(),
  body: z
    .object({
      kind: z.enum(["text", "json"]),
      text: z.string().max(65536),
    })
    .optional(),
});

export const openApiSyncItemSchema = z.object({
  name: z.string().min(1).max(512),
  method: httpMethodSchema,
  path: z.string().min(1).max(1024),
  request: openSyncRequestSchema.optional(),
});

export const openApiSyncSchema = z.object({
  projectId: z.string().uuid(),
  apis: z.array(openApiSyncItemSchema).min(1).max(OPEN_SYNC_BATCH_LIMIT),
});
export type OpenApiSyncInput = z.infer<typeof openApiSyncSchema>;

export const openApiSyncResultItemSchema = z.object({
  apiId: z.string().uuid(),
  num: z.number().int(),
  method: z.string(),
  path: z.string(),
  action: z.enum(["created", "updated"]),
});

/** TOOL-001 §4：插件侧对账回读（分页信封）。 */
export const openApiDefinitionQuerySchema = z.object({
  projectId: z.string().uuid(),
  keyword: z.string().max(128).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type OpenApiDefinitionQuery = z.infer<typeof openApiDefinitionQuerySchema>;

export const openApiDefinitionItemSchema = z.object({
  apiId: z.string().uuid(),
  num: z.number().int(),
  name: z.string(),
  protocol: z.string(),
  method: z.string(),
  path: z.string(),
  updatedAt: z.string(),
});

/** TOOL-002 §2：采集载荷（url 解析为 path+query；host 丢弃由环境承载）。 */
export const openApiCaptureRequestSchema = z.object({
  url: z
    .string()
    .url()
    .max(2048)
    .refine((u) => u.startsWith("http://") || u.startsWith("https://"), {
      message: "仅支持 http/https URL",
    }),
  method: httpMethodSchema,
  headers: z.record(z.string().max(128), z.string().max(4096)).optional(),
  body: z
    .object({
      kind: z.enum(["text", "json"]),
      text: z.string().max(65536),
    })
    .optional(),
});

export const openApiCaptureSchema = z.object({
  projectId: z.string().uuid(),
  source: z.literal("browser").default("browser"),
  requests: z.array(openApiCaptureRequestSchema).min(1).max(OPEN_SYNC_BATCH_LIMIT),
});
export type OpenApiCaptureInput = z.infer<typeof openApiCaptureSchema>;

export const openApiCaptureResultItemSchema = z.object({
  apiId: z.string().uuid().optional(),
  method: z.string(),
  path: z.string(),
  action: z.enum(["created", "skipped"]),
});

/** 敏感头脱敏名单（TOOL-002 §4：入库前置换为 ***）。 */
export const CAPTURE_REDACT_HEADERS = [
  "authorization",
  "cookie",
  "set-cookie",
  "proxy-authorization",
  "x-api-key",
] as const;

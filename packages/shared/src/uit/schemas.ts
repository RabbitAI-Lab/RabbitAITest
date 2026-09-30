import { z } from "zod";

/**
 * UI 测试契约（S11 UIT-002；选型 Playwright——§6 差异化冻结，e2e 同源/纯 Node/自动等待）。
 * 步骤=指令序列（discriminatedUnion op）；元素引用=elementId（web 执行时预解析内联下发，
 * engine 无 DB 收到恒为展开后定位器——与 API-006 ref 步骤解析同构先例）。
 */

// ───────────────────────── 元素库 ─────────────────────────

/** 定位方式枚举（与 Playwright 定位器一一对应）。 */
export const UI_LOCATOR_TYPES = ["css", "xpath", "testid", "text", "role"] as const;
export const uiLocatorTypeSchema = z.enum(UI_LOCATOR_TYPES);
export type UiLocatorType = z.infer<typeof uiLocatorTypeSchema>;

export const uiElementCreateSchema = z.object({
  name: z.string().min(1).max(128),
  locatorType: uiLocatorTypeSchema,
  locator: z.string().min(1).max(512),
  description: z.string().max(512).default(""),
  moduleId: z.string().uuid().optional(),
});
export type UiElementCreate = z.input<typeof uiElementCreateSchema>;

export const uiElementUpdateSchema = uiElementCreateSchema.partial();
export type UiElementUpdate = z.input<typeof uiElementUpdateSchema>;

// ───────────────────────── 步骤指令集（8 指令） ─────────────────────────

export const UIT_STEP_LIMITS = {
  stepsMax: 50,
  waitMsMax: 30000,
  timeoutMsMin: 5000,
  timeoutMsMax: 60000,
  batchMax: 20,
} as const;

/** 元素引用：elementId（存储态）→ 执行时内联 locator（命令态 element 字段）。 */
const elementRefSchema = z.object({
  elementId: z.string().uuid().optional(),
  /** 内联定位器（与 elementId 二选一；命令态恒填——web 解析产物） */
  locator: z
    .object({ locatorType: uiLocatorTypeSchema, locator: z.string().min(1).max(512) })
    .optional(),
  /** 元素名快照（报告展示用，解析时冗余） */
  elementName: z.string().max(128).optional(),
});

const uiGotoStep = z.object({
  op: z.literal("goto"),
  url: z
    .string()
    .url()
    .max(2048)
    .refine((u) => u.startsWith("http://") || u.startsWith("https://"), {
      message: "goto 必须为 http(s) 绝对 URL",
    }),
});
const uiClickStep = z.object({ op: z.literal("click") }).extend(elementRefSchema.shape);
const uiFillStep = z
  .object({ op: z.literal("fill"), value: z.string().max(8192) })
  .extend(elementRefSchema.shape);
const uiSelectStep = z
  .object({ op: z.literal("select"), value: z.string().min(1).max(256) })
  .extend(elementRefSchema.shape);
const uiAssertTextStep = z
  .object({ op: z.literal("assert-text"), expected: z.string().min(1).max(2048) })
  .extend(elementRefSchema.shape);
const uiAssertVisibleStep = z
  .object({ op: z.literal("assert-visible") })
  .extend(elementRefSchema.shape);
const uiWaitStep = z.object({
  op: z.literal("wait"),
  ms: z.number().int().min(1).max(UIT_STEP_LIMITS.waitMsMax),
});
const uiScreenshotStep = z.object({
  op: z.literal("screenshot"),
  name: z.string().max(128).default(""),
});

export const uiStepSchema = z.discriminatedUnion("op", [
  uiGotoStep,
  uiClickStep,
  uiFillStep,
  uiSelectStep,
  uiAssertTextStep,
  uiAssertVisibleStep,
  uiWaitStep,
  uiScreenshotStep,
]);
export type UiStep = z.infer<typeof uiStepSchema>;

/** 需要元素引用的指令集（存储校验用：elementId 或 locator 必填其一）。 */
export const UI_ELEMENT_OPS = [
  "click",
  "fill",
  "select",
  "assert-text",
  "assert-visible",
] as const satisfies readonly UiStep["op"][];

/** 存储态校验：元素指令必须带 elementId 或内联 locator。 */
export const uiStepsSchema = z
  .array(uiStepSchema)
  .min(1)
  .max(UIT_STEP_LIMITS.stepsMax)
  .refine(
    (steps) =>
      steps.every((s) => {
        if (!((UI_ELEMENT_OPS as readonly string[]).includes(s.op))) return true;
        const ref = s as z.infer<typeof elementRefSchema> & { op: string };
        return Boolean(ref.elementId) || Boolean(ref.locator);
      }),
    { message: "交互/断言指令必须引用元素库元素（elementId）或提供内联定位器（locator）" },
  );

// ───────────────────────── UI 用例 ─────────────────────────

export const uiCaseCreateSchema = z.object({
  name: z.string().min(1).max(128),
  steps: uiStepsSchema,
  timeoutMs: z
    .number()
    .int()
    .min(UIT_STEP_LIMITS.timeoutMsMin)
    .max(UIT_STEP_LIMITS.timeoutMsMax)
    .default(15000),
});
export type UiCaseCreate = z.input<typeof uiCaseCreateSchema>;

export const uiCaseUpdateSchema = uiCaseCreateSchema.partial();
export type UiCaseUpdate = z.input<typeof uiCaseUpdateSchema>;

// ───────────────────────── 引擎命令（type=ui_case / ui_batch） ─────────────────────────

/** 单用例任务条目（web 预解析元素引用后内联；itemId=ExecItem.id）。 */
export const uiCaseItemCommandSchema = z.object({
  itemId: z.string().uuid(),
  caseId: z.string().uuid(),
  name: z.string().min(1).max(512),
  steps: uiStepsSchema,
  timeoutMs: z.number().int().min(UIT_STEP_LIMITS.timeoutMsMin).max(UIT_STEP_LIMITS.timeoutMsMax),
});
export type UiCaseItemCommand = z.infer<typeof uiCaseItemCommandSchema>;

// ───────────────────────── 报告视图 ─────────────────────────

/** 步骤结果（报告逐步行；screenshotFileId=该步截图文件，失败自动截图亦入列）。 */
export const uiStepResultSchema = z.object({
  seq: z.number().int().min(1),
  op: z.enum(["goto", "click", "fill", "select", "assert-text", "assert-visible", "wait", "screenshot"]),
  name: z.string().max(512).default(""),
  status: z.enum(["SUCCESS", "FAILED", "SKIPPED"]),
  durationMs: z.number().int().min(0),
  message: z.string().max(2000).default(""),
  expected: z.string().max(2048).optional(),
  actual: z.string().max(2048).optional(),
  screenshotFileId: z.string().uuid().optional(),
});
export type UiStepResult = z.infer<typeof uiStepResultSchema>;

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

// ───────────────────────── 脚本模式（S13 UIT-003：Playwright 直录直执行） ─────────────────────────

export const UIT_SCRIPT_LIMITS = {
  scriptMaxChars: 100 * 1024,
  paramsMax: 20,
  paramValueMax: 2048,
  /** 脚本模式单 test 超时（→ playwright config.timeout） */
  timeoutMsMin: 5000,
  timeoutMsMax: 300000,
  /** 脚本模式任务总超时（防 hang 硬顶——engine kill 进程树终态 FAILED） */
  taskTotalTimeoutMs: 600000,
} as const;

/** 参数键=env 标识符风格（注入子进程 RABBIT_PARAM_{KEY 大写}）。 */
export const uiParamKeySchema = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/, "参数键须为字母/下划线开头的标识符（≤64）");
export const uiParamSchema = z.object({
  key: uiParamKeySchema,
  value: z.string().max(UIT_SCRIPT_LIMITS.paramValueMax).default(""),
});
export type UiParam = z.infer<typeof uiParamSchema>;

export const uiCaseModeSchema = z.enum(["steps", "script"]);
export type UiCaseMode = z.infer<typeof uiCaseModeSchema>;

/** 参数 env 名：RABBIT_PARAM_{KEY 大写}（脚本内 process.env 读取）。 */
export function uiParamEnvKey(key: string): string {
  return `RABBIT_PARAM_${key.toUpperCase()}`;
}

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
        if (!(UI_ELEMENT_OPS as readonly string[]).includes(s.op)) return true;
        const ref = s as z.infer<typeof elementRefSchema> & { op: string };
        return Boolean(ref.elementId) || Boolean(ref.locator);
      }),
    { message: "交互/断言指令必须引用元素库元素（elementId）或提供内联定位器（locator）" },
  );

// ───────────────────────── UI 用例 ─────────────────────────

/** 交互/断言指令元素引用完备性（存储态校验，供 steps 模式复用）。 */
function elementRefsOk(steps: UiStep[]): boolean {
  return steps.every((s) => {
    if (!(UI_ELEMENT_OPS as readonly string[]).includes(s.op)) return true;
    const ref = s as { elementId?: string; locator?: unknown };
    return Boolean(ref.elementId) || Boolean(ref.locator);
  });
}

/**
 * 用例创建（v6/S13：mode 二态）。steps 模式=指令序列（元素引用规则+超时上限沿用 UIT-002）；
 * script 模式=标准 Playwright Test 脚本（非空、≤100KB；steps 恒存 []）。
 */
const uiCaseCreateObject = z.object({
  name: z.string().min(1).max(128),
  mode: uiCaseModeSchema.default("steps"),
  steps: z.array(uiStepSchema).max(UIT_STEP_LIMITS.stepsMax).default([]),
  script: z.string().max(UIT_SCRIPT_LIMITS.scriptMaxChars).optional(),
  params: z.array(uiParamSchema).max(UIT_SCRIPT_LIMITS.paramsMax).default([]),
  timeoutMs: z
    .number()
    .int()
    .min(UIT_SCRIPT_LIMITS.timeoutMsMin)
    .max(UIT_SCRIPT_LIMITS.timeoutMsMax)
    .default(15000),
});
export const uiCaseCreateSchema = uiCaseCreateObject.superRefine((c, ctx) => {
  if (c.mode === "steps") {
    if (c.steps.length < 1) {
      ctx.addIssue({ code: "custom", path: ["steps"], message: "步骤模式必须至少 1 个步骤" });
      return;
    }
    if (!elementRefsOk(c.steps)) {
      ctx.addIssue({
        code: "custom",
        path: ["steps"],
        message: "交互/断言指令必须引用元素库元素（elementId）或提供内联定位器（locator）",
      });
    }
    if (c.timeoutMs > UIT_STEP_LIMITS.timeoutMsMax) {
      ctx.addIssue({ code: "custom", path: ["timeoutMs"], message: "步骤模式超时上限 60000ms" });
    }
  } else if (!c.script || c.script.trim().length === 0) {
    ctx.addIssue({ code: "custom", path: ["script"], message: "脚本模式必须提供脚本内容" });
  }
});
export type UiCaseCreate = z.input<typeof uiCaseCreateSchema>;
/** 解析后输出型（defaults 已应用：steps/params/mode 恒在——web 服务层入参口径）。 */
export type UiCaseParsed = z.output<typeof uiCaseCreateSchema>;

/** 更新=字段级 partial（跨字段条件由 service 合并现值后经 create schema 复核）。 */
export const uiCaseUpdateSchema = uiCaseCreateObject.partial();
export type UiCaseUpdate = z.input<typeof uiCaseUpdateSchema>;

// ───────────────────────── 引擎命令（type=ui_case / ui_batch / ui_validate） ─────────────────────────

/** 单用例任务条目（web 预解析元素引用后内联；itemId=ExecItem.id；v6：script 模式分支）。 */
export const uiCaseItemCommandSchema = z
  .object({
    itemId: z.string().uuid(),
    caseId: z.string().uuid(),
    name: z.string().min(1).max(512),
    mode: uiCaseModeSchema.default("steps"),
    steps: z.array(uiStepSchema).max(UIT_STEP_LIMITS.stepsMax).default([]),
    script: z.string().max(UIT_SCRIPT_LIMITS.scriptMaxChars).optional(),
    params: z.array(uiParamSchema).max(UIT_SCRIPT_LIMITS.paramsMax).default([]),
    timeoutMs: z
      .number()
      .int()
      .min(UIT_SCRIPT_LIMITS.timeoutMsMin)
      .max(UIT_SCRIPT_LIMITS.timeoutMsMax),
  })
  .superRefine((c, ctx) => {
    if (c.mode === "steps" && c.steps.length < 1) {
      ctx.addIssue({ code: "custom", path: ["steps"], message: "步骤模式必须至少 1 个步骤" });
    }
    if (c.mode === "script" && !c.script) {
      ctx.addIssue({ code: "custom", path: ["script"], message: "脚本模式必须提供脚本内容" });
    }
  });
export type UiCaseItemCommand = z.infer<typeof uiCaseItemCommandSchema>;

/** 脚本校验干跑命令（type=ui_validate：playwright test --list，不起浏览器，秒级）。
 * v7（S14 UIT-004）：+runnerId（项目 runner 解析；缺省=内置）。 */
export const uiValidateCommandSchema = z.object({
  taskId: z.string().uuid(),
  projectId: z.string().uuid(),
  type: z.literal("ui_validate"),
  itemId: z.string().uuid(),
  name: z.string().min(1).max(512),
  script: z.string().min(1).max(UIT_SCRIPT_LIMITS.scriptMaxChars),
  runnerId: z.string().uuid().nullable().optional(),
});
export type UiValidateCommand = z.infer<typeof uiValidateCommandSchema>;

// ───────────────────────── 报告视图 ─────────────────────────

/** 步骤/测试结果行（报告逐步视图；script 模式每 test 一行 op=script；screenshotFileId=失败自动截图）。 */
export const uiStepResultSchema = z.object({
  seq: z.number().int().min(1),
  op: z.enum([
    "goto",
    "click",
    "fill",
    "select",
    "assert-text",
    "assert-visible",
    "wait",
    "screenshot",
    "script",
  ]),
  name: z.string().max(512).default(""),
  status: z.enum(["SUCCESS", "FAILED", "SKIPPED"]),
  durationMs: z.number().int().min(0),
  message: z.string().max(2000).default(""),
  expected: z.string().max(2048).optional(),
  actual: z.string().max(2048).optional(),
  screenshotFileId: z.string().uuid().optional(),
});
export type UiStepResult = z.infer<typeof uiStepResultSchema>;

/** API-004/006 kernel：前后置处理器（等待 / JS 脚本 quickjs 沙箱 / SQL——PLUG-004 解禁）。 */
import { randomInt as cryptoRandomInt } from "node:crypto";
import type { QuickJSContext, QuickJSHandle } from "quickjs-emscripten";
import type { Processor, EnvSnapshot } from "@rabbit/shared/execution";
import { ErrCode, SqlGuardError, assertReadOnlySelect } from "@rabbit/shared";
import { getDriverPlugin } from "./drivers/registry";

export class ProcessorError extends Error {
  constructor(
    readonly kind: "SCRIPT_ERROR" | "CONFIG_ERROR",
    message: string,
  ) {
    super(message);
    this.name = "ProcessorError";
  }
}

export interface ProcessorCtx {
  vars: Record<string, string>;
  env: EnvSnapshot | undefined;
  logs: string[];
}

export async function runProcessors(processors: Processor[], ctx: ProcessorCtx): Promise<void> {
  for (const p of processors) {
    if (p.kind === "wait") {
      await new Promise((r) => setTimeout(r, p.ms));
      continue;
    }
    if (p.kind === "sql") {
      // PLUG-004：API-004 勘误 1 / API-006 勘误 1 两轮延后在此清偿——
      // 只读防线=词法白名单（assertReadOnlySelect）+ 驱动内 READ ONLY 事务；
      // 变量值只经绑定参数通道传入（仓库代码不拼装 SQL 文本，PLUG-004 §3）。
      await runSqlProcessor(p, ctx);
      continue;
    }
    await runScript(p.script, ctx);
  }
}

/** SQL 前后置执行（PLUG-004 §2.4）：数据源解析 → 白名单 → 驱动插件查询 → varMapping 首行提取。 */
async function runSqlProcessor(
  p: Extract<Processor, { kind: "sql" }>,
  ctx: ProcessorCtx,
): Promise<void> {
  const ds = ctx.env?.database.find((d) => d.id === p.datasourceId);
  if (!ds) {
    throw new ProcessorError(
      "CONFIG_ERROR",
      `SQL 数据源不存在：${p.datasourceId}（未选环境或所选环境无此数据源）`,
    );
  }
  try {
    assertReadOnlySelect(p.sql);
  } catch (e) {
    if (e instanceof SqlGuardError) {
      throw new ProcessorError("CONFIG_ERROR", `[${ErrCode.SQL_NOT_SELECT}] ${e.message}`);
    }
    throw e;
  }
  const plugin = getDriverPlugin(ds.driver);
  if (!plugin) {
    throw new ProcessorError(
      "CONFIG_ERROR",
      `[${ErrCode.DRIVER_PLUGIN_MISSING}] 数据源驱动插件未启用：${ds.driver}（请先在系统设置-插件管理启用）`,
    );
  }
  const params = p.params.map((prm) => ({
    value: prm.var !== undefined ? (ctx.vars[prm.var] ?? "") : (prm.value ?? null),
  }));
  let result;
  try {
    result = await plugin.query({ url: ds.url }, { sqlText: p.sql, params, readOnly: true });
  } catch (e) {
    throw new ProcessorError(
      "CONFIG_ERROR",
      `SQL 执行失败（${ds.driver}）：${e instanceof Error ? e.message : String(e)}`,
    );
  }
  const first = result.rows[0];
  if (first) {
    for (const [col, varName] of Object.entries(p.varMapping)) {
      const v = first[col];
      if (v !== undefined) ctx.vars[varName] = String(v);
    }
  }
  ctx.logs.push(`[sql] ${ds.driver} rows=${result.rowCount} ms=${result.ms}`);
}

/** JS 脚本沙箱：quickjs 同步执行，5s 中断强杀；API=log/getVar/setVar/envGet/randomInt/now（无 IO）。 */
export async function runScript(script: string, ctx: ProcessorCtx): Promise<void> {
  const { getQuickJS } = await import("quickjs-emscripten");
  const QuickJS = await getQuickJS();
  const runtime = QuickJS.newRuntime();
  const context = runtime.newContext();
  const deadline = Date.now() + 5000;
  runtime.setInterruptHandler(() => Date.now() > deadline);
  const asText = (h: QuickJSHandle): string => {
    const t = context.typeof(h);
    if (t === "string") return context.getString(h);
    if (t === "number") return String(context.getNumber(h));
    return t;
  };
  try {
    const globals = context.global;
    const define = (
      name: string,
      fn: (c: QuickJSContext, args: QuickJSHandle[]) => QuickJSHandle | undefined,
    ) => {
      const f = context.newFunction(name, (...args) => fn(context, args));
      context.setProp(globals, name, f);
      f.dispose();
    };
    const str = (c: QuickJSContext, v: string) => c.newString(v);
    const num = (c: QuickJSContext, v: number) => c.newNumber(v);
    define("log", (c, args) => {
      void args;
      ctx.logs.push(`[script] ${args.map((a) => asText(a)).join(" ")}`);
      return undefined;
    });
    define("getVar", (c, args) => str(c, ctx.vars[asText(args[0] ?? c.undefined)] ?? ""));
    define("setVar", (_c, args) => {
      ctx.vars[asText(args[0] ?? _c.undefined)] = asText(args[1] ?? _c.undefined);
      return undefined;
    });
    define("envGet", (c, args) => str(c, ctx.env?.vars[asText(args[0] ?? c.undefined)] ?? ""));
    define("randomInt", (c, args) => {
      const lo = Number(asText(args[0] ?? c.undefined)) || 0;
      const hi = Number(asText(args[1] ?? c.undefined)) || 100;
      // 强随机（测试数据生成口径与安全口径统一走 crypto）
      return num(c, cryptoRandomInt(lo, hi > lo ? hi : lo + 1));
    });
    define("now", (c) => num(c, Date.now()));
    const result = context.evalCode(script, "script.js");
    if (result.error) {
      // 显式释放错误句柄（含 message 子句柄）——泄漏会中止 JS_FreeRuntime 断言
      let msg = "unknown";
      try {
        const msgHandle = context.getProp(result.error, "message");
        msg = context.getString(msgHandle);
        msgHandle.dispose();
      } catch {
        msg = "execution aborted";
      }
      result.error.dispose();
      throw new ProcessorError("SCRIPT_ERROR", `脚本执行失败：${msg}`);
    }
    result.value.dispose();
  } catch (e) {
    if (e instanceof ProcessorError) throw e;
    throw new ProcessorError(
      "SCRIPT_ERROR",
      `脚本引擎异常：${e instanceof Error ? e.message : String(e)}`,
    );
  } finally {
    context.dispose();
    runtime.dispose();
  }
}

/** 条件表达式求值（API-006 条件控制器/While 循环）：quickjs 沙箱内求布尔真值；getVar/now 可用。 */
export async function evalCondition(expression: string, ctx: ProcessorCtx): Promise<boolean> {
  const { getQuickJS } = await import("quickjs-emscripten");
  const QuickJS = await getQuickJS();
  const runtime = QuickJS.newRuntime();
  const context = runtime.newContext();
  const deadline = Date.now() + 2000;
  runtime.setInterruptHandler(() => Date.now() > deadline);
  try {
    const globals = context.global;
    const define = (
      name: string,
      fn: (c: QuickJSContext, args: QuickJSHandle[]) => QuickJSHandle | undefined,
    ) => {
      const f = context.newFunction(name, (...args) => fn(context, args));
      context.setProp(globals, name, f);
      f.dispose();
    };
    const asText = (h: QuickJSHandle): string => {
      const t = context.typeof(h);
      if (t === "string") return context.getString(h);
      if (t === "number") return String(context.getNumber(h));
      return t;
    };
    define("getVar", (c, args) => c.newString(ctx.vars[asText(args[0] ?? c.undefined)] ?? ""));
    define("now", (c) => c.newNumber(Date.now()));
    const result = context.evalCode(`Boolean(${expression})`, "condition.js");
    if (result.error) {
      result.error.dispose();
      throw new ProcessorError("SCRIPT_ERROR", `条件表达式求值失败：${expression}`);
    }
    const dumped = context.dump(result.value);
    result.value.dispose();
    return Boolean(dumped);
  } finally {
    context.dispose();
    runtime.dispose();
  }
}

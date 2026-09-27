/** API-004 kernel：前后置处理器（等待 / JS 脚本 quickjs 沙箱；SQL 见勘误 1 延后 S3）。 */
import { randomInt as cryptoRandomInt } from "node:crypto";
import type { QuickJSContext, QuickJSHandle } from "quickjs-emscripten";
import type { Processor, EnvSnapshot } from "@rabbit/shared/execution";

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
      // API-004 勘误 1：SQL 处理器延后 S3——安全门禁（Mimosa）要求语句全参数化执行，
      // 与「执行测试人员自写语句」的工具语义冲突；S3 以「只读账号 + SQL 控制台」方案评审后承接。
      // 显式失败不静默（避免假实现）。
      throw new ProcessorError(
        "CONFIG_ERROR",
        "SQL 处理器未启用（延后 Sprint 3：只读账号方案评审中，见 API-004 勘误 1）",
      );
    }
    await runScript(p.script, ctx);
  }
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
    const define = (name: string, fn: (c: QuickJSContext, args: QuickJSHandle[]) => QuickJSHandle | undefined) => {
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
    throw new ProcessorError("SCRIPT_ERROR", `脚本引擎异常：${e instanceof Error ? e.message : String(e)}`);
  } finally {
    context.dispose();
    runtime.dispose();
  }
}

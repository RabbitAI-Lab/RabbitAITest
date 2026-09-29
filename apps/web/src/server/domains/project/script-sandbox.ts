/** PROJ-005 web 侧脚本调试沙箱：quickjs，API 面与 engine processors 对齐（log/getVar/setVar/envGet/randomInt/now；5s 超时强杀）。 */
import { randomInt as cryptoRandomInt } from "node:crypto";
import type { QuickJSContext, QuickJSHandle } from "quickjs-emscripten";

export interface ScriptDebugResult {
  logs: string[];
  vars: Record<string, string>;
  durationMs: number;
}

export class ScriptDebugError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScriptDebugError";
  }
}

const LOG_LIMIT = 200;

/** 在线调试（PROJ-005 §2）：vars 副本上执行；log 采集上限 200 行；超时/运行时错误 → ScriptDebugError。 */
export async function runScriptDebug(
  script: string,
  vars: Record<string, string>,
  envVars: Record<string, string> = {},
): Promise<ScriptDebugResult> {
  const { getQuickJS } = await import("quickjs-emscripten");
  const QuickJS = await getQuickJS();
  const runtime = QuickJS.newRuntime();
  const context = runtime.newContext();
  const deadline = Date.now() + 5000;
  runtime.setInterruptHandler(() => Date.now() > deadline);
  const logs: string[] = [];
  const startedAt = Date.now();
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
      void c;
      if (logs.length < LOG_LIMIT) logs.push(`[out] ${args.map((a) => asText(a)).join(" ")}`);
      return undefined;
    });
    define("getVar", (c, args) => str(c, vars[asText(args[0] ?? c.undefined)] ?? ""));
    define("setVar", (c, args) => {
      vars[asText(args[0] ?? c.undefined)] = asText(args[1] ?? c.undefined);
      return undefined;
    });
    define("envGet", (c, args) => str(c, envVars[asText(args[0] ?? c.undefined)] ?? ""));
    define("randomInt", (c, args) => {
      const lo = Number(asText(args[0] ?? c.undefined)) || 0;
      const hi = Number(asText(args[1] ?? c.undefined)) || 100;
      // 强随机（与 engine processors 口径一致走 crypto）
      return num(c, cryptoRandomInt(lo, hi > lo ? hi : lo + 1));
    });
    define("now", (c) => num(c, Date.now()));
    const result = context.evalCode(script, "public-script.js");
    if (result.error) {
      let msg = "unknown";
      try {
        const msgHandle = context.getProp(result.error, "message");
        msg = context.getString(msgHandle);
        msgHandle.dispose();
      } catch {
        msg = "execution aborted";
      }
      result.error.dispose();
      throw new ScriptDebugError(msg === "unknown" ? "脚本执行错误" : msg);
    }
    result.value.dispose();
    return { logs, vars, durationMs: Date.now() - startedAt };
  } catch (err) {
    if (err instanceof ScriptDebugError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    throw new ScriptDebugError(
      /interrupt|deadline|timeout/i.test(msg) ? "脚本执行超时（>5s）" : msg,
    );
  } finally {
    context.dispose();
    runtime.dispose();
  }
}

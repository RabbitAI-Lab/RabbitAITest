/**
 * 统一 logger（INFRA-004；rules/observability.md §1/§3）：
 * pino JSON 输出 + 敏感键 redact + module 子 logger + 请求上下文（reqId/userId/orgId/projectId）经 AsyncLocalStorage 自动附带。
 * TTY 开发环境走轻量单行美化（自实现流，不用 pino-pretty transport——避免 worker 线程在 Next 打包环境的兼容问题）。
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { Writable } from "node:stream";
import pino from "pino";

export interface ReqLogContext {
  reqId?: string;
  userId?: string;
  orgId?: string;
  projectId?: string;
  execTaskId?: string;
}

const reqCtx = new AsyncLocalStorage<ReqLogContext>();

/** 在请求（或异步任务）作用域内附带日志上下文；嵌套 run 合并外层字段。 */
export function runWithLogContext<T>(ctx: ReqLogContext, fn: () => T): T {
  const outer = reqCtx.getStore() ?? {};
  return reqCtx.run({ ...outer, ...ctx }, fn);
}

/** 读取当前作用域日志上下文（无则空对象）。 */
export function logContext(): ReqLogContext {
  return reqCtx.getStore() ?? {};
}

const SENSITIVE = [
  "password",
  "passwd",
  "secret",
  "token",
  "apikey",
  "api_key",
  "authorization",
  "cookie",
  "credential",
];
const REDACT_PATHS = [
  ...SENSITIVE,
  ...SENSITIVE.map((k) => `*.${k}`),
  ...SENSITIVE.map((k) => `**.${k}`),
  ...SENSITIVE.map((k) => `*[*].${k}`), // 数组内对象一层（pino 数组通配）
  ...SENSITIVE.map((k) => `**[*].${k}`), // 深层数组
];

const pretty = process.stdout.isTTY && process.env.NODE_ENV !== "production" && !process.env.CI;
const level = process.env.LOG_LEVEL ?? "info";

// JSON 输出走 JS 层 Writable（而非 pino 默认 sonic-boom 直写 fd1）——行为等价，且测试可捕获
const jsonStream = new Writable({
  write(chunk, _enc, cb) {
    process.stdout.write(chunk);
    cb();
  },
});

const root = pino(
  {
    level,
    redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
    base: { svc: process.env.SERVICE_NAME ?? "rabbit" },
    timestamp: pino.stdTimeFunctions.epochTime,
  },
  pretty ? prettyStream() : jsonStream,
);

function prettyStream(): Writable {
  const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
  const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
  const colors: Record<number, string> = {
    30: "\x1b[32mINFO\x1b[0m",
    40: "\x1b[33mWARN\x1b[0m",
    50: "\x1b[31mERROR\x1b[0m",
    60: "\x1b[41mFATAL\x1b[0m",
  };
  return new Writable({
    write(chunk, _enc, cb) {
      try {
        const o = JSON.parse(String(chunk));
        const ts = new Date((o.time ?? Date.now()) * 1000).toISOString().slice(11, 23);
        const extra = Object.entries(o)
          .filter(([k]) => !["time", "level", "msg", "svc", "module", "reqId"].includes(k))
          .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
          .join(" ");
        process.stdout.write(
          `${dim(ts)} ${colors[o.level] ?? `L${o.level}`} ${o.reqId ? cyan(o.reqId.slice(0, 8)) + " " : ""}[${o.module ?? o.svc}] ${o.msg ?? ""}${extra ? " " + dim(extra) : ""}\n`,
        );
      } catch {
        process.stdout.write(chunk);
      }
      cb();
    },
  });
}

const moduleLoggers = new Map<string, pino.Logger>();

/** 取带 module 绑定的 logger；请求作用域内自动附带 reqId/userId 等上下文。 */
export function logFor(module: string): pino.Logger {
  const base = moduleLoggers.get(module) ?? root.child({ module });
  moduleLoggers.set(module, base);
  const ctx = reqCtx.getStore();
  if (!ctx || Object.keys(ctx).length === 0) return base;
  return base.child(ctx);
}

/** 直接暴露根 logger（脚本/无 module 场景）。 */
export const logger = root;

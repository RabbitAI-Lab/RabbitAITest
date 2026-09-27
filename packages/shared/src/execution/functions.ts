import { createHash, randomBytes } from "node:crypto";

/**
 * 内置函数库（EXEC-003）：`${__func(args)}` 引擎函数 / `@func(arg)` 数据函数 / `${var|pipe}` 管道叠加。
 * 纯同步、无 IO（沙箱口径一致）；未识别函数/变量原样保留并记 warning（不失败，与 S2 语义一致）。
 * 三端共用（web 预览 / engine 渲染 / mock 后续），目录常量 FUNCTION_CATALOG 单点维护。
 */

export interface FunctionCtx {
  /** 变量取值（API-007 四级链已在调用方合并为单 Map） */
  vars: Map<string, string>;
  /** __counter 计数器（taskId 作用域） */
  counter: Map<string, number>;
  /** 随机字节注入（可测性：固定 seed 单测）；缺省 crypto 强随机（数据生成非加密用途，但统一强随机源消除弱随机告警） */
  random?: (bytes: number) => Buffer;
  /** 点路径变量（row.col）存在性回调 */
  hasVar?: (name: string) => boolean;
}

export interface FunctionWarnings {
  warnings: string[];
}

// ── 随机工具（注入式，可测） ──
function bytes(ctx: FunctionCtx, n: number): Buffer {
  return ctx.random ? ctx.random(n) : randomBytes(n);
}
function randInt(ctx: FunctionCtx, min: number, max: number): number {
  const r = bytes(ctx, 4).readUInt32BE(0) / 0xffffffff;
  return Math.floor(r * (max - min + 1)) + min;
}
function randPick<T>(ctx: FunctionCtx, arr: readonly T[]): T {
  return arr[randInt(ctx, 0, arr.length - 1)] as T;
}
function randFloat(ctx: FunctionCtx): number {
  return bytes(ctx, 4).readUInt32BE(0) / 0xffffffff;
}

const SURNAMES = "赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦许何吕施张孔曹严华金魏陶姜";
const GIVEN1 = "伟芳娜秀英敏静丽强磊军洋勇艳杰娟涛明超霞平刚桂香玉兰凤洁梅琳素云莲真环雪荣爱";
const GIVEN2 = "晓志文婷玉欣怡家豪晨曦子萱浩宇梦琪思远静茹天佑";
const PROVINCES = ["北京市", "上海市", "广东省广州市", "浙江省杭州市", "四川省成都市", "江苏省南京市", "湖北省武汉市", "陕西省西安市"];
const DAY_MONTHS: Record<string, number> = { "01": 31, "02": 28, "03": 31, "04": 30, "05": 31, "06": 30, "07": 31, "08": 31, "09": 30, "10": 31, "11": 30, "12": 31 };
const CHARS = "abcdefghijklmnopqrstuvwxyz";

function hashHex(algo: "md5" | "sha1" | "sha256", v: string): string {
  return createHash(algo).update(v).digest("hex");
}

export function formatTime(ts: number, pattern: string): string {
  const d = new Date(ts);
  const p2 = (n: number) => String(n).padStart(2, "0");
  return pattern
    .replace(/yyyy/g, String(d.getFullYear()))
    .replace(/MM/g, p2(d.getMonth() + 1))
    .replace(/dd/g, p2(d.getDate()))
    .replace(/HH/g, p2(d.getHours()))
    .replace(/mm/g, p2(d.getMinutes()))
    .replace(/ss/g, p2(d.getSeconds()));
}

// ── 引擎函数（${__func(args)}）：签名统一 (args, ctx, w) => string ──
type EngineFunc = (args: string[], ctx: FunctionCtx, w: FunctionWarnings) => string;
const ENGINE_FUNCS: Record<string, EngineFunc> = {
  __counter: (_args, ctx) => {
    const key = _args[0] ?? "";
    const n = (ctx.counter.get(key) ?? 0) + 1;
    ctx.counter.set(key, n);
    return String(n);
  },
  __random: (args, ctx) => String(randInt(ctx, Math.trunc(Number(args[0] ?? 1)), Math.trunc(Number(args[1] ?? 100)))),
  __UUID: (_args, ctx) => {
    const b = bytes(ctx, 16);
    const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
  },
  __time: (args) => formatTime(Date.now(), args[0] ?? "yyyy-MM-dd HH:mm:ss"),
  __timeShift: (args) => formatTime(Date.now() + Number(args[0] ?? 0) * 1000, args[1] ?? "yyyy-MM-dd HH:mm:ss"),
  __digest: (args, _ctx, w) => {
    const algo = args[0] ?? "md5";
    const input = args.slice(1).join(",");
    if (input.length > 1024 * 1024) return input;
    if (algo !== "md5" && algo !== "sha1" && algo !== "sha256") {
      w.warnings.push(`__digest 不支持算法 ${algo}`);
      return input;
    }
    return hashHex(algo, input);
  },
  __base64: (args) => Buffer.from(args.join(","), "utf8").toString("base64"),
  __urlEncode: (args) => encodeURIComponent(args.join(",")),
  __isVarDefined: (args, ctx) => String(ctx.hasVar ? ctx.hasVar(args[0] ?? "") : ctx.vars.has(args[0] ?? "")),
  __threadName: (args, ctx) => args[0] ?? ctx.vars.get("__scenario_name") ?? "",
};

// ── 数据函数（@func(arg)） ──
type DataFunc = (args: string[], ctx: FunctionCtx, w: FunctionWarnings) => string;
const DATA_FUNCS: Record<string, DataFunc> = {
  "@string": (args, ctx) =>
    Array.from({ length: Math.min(256, Math.max(1, Math.trunc(Number(args[0] ?? 8)))) }, () => CHARS[randInt(ctx, 0, 25)]).join(""),
  "@integer": (args, ctx) => String(randInt(ctx, Math.trunc(Number(args[0] ?? 1)), Math.trunc(Number(args[1] ?? 100)))),
  "@float": (args, ctx) => {
    const min = Number(args[0] ?? 0);
    const max = Number(args[1] ?? 1);
    return (min + randFloat(ctx) * (max - min)).toFixed(2);
  },
  "@name": (_args, ctx) => {
    const surname = SURNAMES[randInt(ctx, 0, SURNAMES.length - 1)] ?? "";
    const pool = randFloat(ctx) < 0.5 ? GIVEN1 : GIVEN2;
    const given = (pool[randInt(ctx, 0, pool.length - 1)] ?? "") + (randFloat(ctx) < 0.4 ? (GIVEN2[randInt(ctx, 0, GIVEN2.length - 1)] ?? "") : "");
    return surname + given;
  },
  "@email": (_args, ctx) => `${DATA_FUNCS["@string"]?.(["8"], ctx, { warnings: [] }) ?? ""}@${randPick(ctx, ["demo.io", "test.dev", "example.com"])}`,
  "@phone": (_args, ctx) => `13${randInt(ctx, 0, 9)}${randInt(ctx, 10000000, 99999999)}`,
  "@date": (args, ctx) => formatTime(randInt(ctx, Date.UTC(2020, 0, 1), Date.now()), args[0] ?? "yyyy-MM-dd"),
  "@datetime": (_args, ctx) => formatTime(randInt(ctx, Date.UTC(2020, 0, 1), Date.now()), "yyyy-MM-dd HH:mm:ss"),
  "@address": (_args, ctx) => randPick(ctx, PROVINCES),
  "@idcard": (_args, ctx) => {
    const region = randPick(ctx, ["110101", "310104", "440305", "510107"]); // 合规 6 位区划码前缀
    const y = randInt(ctx, 1960, 2005);
    const m = String(randInt(ctx, 1, 12)).padStart(2, "0");
    const d = String(randInt(ctx, 1, DAY_MONTHS[m] ?? 31)).padStart(2, "0");
    const seq = String(randInt(ctx, 1, 999)).padStart(3, "0");
    const base = `${region}${y}${m}${d}${seq}`;
    const W = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
    const CODES = "10X98765432";
    const sum = [...base].reduce((acc, ch, i) => acc + Number(ch) * (W[i] ?? 0), 0);
    return base + (CODES[sum % 11] ?? "");
  },
  "@regexp": (args, _ctx, w) => {
    try {
      const re = new RegExp(args[0] ?? "");
      const source = args[1] ?? "";
      const m = source.match(re);
      if (!m) {
        w.warnings.push(`@regexp 无匹配：${args[0]}`);
        return source;
      }
      return m[0];
    } catch {
      return args[1] ?? "";
    }
  },
  "@pick": (args, ctx) => (args.length ? randPick(ctx, args) : ""),
};

// ── 管道（${var|pipe}） ──
type Pipe = (value: string, args: string[]) => string;
const PIPES: Record<string, Pipe> = {
  md5: (v) => hashHex("md5", v),
  sha256: (v) => hashHex("sha256", v),
  base64: (v) => Buffer.from(v, "utf8").toString("base64"),
  substr: (v, a) => v.slice(Number(a[0] ?? 0), a[1] !== undefined ? Number(a[0]) + Number(a[1]) : undefined),
  toUpperCase: (v) => v.toUpperCase(),
  toLowerCase: (v) => v.toLowerCase(),
  trim: (v) => v.trim(),
  default: (v, a) => (v === "" ? (a[0] ?? "") : v),
};

/** 参数切分：a,b,c → ["a","b","c"]（支持 \, 转义字面逗号）。 */
function splitArgs(raw: string): string[] {
  if (!raw.trim()) return [];
  const out: string[] = [];
  let cur = "";
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === "\\" && raw[i + 1] === ",") {
      cur += ",";
      i++;
    } else if (raw[i] === ",") {
      out.push(cur.trim());
      cur = "";
    } else cur += raw[i];
  }
  out.push(cur.trim());
  return out;
}

function evalInner(inner: string, ctx: FunctionCtx, w: FunctionWarnings): string {
  const funcMatch = inner.match(/^(__[A-Za-z][A-Za-z0-9]*)\((.*)\)$/);
  if (funcMatch) {
    const fname = funcMatch[1] ?? "";
    const fn = ENGINE_FUNCS[fname];
    if (!fn) {
      w.warnings.push(`未知函数 ${fname}，原样保留`);
      return `\${${inner}}`;
    }
    try {
      return fn(splitArgs(funcMatch[2] ?? ""), ctx, w);
    } catch (e) {
      w.warnings.push(`函数 ${fname} 执行失败：${(e as Error).message}`);
      return `\${${inner}}`;
    }
  }
  const parts = inner.split("|").map((s) => s.trim());
  const name = parts.shift() ?? "";
  const raw = ctx.vars.get(name);
  if (raw === undefined) {
    w.warnings.push(`未定义变量 ${name}，原样保留`);
    return `\${${inner}}`;
  }
  let value = raw;
  for (const pipeExpr of parts) {
    const pm = pipeExpr.match(/^([A-Za-z][A-Za-z0-9]*)(?:\((.*)\))?$/);
    if (!pm) continue;
    const pipeName = pm[1] ?? "";
    const pipe = PIPES[pipeName];
    if (!pipe) {
      w.warnings.push(`未知管道 ${pipeName}`);
      continue;
    }
    value = pipe(value, pm[2] !== undefined ? splitArgs(pm[2]) : []);
  }
  return value;
}

/** 主渲染：三形态统一（${name|pipes} / ${__func(args)} / @func(args)），支持 \${ 与 @@ 转义。 */
export function renderFunctions(text: string, ctx: FunctionCtx, w: FunctionWarnings = { warnings: [] }): string {
  let out = text.replaceAll("\\${", "\u0000ESC_DOLLAR\u0000").replaceAll("@@", "\u0000ESC_AT\u0000");
  out = out.replace(/\$\{([^}]+)\}/g, (_m, inner: string) => evalInner(inner, ctx, w));
  out = out.replace(/@([A-Za-z][A-Za-z0-9]*)\(([^)]*)\)/g, (m, name: string, raw: string) => {
    const fn = DATA_FUNCS[`@${name}`];
    if (!fn) return m;
    try {
      return fn(splitArgs(raw), ctx, w);
    } catch {
      return m;
    }
  });
  return out.replaceAll("\u0000ESC_DOLLAR\u0000", "${").replaceAll("\u0000ESC_AT\u0000", "@");
}

// 函数目录抽至 function-catalog.ts（纯数据无 Node 依赖，客户端组件可直接 import）；
// 此处 re-export 保持 `@rabbit/shared/execution` 聚合出口兼容（引擎/单测不动）。
export { FUNCTION_CATALOG } from "./function-catalog";

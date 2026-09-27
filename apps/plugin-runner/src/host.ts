/**
 * 插件宿主（PLUG-001 §2）：上传插件 = worker_threads 每插件一线程（崩溃退避重启 1s/4s/16s，
 * 连续 3 次失败标记 ERROR）；内置插件随进程注册（同 SPI 契约，经统一 call 路由）。
 */
import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import type { CallResponse, PluginHandle, RunnerStatus } from "./types.js";

const WORKER_FILE = fileURLToPath(new URL("./worker-bootstrap.mjs", import.meta.url));
const CALL_TIMEOUT_MS = 30_000;

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

interface Slot {
  handle: PluginHandle;
  dir?: string;
  entry?: string;
  worker: Worker | null;
  pending: Map<string, Pending>;
  workerStatus: "RUNNING" | "STOPPED" | "ERROR";
  restarts: number;
  consecutiveFailures: number;
  lastError?: string;
  ready: Promise<void>;
}

/** 内置插件注册表（随进程直接可用；SPI 工厂由 builtins.ts 注入） */
const builtins = new Map<
  string,
  { handle: PluginHandle; call: (method: string, args: unknown[]) => Promise<unknown> }
>();
const slots = new Map<string, Slot>();

export function restartBackoffMs(failures: number): number {
  return [1000, 4000, 16000][Math.min(failures, 2)] ?? 16000;
}

function failAllPending(slot: Slot, message: string): void {
  for (const p of slot.pending.values()) {
    clearTimeout(p.timer);
    p.reject(new Error(message));
  }
  slot.pending.clear();
}

function bootWorker(slot: Slot): void {
  slot.pending = new Map();
  slot.worker = new Worker(WORKER_FILE);
  slot.workerStatus = "RUNNING";
  let markReady = () => {};
  slot.ready = new Promise<void>((r) => {
    markReady = r;
  });
  slot.worker.on("message", (res: CallResponse) => {
    if (res.id === "__load__") {
      if (res.ok) markReady();
      else {
        slot.workerStatus = "ERROR";
        slot.lastError = res.error?.message ?? "插件加载失败";
        markReady();
      }
      return;
    }
    const p = slot.pending.get(res.id);
    if (!p) return;
    slot.pending.delete(res.id);
    clearTimeout(p.timer);
    if (res.ok) p.resolve(res.result);
    else p.reject(new Error(res.error?.message ?? "插件调用失败"));
  });
  slot.worker.on("error", (err) => {
    slot.lastError = err.message;
    failAllPending(slot, err.message);
    scheduleRestart(slot);
  });
  slot.worker.on("exit", (code) => {
    if (code !== 0 && slot.workerStatus !== "STOPPED") {
      slot.lastError = slot.lastError ?? `worker 异常退出 code=${code}`;
      scheduleRestart(slot);
    }
  });
  slot.worker.postMessage({ id: "__load__", op: "load", dir: slot.dir, entry: slot.entry });
}

function scheduleRestart(slot: Slot): void {
  if (slot.workerStatus === "STOPPED") return;
  slot.consecutiveFailures += 1;
  if (slot.consecutiveFailures > 3) {
    slot.workerStatus = "ERROR";
    return;
  }
  slot.restarts += 1;
  setTimeout(
    () => {
      if (slot.workerStatus === "STOPPED") return;
      try {
        slot.worker?.terminate();
      } catch {
        /* 已退出 */
      }
      bootWorker(slot);
    },
    restartBackoffMs(slot.consecutiveFailures - 1),
  );
}

export async function loadPlugin(handle: PluginHandle, dir: string, entry: string): Promise<void> {
  if (slots.has(handle.pluginId)) throw new Error("插件已加载");
  const slot: Slot = {
    handle,
    dir,
    entry,
    worker: null,
    pending: new Map(),
    workerStatus: "RUNNING",
    restarts: 0,
    consecutiveFailures: 0,
    ready: Promise.resolve(),
  };
  slots.set(handle.pluginId, slot);
  bootWorker(slot);
  await slot.ready;
  if (slot.workerStatus === "ERROR") {
    slots.delete(handle.pluginId);
    throw new Error(slot.lastError ?? "插件加载失败");
  }
}

export function registerBuiltin(
  handle: PluginHandle,
  call: (method: string, args: unknown[]) => Promise<unknown>,
): void {
  builtins.set(handle.pluginId, { handle, call });
}

export async function unloadPlugin(pluginId: string): Promise<void> {
  const slot = slots.get(pluginId);
  if (slot) {
    slot.workerStatus = "STOPPED";
    failAllPending(slot, "插件已卸载");
    await slot.worker?.terminate();
    slots.delete(pluginId);
    return;
  }
  if (!builtins.delete(pluginId)) throw new Error("插件未加载");
}

export async function callPlugin(
  pluginId: string,
  method: string,
  args: unknown[],
): Promise<unknown> {
  const builtin = builtins.get(pluginId);
  if (builtin) return builtin.call(method, args);
  const slot = slots.get(pluginId);
  if (!slot) throw new Error(`插件未加载: ${pluginId}`);
  await slot.ready;
  if (!slot.worker) throw new Error(`插件 worker 不可用: ${pluginId}`);
  const worker = slot.worker;
  return new Promise((resolve, reject) => {
    const id = randomUUID();
    const timer = setTimeout(() => {
      slot.pending.delete(id);
      reject(new Error(`插件调用超时（${CALL_TIMEOUT_MS}ms）：${method}`));
    }, CALL_TIMEOUT_MS);
    slot.pending.set(id, { resolve, reject, timer });
    worker.postMessage({ id, op: "call", method, args });
  });
}

export function status(): RunnerStatus {
  return {
    status: "UP",
    spiVersion: "1.0",
    plugins: [
      ...[...builtins.values()].map((b) => ({
        ...b.handle,
        workerStatus: "RUNNING" as const,
        restarts: 0,
      })),
      ...[...slots.values()].map((s) => ({
        ...s.handle,
        workerStatus: s.workerStatus,
        restarts: s.restarts,
        lastError: s.lastError,
      })),
    ],
  };
}

export function findHandleByName(name: string): PluginHandle | undefined {
  return (
    [...builtins.values()].find((b) => b.handle.name === name)?.handle ??
    [...slots.values()].find((s) => s.handle.name === name)?.handle
  );
}

export const __test = { slots, bootWorker, scheduleRestart };

/**
 * websocket 协议插件（S-future PLUG-003 §2.1）：单 run 探活语义
 * 连接握手 → 发送 sendText/sendBinaryBase64（可选）→ 等待首条服务端消息 → close(1000)。
 * ok=连接+收包均成功；超时 code=1（引擎映射 504）、连接/异常 code=2（映射 502）。
 * 实现用 undici WebSocket（引擎既有依赖，esbuild bundle 自包含；Node 20 可用，不用全局 WebSocket——22 才稳定）。
 */
import { WebSocket } from "undici";

export interface WsConfig {
  url: string;
  sendText?: string;
  sendBinaryBase64?: string;
  timeoutMs?: number;
}

const WS_URL_RE = /^wss?:\/\/[^\s]+$/i;
const MAX_TIMEOUT_MS = 10_000;
const DEFAULT_TIMEOUT_MS = 5_000;
const BODY_MAX = 4096; // SPI 约束：bodyText ≤4KB

function isWsConfig(v: unknown): v is WsConfig {
  const c = v as WsConfig;
  if (typeof c?.url !== "string" || !WS_URL_RE.test(c.url)) return false;
  if (c.sendText !== undefined && typeof c.sendText !== "string") return false;
  if (c.sendBinaryBase64 !== undefined && typeof c.sendBinaryBase64 !== "string") return false;
  if (c.sendText !== undefined && c.sendBinaryBase64 !== undefined) return false; // 二选一
  if (
    c.timeoutMs !== undefined &&
    (typeof c.timeoutMs !== "number" || c.timeoutMs < 100 || c.timeoutMs > MAX_TIMEOUT_MS)
  )
    return false;
  return true;
}

/** 鸭子类型 configSchema（与 tcp-conn 同款：保持 bundle 零依赖，safeParse 契约一致） */
export const configSchema = { safeParse: (v: unknown) => ({ success: isWsConfig(v) }) };

function truncate(s: string): string {
  return s.length > BODY_MAX ? `${s.slice(0, BODY_MAX)}…[truncated ${s.length - BODY_MAX}]` : s;
}

export default function createWebsocketPlugin() {
  return {
    protocol: "websocket" as const,
    configSchema,
    buildSampler(config: unknown) {
      if (!isWsConfig(config))
        throw new Error(
          "websocket 配置非法：url（ws/wss）必填，sendText/sendBinaryBase64 二选一，timeoutMs 100-10000",
        );
      const cfg = config;
      return {
        run: () =>
          new Promise<{
            ok: boolean;
            code: number;
            bodyText: string;
            responseTimeMs: number;
            headers?: Record<string, string>;
          }>((resolve) => {
            const started = Date.now();
            const timeout = cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS;
            let settled = false;
            let ws: WebSocket;
            try {
              ws = new WebSocket(cfg.url);
            } catch (err) {
              resolve({
                ok: false,
                code: 2,
                bodyText: `url invalid: ${(err as Error).message}`,
                responseTimeMs: 0,
              });
              return;
            }
            // 默认 binaryType=blob 会把二进制帧包成 Blob（Buffer.from 不收）；arraybuffer 便于帧判别与 UTF-8 展示
            ws.binaryType = "arraybuffer";
            const finish = (
              ok: boolean,
              code: number,
              bodyText: string,
              headers?: Record<string, string>,
            ) => {
              if (settled) return;
              settled = true;
              clearTimeout(timer);
              // 发起关闭握手；探活语义不等待 close 帧（连接/首包已判定结果）
              try {
                ws.close(1000, "rabbit-done");
              } catch {
                /* 已关闭 */
              }
              resolve({
                ok,
                code,
                bodyText: truncate(bodyText),
                responseTimeMs: Date.now() - started,
                headers,
              });
            };
            const timer = setTimeout(
              () => finish(false, 1, `timeout after ${timeout}ms (waiting first message)`),
              timeout,
            );
            ws.addEventListener("open", () => {
              try {
                if (cfg.sendText !== undefined) ws.send(cfg.sendText);
                else if (cfg.sendBinaryBase64 !== undefined)
                  ws.send(Buffer.from(cfg.sendBinaryBase64, "base64"));
              } catch (err) {
                finish(false, 2, `send failed: ${(err as Error).message}`);
              }
            });
            ws.addEventListener("message", (ev: Event) => {
              // undici 类型面以 EventListener 暴露（ evt:Event ），MessageEvent 为运行时窄化
              const data = (ev as MessageEvent).data as string | ArrayBuffer | Buffer;
              let text: string;
              let frame: string;
              if (typeof data === "string") {
                text = data;
                frame = "text";
              } else {
                // 二进制帧（arraybuffer/Buffer）lossy UTF-8 展示（SPI：bodyText 文本语义）
                const bytes =
                  data instanceof ArrayBuffer
                    ? new Uint8Array(data)
                    : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
                text = Buffer.from(bytes).toString("utf8");
                frame = "binary";
              }
              finish(true, 0, text, { frame });
            });
            ws.addEventListener("close", (ev: Event) => {
              const e = ev as CloseEvent;
              finish(
                false,
                2,
                `closed before first message (code=${e.code}${e.reason ? ` ${e.reason}` : ""})`,
              );
            });
            ws.addEventListener("error", (ev: Event) => {
              finish(
                false,
                2,
                `connection error: ${(ev as ErrorEvent).message || "handshake/socket failure"}`,
              );
            });
          }),
      };
    },
  };
}

// 具名工厂导出：CJS bundle（undici 内联含 require，需 format=cjs——esbuild 单默认导出时 module.exports=fn 无 .default）
// 双加载器约定对齐（plugin-runner mod.default ?? mod.createPlugin / engine registry 同口径）
export { createWebsocketPlugin as createPlugin };

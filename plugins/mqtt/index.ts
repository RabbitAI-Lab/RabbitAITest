/**
 * mqtt 协议插件（S-future PLUG-003 §2.2）：单 run 探活语义（QoS0、clean session、mqtt:// 明文）。
 * CONNECT→CONNACK → SUBSCRIBE(topic)→SUBACK →（可选 PUBLISH）→ 等待订阅主题首条投递 → DISCONNECT。
 * 自研最小 MQTT 3.1.1 客户端（node:net 手工编解码），零新增 npm 依赖；QoS1/2、TLS(mqtts)、保留消息/遗嘱登记后续。
 * 超时 code=1（引擎映射 504）、连接/CONNACK 拒绝 code=2（映射 502）。
 */
import net from "node:net";

export interface MqttConfig {
  host: string;
  port?: number;
  clientId?: string;
  username?: string;
  password?: string;
  /** 订阅主题过滤器（支持 +/# 通配） */
  topic: string;
  /** 可选发布（缺省不发布；topic 缺省=订阅主题） */
  publish?: { topic?: string; payload?: string };
  timeoutMs?: number;
}

const MAX_TIMEOUT_MS = 10_000;
const DEFAULT_TIMEOUT_MS = 5_000;
const BODY_MAX = 4096;

function isMqttConfig(v: unknown): v is MqttConfig {
  const c = v as MqttConfig;
  if (typeof c?.host !== "string" || c.host.length === 0) return false;
  if (typeof c?.topic !== "string" || c.topic.length === 0 || c.topic.length > 65535) return false;
  if (c.port !== undefined && (!Number.isInteger(c.port) || c.port < 1 || c.port > 65535))
    return false;
  if (
    c.timeoutMs !== undefined &&
    (typeof c.timeoutMs !== "number" || c.timeoutMs < 100 || c.timeoutMs > MAX_TIMEOUT_MS)
  )
    return false;
  if (c.publish !== undefined) {
    const p = c.publish as { topic?: unknown; payload?: unknown };
    if (typeof p !== "object" || p === null) return false;
    if (p.topic !== undefined && typeof p.topic !== "string") return false;
    if (p.payload !== undefined && typeof p.payload !== "string") return false;
  }
  return true;
}

export const configSchema = { safeParse: (v: unknown) => ({ success: isMqttConfig(v) }) };

// ── MQTT 3.1.1 编解码 ──

/** 剩余长度 varint（1-4 字节，每字节低 7 位，MSB=继续） */
export function encodeRemainingLength(n: number): Buffer {
  const out: number[] = [];
  let x = n;
  do {
    let b = x % 128;
    x = Math.floor(x / 128);
    if (x > 0) b |= 0x80;
    out.push(b);
  } while (x > 0 && out.length < 4);
  return Buffer.from(out);
}

/** 读取剩余长度；返回 {value, bytes} 或 null（未收满） */
export function decodeRemainingLength(
  buf: Buffer,
  offset = 1,
): { value: number; bytes: number } | null {
  let multiplier = 1;
  let value = 0;
  let bytes = 0;
  for (;;) {
    if (offset + bytes >= buf.length) return null;
    const b = buf[offset + bytes]!;
    bytes += 1;
    value += (b & 0x7f) * multiplier;
    if ((b & 0x80) === 0) return { value, bytes: bytes + 1 }; // 含 fixed header 首字节共 bytes 字节头
    multiplier *= 128;
    if (bytes >= 4) return null;
  }
}

function encodeString(s: string): Buffer {
  const body = Buffer.from(s, "utf8");
  return Buffer.concat([Buffer.from([body.length >> 8, body.length & 0xff]), body]);
}

function packet(firstByte: number, body: Buffer): Buffer {
  return Buffer.concat([Buffer.from([firstByte]), encodeRemainingLength(body.length), body]);
}

function buildConnect(cfg: MqttConfig): Buffer {
  const clientId =
    cfg.clientId ?? `rabbit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  let flags = 0x02; // clean session
  const parts: Buffer[] = [encodeString("MQTT"), Buffer.from([0x04]), Buffer.from([0x00, 0x00])]; // 占位 flags/keepalive
  parts.push(encodeString(clientId));
  if (cfg.username !== undefined) {
    flags |= 0x80;
    parts.push(encodeString(cfg.username));
  }
  if (cfg.password !== undefined) {
    flags |= 0x40;
    parts.push(encodeString(cfg.password));
  }
  parts[2] = Buffer.from([flags, 0x3c]); // flags + keepalive 60s
  return packet(0x10, Buffer.concat(parts));
}

function buildSubscribe(filter: string, packetId = 1): Buffer {
  return packet(
    0x82,
    Buffer.concat([
      Buffer.from([packetId >> 8, packetId & 0xff]),
      encodeString(filter),
      Buffer.from([0x00]),
    ]),
  );
}

function buildPublishQos0(topic: string, payload: string): Buffer {
  return packet(0x30, Buffer.concat([encodeString(topic), Buffer.from(payload, "utf8")]));
}

const DISCONNECT = Buffer.from([0xe0, 0x00]);

export interface MqttIncoming {
  type: "connack" | "suback" | "publish" | "other";
  returnCode?: number; // connack
  granted?: number; // suback
  topic?: string; // publish
  payload?: string; // publish（UTF-8 lossy）
}

/** 从缓冲解析一帧；不足返回 null。成功时返回帧与总字节长（调用方负责截断缓冲）。 */
export function parseFrame(buf: Buffer): { frame: MqttIncoming; length: number } | null {
  if (buf.length < 2) return null;
  const rl = decodeRemainingLength(buf, 1);
  if (!rl) return null;
  const total = rl.bytes + rl.value;
  if (buf.length < total) return null;
  const type = buf[0]! >> 4;
  const body = buf.subarray(rl.bytes, total);
  if (type === 2) return { frame: { type: "connack", returnCode: body[1] ?? -1 }, length: total };
  if (type === 9) return { frame: { type: "suback", granted: body[2] ?? -1 }, length: total };
  if (type === 3) {
    // PUBLISH：qos 位（b0>>1)&0x03；qos>0 时 topic 后有 2 字节 packetId
    const qos = (buf[0]! >> 1) & 0x03;
    const topicLen = (body[0]! << 8) | body[1]!;
    const topic = body.subarray(2, 2 + topicLen).toString("utf8");
    let off = 2 + topicLen;
    if (qos > 0) off += 2; // 最小客户端不回 ACK（登记 QoS1/2 后续）；跳过 packetId 取 payload
    const payload = body.subarray(off).toString("utf8");
    return { frame: { type: "publish", topic, payload }, length: total };
  }
  return { frame: { type: "other" }, length: total };
}

/** 主题过滤器匹配（+ 单段、# 尾部通配含父级） */
export function topicMatches(filter: string, topic: string): boolean {
  const f = filter.split("/");
  const t = topic.split("/");
  let i = 0;
  for (; i < f.length; i++) {
    const seg = f[i]!;
    if (seg === "#") return true;
    if (i >= t.length) return false;
    if (seg !== "+" && seg !== t[i]) return false;
  }
  return i === t.length;
}

function truncate(s: string): string {
  return s.length > BODY_MAX ? `${s.slice(0, BODY_MAX)}…[truncated ${s.length - BODY_MAX}]` : s;
}

export default function createMqttPlugin() {
  return {
    protocol: "mqtt" as const,
    configSchema,
    buildSampler(config: unknown) {
      if (!isMqttConfig(config))
        throw new Error("mqtt 配置非法：host/topic 必填，port 1-65535，timeoutMs 100-10000");
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
            const port = cfg.port ?? 1883;
            let settled = false;
            let buffer = Buffer.alloc(0);
            const socket = net.createConnection({ host: cfg.host, port });
            const finish = (
              ok: boolean,
              code: number,
              bodyText: string,
              headers?: Record<string, string>,
            ) => {
              if (settled) return;
              settled = true;
              clearTimeout(timer);
              socket.destroy();
              resolve({
                ok,
                code,
                bodyText: truncate(bodyText),
                responseTimeMs: Date.now() - started,
                headers,
              });
            };
            const timer = setTimeout(() => finish(false, 1, `timeout after ${timeout}ms`), timeout);
            socket.on("error", (err) => finish(false, 2, `socket error: ${err.message}`));
            socket.on("connect", () => socket.write(buildConnect(cfg)));
            socket.on("data", (chunk: Buffer) => {
              buffer = Buffer.concat([buffer, chunk]);
              for (;;) {
                const parsed = parseFrame(buffer);
                if (!parsed) return;
                buffer = buffer.subarray(parsed.length);
                const f = parsed.frame;
                if (f.type === "connack") {
                  if (f.returnCode !== 0)
                    return finish(false, 2, `CONNACK rejected (rc=${f.returnCode})`);
                  socket.write(buildSubscribe(cfg.topic));
                } else if (f.type === "suback") {
                  if ((f.granted ?? -1) > 2)
                    return finish(false, 2, `SUBACK failure (granted=${f.granted})`);
                  const pub = cfg.publish;
                  if (pub)
                    socket.write(buildPublishQos0(pub.topic ?? cfg.topic, pub.payload ?? ""));
                } else if (f.type === "publish") {
                  // 只接受订阅主题上的投递（最小客户端不订阅其他主题，防御性匹配）
                  if (!topicMatches(cfg.topic, f.topic ?? "")) continue;
                  socket.write(DISCONNECT);
                  return finish(true, 0, f.payload ?? "", { topic: f.topic ?? cfg.topic });
                }
              }
            });
          }),
      };
    },
  };
}

// 具名工厂导出：与 websocket 插件同款双加载器约定（PLUG-003 §8 勘误 1 关联；esm bundle 下亦有 .default 兜底）
export { createMqttPlugin as createPlugin };

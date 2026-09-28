/**
 * /ws/echo WebSocket 回显端点（S-future PLUG-003 §4）：e2e/联调的确定性 ws 采样目标。
 * @hono/node-server 的 http server 挂 upgrade 监听，RFC6455 手工握手+帧回显（与引擎测试内嵌 echo 同构，零依赖）。
 */
import crypto from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

/** 结构化宿主（兼容 @hono/node-server 的 ServerType 与原生 http.Server） */
interface UpgradeHost {
  on(
    event: "upgrade",
    listener: (req: IncomingMessage, socket: Duplex, head: Buffer) => void,
  ): unknown;
}

export function mountWsEcho(server: UpgradeHost, path = "/ws/echo"): void {
  server.on("upgrade", (req, socket, head) => {
    const { pathname } = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    if (pathname !== path) {
      socket.destroy();
      return;
    }
    const key = req.headers["sec-websocket-key"];
    if (typeof key !== "string" || !key) {
      socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
      socket.destroy();
      return;
    }
    // SHA-1 为 RFC 6455 握手强制算法（协议一致性校验而非安全保护；Mimosa 弱算法告警登记 FP 台账）
    const accept = crypto
      .createHash("sha1")
      .update(key + WS_GUID)
      .digest("base64");
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    socket.write(head);
    handleEcho(socket);
  });
}

function handleEcho(socket: Duplex): void {
  let buffer = Buffer.alloc(0);
  socket.on("data", (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      const frame = parseClientFrame(buffer);
      if (!frame) return;
      buffer = buffer.subarray(frame.length);
      if (frame.opcode === 0x8) {
        socket.end(serverFrame(0x8, frame.payload.subarray(0, 2)));
        return;
      }
      if (frame.opcode === 0x9) {
        socket.write(serverFrame(0xa, frame.payload));
        continue;
      }
      if (frame.opcode === 0x1 || frame.opcode === 0x2)
        socket.write(serverFrame(frame.opcode, frame.payload));
    }
  });
  socket.on("error", () => socket.destroy());
}

function parseClientFrame(buf: Buffer): { opcode: number; payload: Buffer; length: number } | null {
  if (buf.length < 2) return null;
  const opcode = buf[0]! & 0x0f;
  const masked = (buf[1]! & 0x80) !== 0;
  let len = buf[1]! & 0x7f;
  let off = 2;
  if (len === 126) {
    if (buf.length < 4) return null;
    len = buf.readUInt16BE(2);
    off = 4;
  } else if (len === 127) {
    if (buf.length < 10) return null;
    const big = buf.readBigUInt64BE(2);
    if (big > BigInt(1024 * 1024)) return null; // 回显端点拒绝超大帧
    len = Number(big);
    off = 10;
  }
  const maskLen = masked ? 4 : 0;
  if (buf.length < off + maskLen + len) return null;
  let payload = buf.subarray(off + maskLen, off + maskLen + len);
  if (masked) {
    const key = buf.subarray(off, off + 4);
    const unmasked = Buffer.allocUnsafe(len);
    for (let i = 0; i < len; i++) unmasked[i] = payload[i]! ^ key[i % 4]!;
    payload = unmasked;
  }
  return { opcode, payload, length: off + maskLen + len };
}

/** 服务端帧不掩码（RFC 6455 §5.1） */
function serverFrame(opcode: number, payload: Buffer): Buffer {
  if (payload.length < 126)
    return Buffer.concat([Buffer.from([0x80 | opcode, payload.length]), payload]);
  const ext = Buffer.alloc(2);
  ext.writeUInt16BE(payload.length);
  return Buffer.concat([Buffer.from([0x80 | opcode, 126]), ext, payload]);
}

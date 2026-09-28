/**
 * 测试用 WebSocket echo 服务器（S-future PLUG-003-T1）：RFC6455 手工握手 + 帧回显，零依赖。
 * 与 apps/mock 的 /ws/echo 端点同构（两份实现各守边界：engine 不 import mock）。
 */
import http from "node:http";
import crypto from "node:crypto";

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

export interface WsEchoServer {
  port: number;
  close(): Promise<void>;
}

export function startWsEchoServer(port = 0): Promise<WsEchoServer> {
  const server = http.createServer((_req, res) => {
    res.writeHead(404).end();
  });
  server.on("upgrade", (req, socket) => {
    const key = req.headers["sec-websocket-key"];
    if (typeof key !== "string" || !key) {
      socket.destroy();
      return;
    }
    // SHA-1 为 RFC 6455 握手强制算法（Sec-WebSocket-Accept=base64(SHA1(key+GUID))）——协议一致性校验而非安全保护，
    // Mimosa 弱算法告警登记 FP 台账（docs/security/mimosa-fp-ledger.md，S-future PLUG-003）
    const accept = crypto
      .createHash("sha1")
      .update(key + WS_GUID)
      .digest("base64");
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    let buffer = Buffer.alloc(0);
    socket.on("data", (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      for (;;) {
        const frame = parseClientFrame(buffer);
        if (!frame) return;
        buffer = buffer.subarray(frame.length);
        if (frame.opcode === 0x8) {
          socket.write(serverFrame(0x8, frame.payload.subarray(0, 2)));
          socket.destroy();
          return;
        }
        if (frame.opcode === 0x9) {
          socket.write(serverFrame(0xa, frame.payload));
          continue;
        }
        if (frame.opcode === 0x1 || frame.opcode === 0x2) {
          socket.write(serverFrame(frame.opcode, frame.payload));
        }
      }
    });
    socket.on("error", () => socket.destroy());
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") return reject(new Error("no port"));
      resolve({
        port: addr.port,
        close: () => new Promise<void>((res) => server.close(() => res())),
      });
    });
  });
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
    if (big > BigInt(1024 * 1024)) return null; // 测试服务器拒绝超大帧
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

/** 服务端帧不掩码（RFC 6455 §5.1：客户端→服务端必掩码，服务端→客户端必不掩码） */
function serverFrame(opcode: number, payload: Buffer): Buffer {
  const head =
    payload.length < 126
      ? Buffer.from([0x80 | opcode, payload.length])
      : Buffer.from([0x80 | opcode, 126]);
  const ext =
    payload.length >= 126
      ? (() => {
          const b = Buffer.alloc(2);
          b.writeUInt16BE(payload.length);
          return b;
        })()
      : Buffer.alloc(0);
  return Buffer.concat([head, ext, payload]);
}

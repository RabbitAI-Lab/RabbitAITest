/**
 * PLUG-005 验收演示「真实目标」支撑进程（临时脚本，不入库）：
 * ① 真实 gRPC echo server（grpc-js，proto 同单测：Echo.Say/Fail/Slow）
 * ② 真实 SSH 服务（ssh2 Server——完整 SSH 协议实现，exec 回显）
 * ③ mongo 演示数据预置（plug005.items 三条）
 * ④ 就绪探针：等 rabbitmq:5672 / mongo:27017 可达
 * 用法：node .demo-targets-plug005.mjs（Ctrl-C 全部回收）
 */
import grpcPkg from "@grpc/grpc-js";
import protoLoaderPkg from "@grpc/proto-loader";
import ssh2 from "ssh2";
import { MongoClient } from "mongodb";
import net from "node:net";
import crypto from "node:crypto";

const { Server: GrpcServer, ServerCredentials, credentials, loadPackageDefinition, Metadata } = grpcPkg;
const grpc = grpcPkg;
const protoLoader = protoLoaderPkg;
const { Server: SshServer } = ssh2;

const GRPC_PORT = Number(process.env.DEMO_GRPC_PORT ?? 50051);
const SSH_PORT = Number(process.env.DEMO_SSH_PORT ?? 2222);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log("[demo-targets]", ...a);

// ── ① gRPC echo server ──
const PROTO = `syntax = "proto3";
package plug005;
service Echo {
  rpc Say (Req) returns (Res) {}
}
message Req { string text = 1; }
message Res { string text = 1; }
`;
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const protoPath = join(tmpdir(), `plug005-demo-${Date.now()}.proto`);
writeFileSync(protoPath, PROTO);
const pkgDef = protoLoader.loadSync(protoPath, { keepCase: true, longs: String, enums: String, defaults: true, oneofs: true });
const pkg = loadPackageDefinition(pkgDef).plug005;
const gserver = new GrpcServer();
gserver.addService(pkg.Echo.service, {
  Say: (call, cb) => cb(null, { text: `got:${call.request.text}` }),
});
const grpcPort = await new Promise((res) => {
  gserver.bindAsync(`127.0.0.1:${GRPC_PORT}`, ServerCredentials.createInsecure(), (_e, p) => res(p));
});
gserver.start();
log(`gRPC echo server on 127.0.0.1:${grpcPort}（unary Say → got:<text>）`);

// ── ② SSH 服务（真实 SSH 协议，exec 回显）──
const kp = crypto.generateKeyPairSync("ed25519");
const pkcs8 = kp.privateKey.export({ format: "der", type: "pkcs8" });
const seed = pkcs8.subarray(pkcs8.length - 32);
const pubDer = kp.publicKey.export({ format: "der", type: "spki" });
const pubKey = pubDer.subarray(pubDer.length - 32);
const str = (s) => {
  const b = Buffer.isBuffer(s) ? s : Buffer.from(s, "utf8");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(b.length);
  return Buffer.concat([len, b]);
};
const pubBlob = Buffer.concat([str("ssh-ed25519"), str(pubKey)]);
const check = crypto.randomBytes(4);
const privPayload = Buffer.concat([check, check, str("ssh-ed25519"), str(pubKey), str(Buffer.concat([seed, pubKey])), str("")]);
const padLen = 8 - (privPayload.length % 8);
const padding = Buffer.from(Array.from({ length: padLen === 8 ? 0 : padLen }, (_, i) => i + 1));
const privBlob = Buffer.concat([privPayload, padding]);
const openssh = Buffer.concat([
  Buffer.from("openssh-key-v1\0"),
  str("none"), str("none"), str(""),
  Buffer.from([0, 0, 0, 1]),
  str(pubBlob), str(privBlob),
]);
const b64 = openssh.toString("base64").replace(/.{1,70}/g, "$&\n");
const hostKeyPem = `-----BEGIN OPENSSH PRIVATE KEY-----\n${b64}\n-----END OPENSSH PRIVATE KEY-----\n`;
const sshServer = new SshServer({ hostKeys: [hostKeyPem] }, (client) => {
  client
    .on("authentication", (ctx) => {
      if (ctx.username === "demo" && (ctx.password === undefined || ctx.password === "rabbit-demo")) ctx.accept();
      else ctx.reject();
    })
    .on("ready", () => {
      client.on("session", (accept) => {
        accept().on("exec", (accept2, _reject, info) => {
          const s = accept2();
          s.write(`demo-host:${info.command}`);
          s.exit(0);
          setImmediate(() => s.end());
        });
      });
    })
    .on("error", () => {});
});
await new Promise((r) => sshServer.listen(SSH_PORT, "127.0.0.1", r));
log(`SSH 服务 on 127.0.0.1:${SSH_PORT}（user=demo / password=rabbit-demo，exec 回显 demo-host:<cmd>）`);

// ── ③ mongo 演示数据（容器就绪后预置）──
const waitTcp = async (host, port, label, tries = 60) => {
  for (let i = 0; i < tries; i++) {
    const ok = await new Promise((res) => {
      const s = net.connect({ host, port, timeout: 1500 }, () => {
        s.destroy();
        res(true);
      });
      s.on("error", () => res(false));
      s.on("timeout", () => {
        s.destroy();
        res(false);
      });
    });
    if (ok) {
      log(`${label} 可达（${host}:${port}）`);
      return true;
    }
    await sleep(2000);
  }
  return false;
};

if (await waitTcp("127.0.0.1", 27017, "mongo")) {
  const mc = new MongoClient("mongodb://127.0.0.1:27017", { serverSelectionTimeoutMS: 5000 });
  for (let i = 0; i < 10; i++) {
    try {
      await mc.connect();
      break;
    } catch {
      await sleep(3000);
    }
  }
  try {
    const coll = mc.db("plug005").collection("items");
    await coll.deleteMany({});
    await coll.insertMany([
      { name: "订单-1001", status: "PAID" },
      { name: "订单-1002", status: "PENDING" },
      { name: "订单-1003", status: "PAID" },
    ]);
    log("mongo 演示数据：plug005.items × 3 已预置");
  } catch (e) {
    log("mongo 预置失败：", e.message);
  }
  await mc.close().catch(() => {});
} else {
  log("mongo :27017 不可达（跳过预置）");
}
await waitTcp("127.0.0.1", 5672, "rabbitmq");

log("ALL TARGETS READY");
process.on("SIGINT", () => {
  gserver.forceShutdown();
  sshServer.close();
  process.exit(0);
});
setInterval(() => {}, 1 << 30);

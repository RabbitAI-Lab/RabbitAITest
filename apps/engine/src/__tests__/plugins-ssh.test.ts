/**
 * PLUG-005-T1：ssh 协议插件（内嵌 ssh2 Server——ed25519 临时 host key（现代算法）。
 * ssh2 只接受 OpenSSH 格式私钥（BEGIN OPENSSH PRIVATE KEY）；Node crypto 输出 PKCS8 PEM——
 * 用 ssh2 自带的 utils 生成 OpenSSH 格式（generatePrivateKey 辅助不可用时走 DER→OpenSSH 手工包装）。
 * 三态：回显/非零退出/认证拒绝。密钥仅测试进程内临时生成。
 */
import { describe, expect, it, afterAll, beforeAll } from "vitest";
import createSshPlugin from "../../../../plugins/ssh/index";
// ssh2 无自带类型（@types/ssh2 引入会牵动服务端回调签名矩阵——测试内嵌目标用结构化形态）
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ssh2 = (await import("ssh2")) as unknown as {
  Server: new (
    opts: unknown,
    cb: (client: unknown) => void,
  ) => {
    listen: (port: number, host: string, cb: () => void) => void;
    address: () => { port: number };
    close: () => void;
  };
};
const { Server: SshServer } = ssh2;
import crypto from "node:crypto";

let server: InstanceType<typeof SshServer>;
let port: number;

/** ed25519 host key：crypto 生成 PKCS8 → 提取 32B seed → 按 RFC8032 组合 OpenSSH 私钥格式（ssh2 parseKey 接受）。 */
function ed25519HostKeyOpenSsh(): string {
  const kp = crypto.generateKeyPairSync("ed25519");
  const pkcs8 = kp.privateKey.export({ format: "der", type: "pkcs8" });
  // PKCS8 DER 结构：版本(3B)+算法标识(5B: 1.3.101.112)+OCTET STRING(2B 头 + 34B 内容：04 20 + 32B seed)
  const seed = pkcs8.subarray(pkcs8.length - 32);
  const pubDer = kp.publicKey.export({ format: "der", type: "spki" });
  const pubKey = pubDer.subarray(pubDer.length - 32);
  // OpenSSH 私钥格式（PROTOCOL.key）："openssh-key-v1"\0 + ciphername("none") + kdfname("none") + kdfoptions("") +
  //   nkeys(1) + pubkey blob + 私钥块（checkint*2 + keytype + pubkey + privkey(64B: seed+pub) + comment + padding）
  const str = (s: string | Buffer) => {
    const b = Buffer.isBuffer(s) ? s : Buffer.from(s, "utf8");
    const len = Buffer.alloc(4);
    len.writeUInt32BE(b.length);
    return Buffer.concat([len, b]);
  };
  const pubBlob = Buffer.concat([str("ssh-ed25519"), str(pubKey)]);
  const check = crypto.randomBytes(4);
  const privPayload = Buffer.concat([
    check,
    check,
    str("ssh-ed25519"),
    str(pubKey),
    str(Buffer.concat([seed, pubKey])),
    str(""),
  ]);
  // 补 padding（1..n 至 8 对齐）
  const padLen = 8 - (privPayload.length % 8 || 8) === 0 ? 0 : 8 - (privPayload.length % 8);
  const padding = Buffer.from(Array.from({ length: padLen }, (_, i) => i + 1));
  const privBlob = Buffer.concat([privPayload, padding]);
  const openssh = Buffer.concat([
    Buffer.from("openssh-key-v1\0"),
    str("none"),
    str("none"),
    str(""),
    Buffer.from([0, 0, 0, 1]),
    str(pubBlob),
    str(privBlob),
  ]);
  const b64 = openssh.toString("base64").replace(/.{1,70}/g, "$&\n");
  return `-----BEGIN OPENSSH PRIVATE KEY-----\n${b64}\n-----END OPENSSH PRIVATE KEY-----\n`;
}

beforeAll(async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  server = new SshServer({ hostKeys: [ed25519HostKeyOpenSsh()] }, (client: any) => {
    client
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .on("authentication", (ctx: any) => {
        if (ctx.username === "rejected") ctx.reject();
        else ctx.accept();
      })
      .on("ready", () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        client.on("session", (accept: any) => {
          const session = accept();
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          session.on("exec", (accept2: any, _reject: any, info: any) => {
            const stream = accept2();
            const finish = (code: number, out: string, err?: string) => {
              stream.write(out);
              if (err) stream.stderr.write(err);
              stream.exit(code);
              // exit-status 与 EOF 同 tick 竞争会丢 code——延迟 end 让 exit-status 先出栈
              setImmediate(() => stream.end());
            };
            if (info.command.startsWith("fail")) finish(3, "", "boom");
            else finish(0, `echo:${info.command}`);
          });
        });
      })
      .on("error", () => {});
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  port = (server.address() as { port: number }).port;
});

afterAll(() => {
  server?.close();
});

const plugin = createSshPlugin();
const base = { host: "127.0.0.1", username: "u", authType: "password" as const, password: "p" };

describe("PLUG-005-T1 ssh 插件（内嵌 Server）", () => {
  it("契约：name=protocol 标识 + configSchema 合法/非法样本", () => {
    expect(plugin.protocol).toBe("ssh");
    expect(plugin.configSchema.safeParse({ ...base, port, command: "true" }).success).toBe(true);
    expect(plugin.configSchema.safeParse({ ...base, port, command: "" }).success).toBe(false);
    expect(
      plugin.configSchema.safeParse({
        host: "h",
        username: "u",
        authType: "password",
        command: "x",
      }).success,
    ).toBe(false); // 缺 password
  });

  it("exec 成功：回显命令输出，code=0", async () => {
    const r = await plugin
      .buildSampler({ ...base, port, command: "whoami", timeoutMs: 5000 })
      .run();
    expect(r.ok).toBe(true);
    expect(r.code).toBe(0);
    expect(r.bodyText).toBe("echo:whoami");
  });

  it("exit≠0：code=4 且 bodyText 带 exit 码与 stderr", async () => {
    const r = await plugin
      .buildSampler({ ...base, port, command: "fail-now", timeoutMs: 5000 })
      .run();
    expect(r.ok).toBe(false);
    expect(r.code).toBe(4);
    expect(r.bodyText).toContain("exit 3");
    expect(r.bodyText).toContain("boom");
  });

  it("认证拒绝：code=3", async () => {
    const r = await plugin
      .buildSampler({ ...base, port, username: "rejected", command: "true", timeoutMs: 5000 })
      .run();
    expect(r.ok).toBe(false);
    expect(r.code).toBe(3);
  });

  it("连接拒绝：code=2", async () => {
    const r = await plugin
      .buildSampler({ ...base, port: 1, command: "true", timeoutMs: 1000 })
      .run();
    expect(r.ok).toBe(false);
    expect(r.code).toBe(2);
  });
});

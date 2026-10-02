/**
 * amqp 协议插件（PLUG-005 §2.6）：amqplib（MIT，RabbitMQ 兼容；npm 官方来源）。
 * 单 run（MQTT 先例往返语义）：connect → 临时排他队列 → publish → get 首条自收 → ack → close。
 * e2e 真连目标=CI rabbitmq:3-alpine service（容器初始凭据与 embedded PG 同口径）。
 * configSchema=自写类型守卫（zod 不在插件依赖面）。
 */
import type { SamplerPlugin, SamplerResult, Sampler } from "../../packages/shared/src/plugins/spi";
import amqp from "amqplib";
import { raceTimeout, truncateBody } from "../../packages/shared/src/plugins/protocol-kit";

export interface AmqpConfig {
  url: string;
  routingKey?: string;
  exchange?: string;
  message: string;
  timeoutMs?: number;
}

function isAmqpConfig(v: unknown): v is AmqpConfig {
  const c = v as Partial<AmqpConfig>;
  if (typeof c?.url !== "string" || (!c.url.startsWith("amqp://") && !c.url.startsWith("amqps://")))
    return false;
  if (typeof c.message !== "string" || c.message.length === 0 || c.message.length > 4096)
    return false;
  if (c.routingKey !== undefined && (typeof c.routingKey !== "string" || c.routingKey.length > 256))
    return false;
  if (c.exchange !== undefined && (typeof c.exchange !== "string" || c.exchange.length > 256))
    return false;
  if (
    c.timeoutMs !== undefined &&
    (!Number.isInteger(c.timeoutMs) || c.timeoutMs < 100 || c.timeoutMs > 30_000)
  )
    return false;
  return true;
}

export const configSchema = { safeParse: (v: unknown) => ({ success: isAmqpConfig(v) }) };

export function createPlugin(): SamplerPlugin {
  return {
    protocol: "amqp",
    configSchema,
    buildSampler(config: unknown) {
      if (!isAmqpConfig(config)) throw new Error("amqp 配置非法");
      const cfg = config;
      const timeoutMs = cfg.timeoutMs ?? 10_000;
      const exchange = cfg.exchange ?? "";
      return {
        run: async (): Promise<SamplerResult> => {
          const started = Date.now();
          let conn: Awaited<ReturnType<typeof amqp.connect>> | null = null;
          try {
            conn = await raceTimeout(amqp.connect(cfg.url), timeoutMs, "连接");
            const ch = await conn.createChannel();
            // 临时排他队列（server 命名；自发自收=连通+路由+消费三态一并探活）
            const q = await ch.assertQueue("", { exclusive: true, autoDelete: true });
            const rk = cfg.routingKey ?? q.queue;
            if (exchange) await ch.bindQueue(q.queue, exchange, rk);
            if (exchange) ch.publish(exchange, rk, Buffer.from(cfg.message, "utf8"));
            else ch.sendToQueue(q.queue, Buffer.from(cfg.message, "utf8"), { persistent: false });
            const msg = await raceTimeout(
              (async () => {
                for (;;) {
                  const got = await ch.get(q.queue, { noAck: false });
                  if (got) return got;
                  await new Promise((r) => setTimeout(r, 50));
                }
              })(),
              timeoutMs,
              "等待投递",
            );
            if (msg) ch.ack(msg);
            await ch.close().catch(() => undefined);
            return {
              ok: true,
              code: 0,
              bodyText: truncateBody(msg ? msg.content.toString("utf8") : "投递为空"),
              responseTimeMs: Date.now() - started,
            };
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            return {
              ok: false,
              code: /超时/.test(msg) ? 1 : /ACCESS_REFUSED|403|authentication/i.test(msg) ? 3 : 2,
              bodyText: truncateBody(msg),
              responseTimeMs: Date.now() - started,
            };
          } finally {
            await conn?.close().catch(() => undefined);
          }
        },
      };
    },
  };
}

export default createPlugin;

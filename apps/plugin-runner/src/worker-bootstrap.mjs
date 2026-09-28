/**
 * worker_threads 入口（纯 JS：不经 ts 编译即可被 new Worker 启动；PLUG-001 §4）。
 * 消息协议见 types.ts：{id, op, method, args} → {id, ok, result | error}。
 * 生命周期：parentPort 收 load 后 dynamic import 插件 entry（预编译 js）；此后 call 直达插件对象。
 */
import { parentPort } from "node:worker_threads";

let plugin = null;

parentPort.on("message", async (msg) => {
  const reply = (payload) => parentPort.postMessage({ id: msg.id, ...payload });
  try {
    if (msg.op === "load") {
      const mod = await import(`${msg.dir}/${msg.entry}`);
      const factory = mod.default ?? mod.createPlugin;
      if (typeof factory !== "function")
        throw new Error("插件入口未导出 default/createPlugin 工厂");
      plugin = factory();
      reply({ ok: true, result: { loaded: true } });
      return;
    }
    if (msg.op === "unload") {
      plugin = null;
      reply({ ok: true, result: { unloaded: true } });
      return;
    }
    if (msg.op === "call") {
      if (!plugin) throw new Error("插件未加载");
      if (typeof plugin[msg.method] !== "function") throw new Error(`方法不存在: ${msg.method}`);
      const result = await plugin[msg.method](...(msg.args ?? []));
      reply({ ok: true, result });
      return;
    }
    throw new Error(`未知操作: ${msg.op}`);
  } catch (err) {
    reply({ ok: false, error: { message: err instanceof Error ? err.message : String(err) } });
  }
});

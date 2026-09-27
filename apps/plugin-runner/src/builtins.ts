/**
 * 内置插件（PLUG-001 §1.2）：platform-echo —— SPI 全方法确定性实现，
 * 用于 PLUG-001 生命周期验收与 INTG 联调演示（无三方网络）。
 */
import type { PluginHandle } from "./types";
import { registerBuiltin } from "./host";

export const ECHO_HANDLE: PluginHandle = {
  pluginId: "builtin-echo",
  name: "platform-echo",
  kind: "platform",
  version: "1.0.0",
  spiVersion: "1.0",
  platform: "echo",
  builtin: true,
};

let seq = 0;

export function registerEchoBuiltin(): void {
  registerBuiltin(ECHO_HANDLE, async (method, args) => {
    switch (method) {
      case "testConnection":
        return { ok: true, account: "echo-bot" };
      case "createIssue": {
        seq += 1;
        const payload = args[1] as { title?: string };
        return { platformKey: `ECHO-${1000 + seq}`, url: undefined, echoTitle: payload?.title };
      }
      case "updateIssue":
        return { platformKey: String(args[1]), echoUpdated: true };
      case "syncBugs":
        return [
          { platformKey: "ECHO-1001", title: "echo bug", status: "resolved", updatedAt: new Date().toISOString() },
        ];
      case "fieldMapping":
        return [
          { localField: "title", platformField: "summary", required: true },
          { localField: "description", platformField: "description", required: false },
        ];
      default:
        throw new Error(`方法不存在: ${method}`);
    }
  });
}

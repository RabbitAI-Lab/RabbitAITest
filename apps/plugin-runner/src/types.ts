/** runner ↔ worker 消息协议与命令面类型（PLUG-001 §4）。 */

export interface CallRequest {
  id: string;
  op: "load" | "unload" | "call";
  pluginId?: string;
  dir?: string; // load：解包后的插件目录绝对路径
  method?: string;
  args?: unknown[];
}

export interface CallResponse {
  id: string;
  ok: boolean;
  result?: unknown;
  error?: { message: string; code?: number };
}

export interface PluginHandle {
  pluginId: string;
  name: string;
  kind: string;
  version: string;
  spiVersion: string;
  protocol?: string;
  platform?: string;
  builtin: boolean;
}

export interface RunnerStatus {
  status: "UP";
  spiVersion: string;
  plugins: Array<PluginHandle & { workerStatus: "RUNNING" | "STOPPED" | "ERROR"; restarts: number; lastError?: string }>;
}

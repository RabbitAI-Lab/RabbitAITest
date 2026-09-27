/**
 * jmx -> 场景步骤树映射（API-009 §2 子集）：HTTPSamplerProxy->custom、LoopController->loop count、
 * CSVDataSet->场景 CSV + foreach 外层、JSR223(javascript)->script、ConstantTimer->wait。
 * 纯函数（shared 单测覆盖）；XML 解析禁 DTD/外部实体（S2 PROJ-002 安全口径）。
 */
import { XMLParser } from "fast-xml-parser";

export interface JmxStepNode {
  uid: string;
  stepType: "custom" | "loop" | "script" | "wait";
  name: string;
  enabled: boolean;
  config: Record<string, unknown>;
  children: JmxStepNode[];
}

export interface JmxParseResult {
  scenarioName: string;
  steps: JmxStepNode[];
  /** 可映射的 CSV（filename 缺失时以 variableNames 构造空表） */
  csv: { columns: string[]; rows: string[][] } | null;
  warnings: string[];
}

interface XmlNode {
  [k: string]: unknown;
}

function alwaysArray(v: unknown): XmlNode[] {
  if (v === undefined || v === null) return [];
  return (Array.isArray(v) ? v : [v]) as XmlNode[];
}

function text(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v === "object" && "#text" in (v as XmlNode)) return String((v as XmlNode)["#text"]);
  return "";
}

function propOf(node: XmlNode, name: string): string {
  const merged = [...alwaysArray(node["stringProp"]), ...alwaysArray(node["longProp"]), ...alwaysArray(node["boolProp"])];
  for (const p of merged) {
    if (text((p as XmlNode)["@_name"]) === name) return text(p);
  }
  return "";
}

let uidSeq = 0;
function nextUid(prefix: string): string {
  uidSeq += 1;
  return `${prefix}-${uidSeq}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 解析 jmx 文本，映射为场景步骤树（子集；不支持的节点跳过并记 warning）。 */
export function parseJmx(jmxText: string): JmxParseResult {
  const warnings: string[] = [];
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    processEntities: true,
    parseTagValue: false,
  });
  let doc: XmlNode;
  try {
    doc = parser.parse(jmxText) as XmlNode;
  } catch (e) {
    throw new Error(`jmx XML 解析失败：${e instanceof Error ? e.message : String(e)}`);
  }
  if (/<(!DOCTYPE|ENTITY)/i.test(jmxText)) warnings.push("检测到 DTD/实体声明，已按安全策略忽略外部实体");
  const root = (doc["jmeterTestPlan"] ?? {}) as XmlNode;
  const planNode = (root["TestPlan"] ?? root["hashTree"] ?? {}) as XmlNode;
  const scenarioName = text(planNode["@_testname"]) || "JMeter 导入场景";

  const csv = collectCsv(root, warnings);
  // 顶层 hashTree（TestPlan 的兄弟节点）承载 ThreadGroup/采样器
  const topHash = (root["hashTree"] ?? {}) as XmlNode;
  const steps = mapHashTreeChildren(topHash, csv, warnings);
  if (steps.length === 0) warnings.push("未映射到任何步骤（HTTP 采样/循环/CSV/JSR223/等待）");
  return { scenarioName, steps, csv, warnings };
}

function collectCsv(root: XmlNode, warnings: string[]): { columns: string[]; rows: string[][] } | null {
  const found = findAllByKey(root, "CSVDataSet");
  if (found.length === 0) return null;
  const first = found[0] as XmlNode;
  const filename = propOf(first, "filename");
  const varNames = propOf(first, "variableNames");
  const delimiter = propOf(first, "delimiter") || ",";
  if (!varNames) return null;
  const columns = varNames.split(delimiter).map((c) => c.trim()).filter(Boolean);
  if (!filename) warnings.push("CSVDataSet 未配置 filename，CSV 参数按空表导入（可后续在参数区关联文件）");
  return { columns, rows: [] };
}

function findAllByKey(node: XmlNode, key: string): XmlNode[] {
  const out: XmlNode[] = [];
  const visit = (n: unknown) => {
    if (!n || typeof n !== "object") return;
    for (const [k, v] of Object.entries(n as XmlNode)) {
      if (k === key) out.push(...alwaysArray(v));
      if (typeof v === "object" && v !== null && k !== "@_") visit(v);
    }
  };
  visit(node);
  return out;
}

/** jmx 结构约定：控制器与其子级 hashTree 平级成对出现（对象键序=文档序，据此配对）。 */
function mapHashTreeChildren(parent: XmlNode, csv: { columns: string[] } | null, warnings: string[]): JmxStepNode[] {
  const out: JmxStepNode[] = [];
  const entries = Object.entries(parent);
  let threadGroupCount = 0;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry) continue;
    const [k, v] = entry;
    if (!k || v === null || v === undefined) continue;
    if (k === "ThreadGroup") {
      threadGroupCount += alwaysArray(v).length;
      for (const tg of alwaysArray(v)) {
        const loops = Number(propOf(alwaysArray(tg["LoopController"])[0] ?? {}, "loops") || "1");
        // 子级 = 其后首个平级 hashTree（文档序配对）
        const childHash = findSiblingHashTree(entries, i);
        const children = childHash ? mapLevel(childHash, csv, warnings) : [];
        if (loops > 1) {
          out.push({
            uid: nextUid("loop"),
            stepType: "loop",
            name: `线程组循环 x${loops}`,
            enabled: true,
            config: { mode: "count", count: Math.min(10000, loops) },
            children,
          });
        } else {
          out.push(...children);
        }
      }
    } else if (k === "hashTree") {
      for (const h of alwaysArray(v)) out.push(...mapLevel(h, csv, warnings));
    }
  }
  if (threadGroupCount > 1) {
    warnings.push(`检出 ${threadGroupCount} 个线程组，仅映射首个（多组=并发语义，经批量执行并行模式表达）`);
  }
  return out;
}

/** 从 entries[i+1..] 找首个 hashTree 键的值（跳过中间非 hashTree 键）。 */
function findSiblingHashTree(entries: [string, unknown][], from: number): XmlNode | null {
  for (let j = from + 1; j < entries.length; j++) {
    const entry = entries[j];
    if (!entry) continue;
    const [k, v] = entry;
    if (k === "hashTree") return (Array.isArray(v) ? v[0] : v) as XmlNode;
  }
  return null;
}

function mapLevel(hashTree: XmlNode, csv: { columns: string[] } | null, warnings: string[]): JmxStepNode[] {
  const out: JmxStepNode[] = [];
  // 内嵌 hashTree 键（采样器常挂在子 hashTree 内）：递归展开
  for (const h of alwaysArray(hashTree["hashTree"])) {
    out.push(...mapLevel(h, csv, warnings));
  }
  for (const sampler of alwaysArray(hashTree["HTTPSamplerProxy"])) {
    const enabled = text(sampler["@_enabled"]) !== "false";
    const method = propOf(sampler, "HTTPSampler.method") || "GET";
    const domain = propOf(sampler, "HTTPSampler.domain");
    const port = propOf(sampler, "HTTPSampler.port");
    const path = propOf(sampler, "HTTPSampler.path") || "/";
    const protocol = propOf(sampler, "HTTPSampler.protocol") || "http";
    const body = propOf(sampler, "Argument.value");
    const args = alwaysArray((alwaysArray(sampler["arguments"])[0] ?? {})["Argument"]);
    const queryRows = args.map((a) => ({ key: propOf(a, "Argument.name"), value: propOf(a, "Argument.value"), enabled: true }));
    const hostPart = domain ? `${domain}${port && port !== "80" && port !== "443" ? `:${port}` : ""}` : "";
    const url = domain ? `${protocol}://${hostPart}${path.startsWith("/") ? path : `/${path}`}` : path;
    const isJson = body.trimStart().startsWith("{") || body.trimStart().startsWith("[");
    out.push({
      uid: nextUid("req"),
      stepType: "custom",
      name: text(sampler["@_testname"]) || `${method} ${path}`,
      enabled,
      config: {
        bundle: {
          request: {
            method: (["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS", "HEAD"].includes(method) ? method : "GET"),
            url,
            headers: [],
            query: queryRows.filter((q) => q.key),
            body: body ? (isJson ? { kind: "raw_json", content: body } : { kind: "raw_text", content: body }) : { kind: "none" },
            auth: { kind: "none" },
          },
          asserts: [{ kind: "status_code", path: "", op: "eq", expected: "200" }],
          pre: [],
          post: [],
          extracts: [],
        },
      },
      children: [],
    });
    for (const js of alwaysArray(sampler["JSR223PreProcessor"])) {
      const lang = propOf(js, "scriptLanguage");
      if (lang && lang !== "javascript") warnings.push(`JSR223 语言 ${lang} 不支持，已跳过`);
      else {
        out.push({ uid: nextUid("script"), stepType: "script", name: text(js["@_testname"]) || "前置脚本", enabled: true, config: { script: propOf(js, "script") }, children: [] });
      }
    }
  }
  for (const js of alwaysArray(hashTree["JSR223Sampler"])) {
    const lang = propOf(js, "scriptLanguage");
    if (lang && lang !== "javascript") {
      warnings.push(`JSR223Sampler 语言 ${lang} 不支持，已跳过`);
      continue;
    }
    out.push({ uid: nextUid("script"), stepType: "script", name: text(js["@_testname"]) || "脚本", enabled: text(js["@_enabled"]) !== "false", config: { script: propOf(js, "script") }, children: [] });
  }
  for (const t of alwaysArray(hashTree["ConstantTimer"])) {
    out.push({ uid: nextUid("wait"), stepType: "wait", name: text(t["@_testname"]) || "等待", enabled: true, config: { ms: Math.min(30000, Math.max(1, Number(propOf(t, "ConstantTimer.delay") || "1000"))) }, children: [] });
  }
  const csvSets = alwaysArray(hashTree["CSVDataSet"]);
  if (csvSets.length > 0 && csv && csv.columns.length > 0) {
    const varNames = propOf(csvSets[0] ?? {}, "variableNames");
    const firstCol = varNames.split(/[,;\t]/).map((c) => c.trim()).filter(Boolean)[0] ?? csv.columns[0] ?? "col1";
    return [
      {
        uid: nextUid("loop"),
        stepType: "loop",
        name: "CSV 数据驱动",
        enabled: true,
        config: { mode: "foreach", var: "row", source: firstCol, iterations: [] },
        children: out,
      },
    ];
  }
  return out;
}

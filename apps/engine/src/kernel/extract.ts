/** API-004 kernel：参数提取（正则/JSONPath × 首个/随机/第N个）。 */
import { JSONPath } from "jsonpath-plus";
import type { Extractor, ExtractResult } from "@rabbit/shared/execution";

export function runExtractors(
  extractors: Extractor[],
  input: { bodyText: string; headers: { key: string; value: string }[] },
): ExtractResult[] {
  const out: ExtractResult[] = [];
  for (const ex of extractors) {
    const value = extractOne(ex, input);
    if (value !== undefined) out.push({ variable: ex.variable, value, scope: ex.scope });
  }
  return out;
}

function extractOne(
  ex: Extractor,
  input: { bodyText: string; headers: { key: string; value: string }[] },
): string | undefined {
  const matches =
    ex.source === "body" ? bodyMatches(ex, input.bodyText) : headerMatches(ex, input.headers);
  if (matches.length === 0) return undefined;
  if (ex.match === "first") return matches[0];
  if (ex.match === "random") return matches[Math.floor(Math.random() * matches.length)];
  const idx = ex.index ?? 1;
  return matches[idx - 1];
}

function bodyMatches(ex: Extractor, bodyText: string): string[] {
  if (ex.kind === "regex") {
    const re = safeRegex(ex.expression);
    if (!re) return [];
    return [...bodyText.matchAll(re)].map((m) => (m[1] !== undefined ? m[1] : m[0]));
  }
  try {
    const json = JSON.parse(bodyText);
    const results = JSONPath({ path: ex.expression, json, wrap: true }) as unknown[];
    return results.map((v) =>
      typeof v === "object" && v !== null ? JSON.stringify(v) : String(v),
    );
  } catch {
    return [];
  }
}

/** headers 提取：expression=头名（大小写不敏感）→ 取值；kind 仅对 body 生效（正则/JSONPath） */
function headerMatches(ex: Extractor, headers: { key: string; value: string }[]): string[] {
  const hit = headers.find((h) => h.key.toLowerCase() === ex.expression.toLowerCase());
  return hit ? [hit.value] : [];
}

function safeRegex(expr: string): RegExp | undefined {
  try {
    return new RegExp(expr, "g");
  } catch {
    return undefined;
  }
}

import { z } from "zod";
import { csvTableSchema, type CsvTable } from "./schemas";

/** CSV 解析（API-007 §4）：UTF-8 文本 → {columns, rows}；坏行跳过并计数（容忍策略）。 */
export interface CsvParseResult extends CsvTable {
  skippedRows: number;
  warnings: string[];
}

/** CSV 存储形态（Scenario.config.params.csv）：来源/解析配置。 */
export const csvSourceSchema = z.object({
  source: z.enum(["file", "inline"]),
  fileId: z.string().uuid().optional(),
  inlineText: z
    .string()
    .max(512 * 1024)
    .optional(),
  delimiter: z.enum([",", ";", "\t"]).default(","),
  hasHeader: z.boolean().default(true),
});
export type CsvSource = z.infer<typeof csvSourceSchema>;

const MAX_ROWS = 10000;
const MAX_COLS = 200;

/** RFC4180 简化子集：引号包裹字段（内含分隔符/引号转义 ""）；行分隔 \n 或 \r\n。 */
export function parseCsv(
  text: string,
  opts: { delimiter: string; hasHeader: boolean },
): CsvParseResult {
  const warnings: string[] = [];
  const rowsRaw = splitRows(text);
  if (!rowsRaw.length)
    return {
      ...csvTableSchema.parse({ columns: [], rows: [] }),
      skippedRows: 0,
      warnings: ["空文件"],
    };

  let columns: string[];
  let dataRows: string[][];
  if (opts.hasHeader) {
    columns = normalizeColumns(splitLine(rowsRaw.shift() ?? "", opts.delimiter));
    dataRows = rowsRaw.map((l) => splitLine(l, opts.delimiter));
  } else {
    const first = splitLine(rowsRaw[0] ?? "", opts.delimiter);
    columns = first.map((_, i) => `col${i + 1}`);
    dataRows = rowsRaw.map((l) => splitLine(l, opts.delimiter));
  }
  if (columns.length > MAX_COLS) {
    warnings.push(`列数 ${columns.length} 超上限 ${MAX_COLS}，截断`);
    columns = columns.slice(0, MAX_COLS);
  }

  const rows: string[][] = [];
  let skipped = 0;
  for (const row of dataRows) {
    if (row.length === 1 && row[0] === "") continue; // 空行静默跳过
    if (row.length !== columns.length) {
      skipped++;
      if (warnings.length < 5)
        warnings.push(`列数不一致行已跳过（期望 ${columns.length} 列，实际 ${row.length}）`);
      continue;
    }
    if (rows.length >= MAX_ROWS) {
      warnings.push(`行数达上限 ${MAX_ROWS}，截断`);
      break;
    }
    rows.push(row.map((c) => c.slice(0, 8192)));
  }
  return { columns, rows, skippedRows: skipped, warnings };
}

function splitRows(text: string): string[] {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .filter((l, i, arr) => !(l === "" && i === arr.length - 1));
}

function splitLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

function normalizeColumns(cols: string[]): string[] {
  const seen = new Map<string, number>();
  return cols.map((c) => {
    const base = c.trim() || "col";
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n === 0 ? base : `${base}_${n + 1}`;
  });
}

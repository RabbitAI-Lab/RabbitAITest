"use client";

/** EXEC-003 内置函数库提示浮层：FUNCTION_CATALOG 三组（engine / data / pipe），点击插入语法。 */
import { Popover } from "antd";
import { FunctionSquare } from "lucide-react";
import { FUNCTION_CATALOG } from "@rabbit/shared/execution/function-catalog";

const GROUP_LABEL: Record<string, string> = {
  engine: "引擎函数",
  data: "数据函数（@mock）",
  pipe: "管道处理",
};

export default function FunctionHintPopover({ onInsert }: { onInsert?: (syntax: string) => void }) {
  const groups = ["engine", "data", "pipe"] as const;
  const content = (
    <div className="max-h-[420px] w-[520px] overflow-y-auto">
      <p className="mb-2 text-xs text-[#87888D]">
        渲染优先级：步骤提取 &gt; 步骤参数 &gt; 场景参数 &gt; 环境变量；管道用 `|` 叠加（如 `&#123;var|md5&#125;` 语义）
      </p>
      {groups.map((g) => {
        const items = FUNCTION_CATALOG.filter((f) => f.group === g);
        if (!items.length) return null;
        return (
          <div key={g} className="mb-3">
            <p className="mb-1 text-xs font-medium text-[#3D4350]">{GROUP_LABEL[g]}</p>
            <div className="grid grid-cols-2 gap-1">
              {items.map((f) => (
                <button
                  key={f.name}
                  type="button"
                  data-testid={`fn-hint-${f.name}`}
                  className="rounded border border-[#F0F1F3] bg-white px-2 py-1 text-left hover:border-[#574BFF]/40 hover:bg-[#574BFF]/5"
                  onClick={() => onInsert?.(f.syntax)}
                >
                  <code className="block font-mono text-[11px] text-[#574BFF]">{f.syntax}</code>
                  <span className="block truncate text-[11px] text-[#87888D]">{f.description}</span>
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
  return (
    <Popover content={content} title="内置函数库（EXEC-003）" trigger="click" placement="bottomRight">
      <Buttonish />
    </Popover>
  );
}

/** 触发按钮（小图标 + 「函数」），独立避免 Popover children 重新挂载警告。 */
function Buttonish() {
  return (
    <span
      data-testid="fn-hint-trigger"
      className="inline-flex cursor-pointer items-center gap-1 text-xs text-[#574BFF] hover:opacity-80"
    >
      <FunctionSquare size={14} strokeWidth={1.8} />
      函数
    </span>
  );
}

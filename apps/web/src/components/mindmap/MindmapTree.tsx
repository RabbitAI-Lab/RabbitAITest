"use client";

/**
 * CASE-007 通用脑图受控组件（用例脑图 / 计划脑图执行复用）。
 *
 * 受控 props：nodes/focusId/collapsed/selected 全由父组件持有；
 * 组件只负责：布局调用（layoutMindmap）、SVG 连线、按 kind 渲染节点卡、
 * 点击=focus、Ctrl+点击=增选、双击=进入（focus+展开）、折叠三角切换，
 * 并把语义动作以 onCommand 上抛（进入/删除/重命名/导航由父组件实现）。
 * PLAN-003 复用时通过 renderNodeLabel 注入状态色节点与 S/E/B 徽标。
 */

import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { layoutMindmap, type MindmapNode } from "./layout";

export type MindmapDirection = "up" | "down" | "left" | "right";

export interface MindmapCommand {
  type: "enter-sibling" | "child" | "delete" | "rename" | "navigate";
  direction?: MindmapDirection;
  nodeId: string;
}

export interface MindmapTreeProps {
  nodes: MindmapNode[];
  focusId: string | null;
  collapsed: Set<string>;
  selected: Set<string>;
  /** 搜索命中高亮节点 id 集（可选） */
  highlightIds?: Set<string>;
  /** 自定义节点内容（默认按 kind 渲染：模块/用例/步骤） */
  renderNodeLabel?: (n: MindmapNode) => ReactNode;
  onFocus: (id: string) => void;
  onToggleCollapse: (id: string) => void;
  onSelect?: (id: string, additive: boolean) => void;
  onCommand: (cmd: MindmapCommand) => void;
}

export type { MindmapNode } from "./layout";

/** 画布内容留白（节点/连线坐标均在此基础上偏移） */
const CANVAS_PAD = 24;

const LEVEL_COLOR: Record<string, string> = {
  P0: "#F87171",
  P1: "#FA8C16",
  P2: "#60A5FA",
  P3: "#C0C4CC",
};

export function MindmapTree(props: MindmapTreeProps) {
  const {
    nodes,
    focusId,
    collapsed,
    selected,
    highlightIds,
    renderNodeLabel,
    onFocus,
    onToggleCollapse,
    onSelect,
    onCommand,
  } = props;
  const canvasRef = useRef<HTMLDivElement>(null);

  const layout = useMemo(() => layoutMindmap(nodes, { collapsed }), [nodes, collapsed]);

  const childCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of nodes) {
      if (n.parentId !== null) m.set(n.parentId, (m.get(n.parentId) ?? 0) + 1);
    }
    return m;
  }, [nodes]);

  /** 折叠节点隐藏的后代数（折叠徽标） */
  const hiddenCount = useMemo(() => {
    const kids = new Map<string, string[]>();
    for (const n of nodes) {
      if (n.parentId !== null) {
        const arr = kids.get(n.parentId) ?? [];
        arr.push(n.id);
        kids.set(n.parentId, arr);
      }
    }
    const memo = new Map<string, number>();
    const count = (id: string): number => {
      const hit = memo.get(id);
      if (hit !== undefined) return hit;
      memo.set(id, 0); // 防环
      let c = 0;
      for (const k of kids.get(id) ?? []) c += 1 + count(k);
      memo.set(id, c);
      return c;
    };
    const out = new Map<string, number>();
    for (const id of collapsed) out.set(id, count(id));
    return out;
  }, [nodes, collapsed]);

  // focus 变化时滚动到可见（键盘导航体验）
  useEffect(() => {
    if (!focusId || !canvasRef.current) return;
    const el = canvasRef.current.querySelector(`[data-testid="mindmap-node-${focusId}"]`);
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [focusId]);

  const defaultLabel = (n: MindmapNode): ReactNode => {
    if (n.kind === "step") {
      return (
        <span className="flex flex-col min-w-0 flex-1 leading-tight">
          <span className="truncate">{n.label}</span>
          <span className="truncate text-[10px] text-[#87888D]">
            预期：{n.meta?.step?.expect || "—"}
          </span>
        </span>
      );
    }
    if (n.kind === "case") {
      const lv = n.meta?.level ?? "P3";
      return (
        <span className="flex items-center gap-1.5 min-w-0">
          <span className="truncate">{n.label}</span>
          <span className="shrink-0 text-[10px] font-medium" style={{ color: LEVEL_COLOR[lv] }}>
            {lv}
          </span>
          {n.badge && <span className="shrink-0 text-[10px] text-[#FA8C16]">{n.badge}</span>}
        </span>
      );
    }
    if (n.kind === "module") {
      return (
        <span className="flex items-center gap-1.5 min-w-0">
          <span className="truncate">{n.label}</span>
          {typeof n.meta?.caseCount === "number" && (
            <span className="shrink-0 text-[10px] text-[#6366F1]">({n.meta.caseCount})</span>
          )}
          {n.badge && <span className="shrink-0 text-[10px] text-[#FA8C16]">{n.badge}</span>}
        </span>
      );
    }
    return (
      <span className="flex items-center gap-1.5">
        <span className="truncate font-medium">{n.label}</span>
        {typeof n.meta?.caseCount === "number" && (
          <span className="text-[10px] text-white/70">{n.meta.caseCount}</span>
        )}
      </span>
    );
  };

  const boxClass = (
    n: MindmapNode,
    isFocus: boolean,
    isSelected: boolean,
    isHl: boolean,
  ): string => {
    const ring = isSelected
      ? "ring-2 ring-[#574BFF]"
      : isFocus
        ? "ring-2 ring-[#574BFF]/50"
        : isHl
          ? "ring-2 ring-[#FBBF24]"
          : "";
    const base = "absolute flex items-center cursor-pointer select-none rounded transition-shadow ";
    switch (n.kind) {
      case "root":
        return `${base} bg-[#574BFF] text-white border border-[#574BFF] rounded-md font-medium px-3 text-[13px] ${ring}`;
      case "module":
        return `${base} bg-[#EEF2FF] text-[#1F2329] border border-[#A5B4FC] rounded-md px-3 font-medium text-[13px] ${ring}`;
      case "case":
        return `${base} bg-white text-[#1F2329] border border-[#E5E6EB] border-l-[3px] px-2.5 text-[13px] ${ring}`;
      default:
        return `${base} bg-white text-[#1F2329] border border-[#E5E6EB] px-2 text-[11px] ${ring}`;
    }
  };

  const innerW = layout.width + CANVAS_PAD * 2;
  const innerH = layout.height + CANVAS_PAD * 2;

  return (
    <div
      ref={canvasRef}
      data-testid="mindmap-canvas"
      className="relative flex-1 min-w-0 min-h-0 overflow-auto bg-[#FAFBFC]"
    >
      <div className="relative" style={{ width: innerW, height: innerH, minWidth: "100%" }}>
        <svg
          className="absolute inset-0 pointer-events-none"
          width={innerW}
          height={innerH}
          aria-hidden
        >
          {layout.edges.map((e) => (
            <path
              key={`${e.from}->${e.to}`}
              d={e.path}
              fill="none"
              stroke="#CBD5E1"
              strokeWidth={1.5}
            />
          ))}
        </svg>
        {layout.positioned.map((p) => {
          const n = p.node;
          const isFocus = focusId === n.id;
          const isSelected = selected.has(n.id);
          const isHl = highlightIds?.has(n.id) ?? false;
          const kids = childCount.get(n.id) ?? 0;
          const isCollapsed = collapsed.has(n.id);
          return (
            <div
              key={n.id}
              data-testid={`mindmap-node-${n.id}`}
              className={boxClass(n, isFocus, isSelected, isHl)}
              style={{
                left: p.x + CANVAS_PAD,
                top: p.y + CANVAS_PAD,
                width: p.w,
                minHeight: p.h,
                ...(n.kind === "case"
                  ? { borderLeftColor: LEVEL_COLOR[n.meta?.level ?? "P3"] ?? LEVEL_COLOR.P3 }
                  : {}),
              }}
              title={n.label}
              onClick={(e) => {
                onSelect?.(n.id, e.ctrlKey || e.metaKey);
                onFocus(n.id);
              }}
              onDoubleClick={(e) => {
                e.preventDefault();
                onFocus(n.id);
                // 双击=进入：折叠则先展开
                if (kids > 0 && isCollapsed) onToggleCollapse(n.id);
                onCommand({ type: "child", nodeId: n.id });
              }}
            >
              <span className="flex items-center gap-1 min-w-0 flex-1">
                {renderNodeLabel ? renderNodeLabel(n) : defaultLabel(n)}
                {isSelected && <span className="shrink-0 text-[#574BFF] text-[10px]">✓</span>}
              </span>
              {kids > 0 && (
                <button
                  type="button"
                  data-testid={`mindmap-toggle-${n.id}`}
                  title={isCollapsed ? `展开（${hiddenCount.get(n.id) ?? 0} 个隐藏节点）` : "折叠"}
                  className="absolute -right-2.5 top-1/2 -translate-y-1/2 min-w-5 h-5 px-0.5 rounded-full border border-[#D5D8DE] bg-white text-[#646A73] flex items-center justify-center shadow-sm hover:border-[#574BFF] hover:text-[#574BFF] z-10"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleCollapse(n.id);
                  }}
                >
                  {isCollapsed ? (
                    <>
                      <ChevronRight size={11} />
                      {(hiddenCount.get(n.id) ?? 0) > 0 && (
                        <span className="text-[9px] leading-none px-0.5">
                          {hiddenCount.get(n.id)}
                        </span>
                      )}
                    </>
                  ) : (
                    <ChevronDown size={11} />
                  )}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

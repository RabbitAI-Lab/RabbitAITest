"use client";

/**
 * 场景步骤树编辑面板（API-006 画板二左侧）：受控树 + 行内操作
 * （启停 / 复制 / 加子级 / 上移下移 / 删除 / ref 步骤单步执行）。
 * 树结构不可变更新；uid 为前端稳定键。
 */
import { Button, Dropdown } from "antd";
import { ChevronDown, ChevronRight, Copy, Play, Plus, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { ScenarioStepNode } from "@rabbit/shared";

export type StepType = ScenarioStepNode["stepType"];

/** 类型徽标：颜色对齐原型（循环紫 / 引用蓝 / 场景青 / 脚本琥珀 / 等待灰）。 */
export const STEP_META: Record<StepType, { label: string; color: string; container: boolean }> = {
  ref_api: { label: "接口", color: "#1677FF", container: false },
  ref_case: { label: "用例", color: "#2F54EB", container: false },
  ref_scenario: { label: "场景", color: "#13C2C2", container: false },
  custom: { label: "自定义", color: "#646A73", container: false },
  loop: { label: "循环", color: "#722ED1", container: true },
  condition: { label: "条件", color: "#9254DE", container: true },
  once: { label: "仅一次", color: "#597EF7", container: true },
  script: { label: "脚本", color: "#FA8C16", container: false },
  wait: { label: "等待", color: "#87888D", container: false },
};

export const STEP_TYPE_ORDER: StepType[] = [
  "ref_api",
  "ref_case",
  "ref_scenario",
  "custom",
  "loop",
  "condition",
  "once",
  "script",
  "wait",
];

export function newUid(): string {
  return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** 各类型步骤默认值（custom 的 bundle 保留最小合法 RequestSpec，编辑器内再补全）。 */
export function makeStep(stepType: StepType): ScenarioStepNode {
  const meta = STEP_META[stepType];
  const base: ScenarioStepNode = {
    uid: newUid(),
    stepType,
    name: meta.label,
    enabled: true,
    config: {},
    children: [],
  };
  switch (stepType) {
    case "ref_api":
    case "ref_case":
    case "ref_scenario":
      return { ...base, name: `引用${meta.label}`, config: { refId: "" } };
    case "custom":
      return {
        ...base,
        name: "自定义请求",
        config: {
          bundle: {
            request: {
              method: "GET",
              url: "",
              headers: [],
              query: [],
              body: { kind: "none" },
              auth: { kind: "none" },
            },
            asserts: [],
            pre: [],
            post: [],
            extracts: [],
          },
        },
      };
    case "loop":
      return { ...base, name: "循环", config: { mode: "count", count: 1 } };
    case "condition":
      return { ...base, name: "条件", config: { expression: "" } };
    case "once":
      return { ...base, name: "仅一次", config: {} };
    case "script":
      return { ...base, name: "脚本", config: { script: "" } };
    case "wait":
      return { ...base, name: "等待", config: { ms: 1000 } };
  }
}

// ── 不可变树操作 ──

export function findNode(nodes: ScenarioStepNode[], uid: string): ScenarioStepNode | undefined {
  for (const n of nodes) {
    if (n.uid === uid) return n;
    const hit = findNode(n.children, uid);
    if (hit) return hit;
  }
  return undefined;
}

function mapTree(
  nodes: ScenarioStepNode[],
  fn: (n: ScenarioStepNode) => ScenarioStepNode,
): ScenarioStepNode[] {
  return nodes.map((n) => fn({ ...n, children: mapTree(n.children, fn) }));
}

function removeNode(nodes: ScenarioStepNode[], uid: string): ScenarioStepNode[] {
  const out: ScenarioStepNode[] = [];
  for (const n of nodes) {
    if (n.uid === uid) continue;
    out.push({ ...n, children: removeNode(n.children, uid) });
  }
  return out;
}

function regenUid(n: ScenarioStepNode): ScenarioStepNode {
  return { ...n, uid: newUid(), children: n.children.map(regenUid) };
}

/** 在 parentUid（null=根）的子级 index 处插入；缺省追加到末尾。 */
function insertInto(
  nodes: ScenarioStepNode[],
  parentUid: string | null,
  node: ScenarioStepNode,
  index?: number,
): ScenarioStepNode[] {
  if (parentUid === null) {
    const next = [...nodes];
    next.splice(index ?? next.length, 0, node);
    return next;
  }
  return nodes.map((n) => {
    if (n.uid === parentUid) {
      const children = [...n.children];
      children.splice(index ?? children.length, 0, node);
      return { ...n, children };
    }
    return { ...n, children: insertInto(n.children, parentUid, node, index) };
  });
}

/** 求节点在父子级中的位置（parentUid + index），未命中返回 null。 */
function locate(
  nodes: ScenarioStepNode[],
  uid: string,
  parent: string | null = null,
): { parentUid: string | null; index: number } | null {
  for (let i = 0; i < nodes.length; i++) {
    const cur = nodes[i]!;
    if (cur.uid === uid) return { parentUid: parent, index: i };
    const hit = locate(cur.children, uid, cur.uid);
    if (hit) return hit;
  }
  return null;
}

function siblingsOf(nodes: ScenarioStepNode[], parentUid: string | null): ScenarioStepNode[] {
  if (parentUid === null) return nodes;
  const p = findNode(nodes, parentUid);
  return p ? p.children : [];
}

export interface StepTreePanelProps {
  steps: ScenarioStepNode[];
  onChange: (steps: ScenarioStepNode[]) => void;
  selectedUid: string | null;
  onSelect: (uid: string | null) => void;
  canEdit: boolean;
  /** ref_api / ref_case 步骤的单步调试入口（引擎侧以 adhoc 单步任务执行）。 */
  onStepDebug?: (uid: string) => void;
}

export default function StepTreePanel({
  steps,
  onChange,
  selectedUid,
  onSelect,
  canEdit,
  onStepDebug,
}: StepTreePanelProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggleCollapse = (uid: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });
  };

  const act = {
    toggleEnabled: (uid: string) =>
      onChange(mapTree(steps, (n) => (n.uid === uid ? { ...n, enabled: !n.enabled } : n))),
    duplicate: (uid: string) => {
      const loc = locate(steps, uid);
      const node = findNode(steps, uid);
      if (!loc || !node) return;
      onChange(insertInto(steps, loc.parentUid, regenUid({ ...node }), loc.index + 1));
    },
    remove: (uid: string) => {
      onChange(removeNode(steps, uid));
      if (selectedUid === uid) onSelect(null);
    },
    moveUp: (uid: string) => {
      const loc = locate(steps, uid);
      if (!loc || loc.index === 0) return;
      const sibs = [...siblingsOf(steps, loc.parentUid)];
      const n = sibs.splice(loc.index, 1)[0]!;
      sibs.splice(loc.index - 1, 0, n);
      onChange(replaceSiblings(removeNode(steps, uid), loc.parentUid, sibs));
    },
    moveDown: (uid: string) => {
      const loc = locate(steps, uid);
      if (!loc) return;
      const sibs = siblingsOf(steps, loc.parentUid);
      if (loc.index >= sibs.length - 1) return;
      const arr = [...sibs];
      const n = arr.splice(loc.index, 1)[0]!;
      arr.splice(loc.index + 1, 0, n);
      onChange(replaceSiblings(removeNode(steps, uid), loc.parentUid, arr));
    },
    addChild: (parentUid: string | null, t: StepType) => {
      const node = makeStep(t);
      onChange(insertInto(steps, parentUid, node));
      if (parentUid)
        setCollapsed((prev) => {
          const n2 = new Set(prev);
          n2.delete(parentUid);
          return n2;
        });
      onSelect(node.uid);
    },
  };

  const addMenu = (parentUid: string | null, testid: string) => (
    <Dropdown
      trigger={["click"]}
      menu={{
        items: STEP_TYPE_ORDER.map((t) => ({ key: t, label: `${STEP_META[t].label}步骤` })),
        onClick: ({ key }) => act.addChild(parentUid, key as StepType),
      }}
    >
      <Button type="link" size="small" className="!px-1 !text-[#574BFF]" data-testid={testid}>
        <Plus size={13} strokeWidth={1.8} />
        {parentUid === null ? "根步骤" : "子步骤"}
      </Button>
    </Dropdown>
  );

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="step-tree-panel">
      <div className="flex items-center gap-2 border-b border-[#F0F1F3] px-3 py-2">
        <span className="text-xs font-medium text-[#1F2329]">步骤树</span>
        <span className="text-[11px] text-[#A8ABB0]">{countSteps(steps)} 步</span>
        <div className="ml-auto flex items-center gap-1">
          {canEdit && addMenu(null, "btn-add-root-step")}
          <Button
            type="link"
            size="small"
            className="!px-1 !text-[#646A73]"
            onClick={() => setCollapsed(new Set(allUids(steps)))}
            data-testid="btn-collapse-all"
          >
            收起
          </Button>
          <Button
            type="link"
            size="small"
            className="!px-1 !text-[#646A73]"
            onClick={() => setCollapsed(new Set())}
            data-testid="btn-expand-all"
          >
            展开全部
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {steps.length === 0 ? (
          <div className="flex h-full min-h-[160px] items-center justify-center text-xs text-[#A8ABB0]">
            暂无步骤——点击「根步骤」开始编排（引用接口 / 用例 / 场景、循环、条件等 9 类）
          </div>
        ) : (
          steps.map((n) => (
            <StepRow
              key={n.uid}
              node={n}
              depth={0}
              steps={steps}
              act={act}
              canEdit={canEdit}
              selectedUid={selectedUid}
              onSelect={onSelect}
              collapsed={collapsed}
              onToggleCollapse={toggleCollapse}
              addMenu={addMenu}
              onStepDebug={onStepDebug}
            />
          ))
        )}
      </div>
    </div>
  );
}

/** 用替换后的兄弟数组重建树（moveUp / moveDown 用）。 */
function replaceSiblings(
  nodes: ScenarioStepNode[],
  parentUid: string | null,
  sibs: ScenarioStepNode[],
): ScenarioStepNode[] {
  if (parentUid === null) return sibs;
  return nodes.map((n) =>
    n.uid === parentUid
      ? { ...n, children: sibs }
      : { ...n, children: replaceSiblings(n.children, parentUid, sibs) },
  );
}

export function countSteps(nodes: ScenarioStepNode[]): number {
  return nodes.reduce((acc, n) => acc + 1 + countSteps(n.children), 0);
}

function allUids(nodes: ScenarioStepNode[]): string[] {
  return nodes.flatMap((n) => [n.uid, ...allUids(n.children)]);
}

interface RowProps {
  node: ScenarioStepNode;
  depth: number;
  steps: ScenarioStepNode[];
  act: {
    toggleEnabled: (uid: string) => void;
    duplicate: (uid: string) => void;
    remove: (uid: string) => void;
    moveUp: (uid: string) => void;
    moveDown: (uid: string) => void;
    addChild: (parentUid: string | null, t: StepType) => void;
  };
  canEdit: boolean;
  selectedUid: string | null;
  onSelect: (uid: string | null) => void;
  collapsed: Set<string>;
  onToggleCollapse: (uid: string) => void;
  addMenu: (parentUid: string | null, testid: string) => ReactNode;
  onStepDebug?: (uid: string) => void;
}

function StepRow(p: RowProps) {
  const { node, depth, act, canEdit } = p;
  const meta = STEP_META[node.stepType];
  const selected = p.selectedUid === node.uid;
  const hasChildren = node.children.length > 0;
  const isCollapsed = p.collapsed.has(node.uid);
  const refId = (node.config as { refId?: string }).refId;

  return (
    <div>
      <div
        data-testid={`step-row-${node.uid}`}
        className={`group flex items-center gap-1.5 rounded border px-2 py-1.5 ${
          selected ? "border-[#574BFF]/30 bg-[#574BFF]/5" : "border-transparent hover:bg-[#F7F8FA]"
        } ${node.enabled ? "" : "opacity-50"}`}
        style={{ marginLeft: depth * 18 }}
        onClick={() => p.onSelect(node.uid)}
      >
        {meta.container ? (
          <button
            type="button"
            className="shrink-0 text-[#87888D]"
            onClick={(e) => {
              e.stopPropagation();
              p.onToggleCollapse(node.uid);
            }}
          >
            {isCollapsed ? (
              <ChevronRight size={13} strokeWidth={1.8} />
            ) : (
              <ChevronDown size={13} strokeWidth={1.8} />
            )}
          </button>
        ) : (
          <span className="w-[13px] shrink-0" />
        )}
        <span
          className="h-4 w-[3px] shrink-0 rounded-sm"
          style={{ background: node.enabled ? meta.color : "#C9CDD4" }}
        />
        <span
          className="shrink-0 rounded-sm px-1 py-px text-[10px] leading-4"
          style={{ color: meta.color, background: `${meta.color}14` }}
          data-testid={`step-type-${node.uid}`}
        >
          {meta.label}
        </span>
        <span
          className={`min-w-0 flex-1 truncate text-xs ${node.enabled ? "text-[#1F2329]" : "text-[#87888D] line-through"}`}
          data-testid={`step-name-${node.uid}`}
        >
          {node.name || meta.label}
        </span>
        {node.stepType.startsWith("ref_") && (
          <span className="shrink-0 border-b border-dashed border-[#A8ABB0] text-[10px] text-[#87888D]">
            {refId ? "引用" : "未选目标"}
          </span>
        )}
        <span
          className="hidden shrink-0 items-center gap-0.5 group-hover:flex"
          onClick={(e) => e.stopPropagation()}
        >
          {canEdit &&
            node.stepType !== "ref_scenario" &&
            p.onStepDebug &&
            (node.stepType === "ref_api" || node.stepType === "ref_case") && (
              <IconBtn
                title="单步执行"
                testid={`btn-step-debug-${node.uid}`}
                onClick={() => p.onStepDebug?.(node.uid)}
              >
                <Play size={12} strokeWidth={1.8} />
              </IconBtn>
            )}
          {canEdit && (
            <IconBtn
              title={node.enabled ? "禁用" : "启用"}
              testid={`btn-step-toggle-${node.uid}`}
              onClick={() => act.toggleEnabled(node.uid)}
            >
              <span className="text-[10px]">{node.enabled ? "禁" : "启"}</span>
            </IconBtn>
          )}
          {canEdit && (
            <IconBtn
              title="复制"
              testid={`btn-step-copy-${node.uid}`}
              onClick={() => act.duplicate(node.uid)}
            >
              <Copy size={12} strokeWidth={1.8} />
            </IconBtn>
          )}
          {canEdit && meta.container && p.addMenu(node.uid, `btn-add-child-${node.uid}`)}
          {canEdit && (
            <>
              <IconBtn
                title="上移"
                testid={`btn-step-up-${node.uid}`}
                onClick={() => act.moveUp(node.uid)}
              >
                <ChevronRight size={12} strokeWidth={1.8} className="-rotate-90" />
              </IconBtn>
              <IconBtn
                title="下移"
                testid={`btn-step-down-${node.uid}`}
                onClick={() => act.moveDown(node.uid)}
              >
                <ChevronRight size={12} strokeWidth={1.8} className="rotate-90" />
              </IconBtn>
              <IconBtn
                title="删除"
                testid={`btn-step-del-${node.uid}`}
                danger
                onClick={() => act.remove(node.uid)}
              >
                <Trash2 size={12} strokeWidth={1.8} />
              </IconBtn>
            </>
          )}
        </span>
      </div>
      {!isCollapsed && hasChildren && (
        <div>
          {node.children.map((c) => (
            <StepRow key={c.uid} {...p} node={c} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

function IconBtn({
  title,
  testid,
  onClick,
  danger,
  children,
}: {
  title: string;
  testid: string;
  onClick: () => void;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      data-testid={testid}
      className={`flex h-5 w-5 items-center justify-center rounded hover:bg-[#E5E6EB] ${danger ? "text-[#FF4D4F]" : "text-[#646A73]"}`}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {children}
    </button>
  );
}

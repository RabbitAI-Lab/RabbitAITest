/**
 * CASE-007 脑图右向树布局（纯函数，可单测）。
 *
 * 约定：
 * - 根在最左，逐层向右：x = depth * (nodeWidth + depthGap)；
 * - 同父子块自上而下按输入序堆叠（siblingGap 垂直间隔），父节点垂直居中于子块中点；
 * - 无子或折叠（collapsed 命中）的节点占单行高，其子树不参与布局；
 * - 连边为水平方向三次贝塞尔 path 字符串（供 SVG 直接渲染）；
 * - 叶子顺序稳定（输入序），同输入必得同输出（可快照测试）。
 */

export interface MindmapNode {
  id: string;
  parentId: string | null;
  kind: "root" | "module" | "case" | "step";
  label: string;
  badge?: string;
  meta?: { level?: string; caseCount?: number; step?: { desc: string; expect: string } };
}

export interface PositionedNode {
  node: MindmapNode;
  x: number;
  y: number;
  w: number;
  h: number;
  depth: number;
}

export interface MindmapEdge {
  from: string;
  to: string;
  path: string;
}

export interface MindmapLayoutResult {
  positioned: PositionedNode[];
  edges: MindmapEdge[];
  height: number;
  width: number;
}

export interface MindmapLayoutOptions {
  /** 折叠节点 id 集合：命中者按叶子处理（子树不参与布局） */
  collapsed?: Set<string>;
  nodeWidth?: number;
  rowHeight?: number;
  /** 相邻层级水平间距 */
  depthGap?: number;
  /** 同父相邻子块垂直间距，默认 rowHeight * 0.6 */
  siblingGap?: number;
}

export const MINDMAP_LAYOUT_DEFAULTS = {
  nodeWidth: 220,
  rowHeight: 44,
  depthGap: 48,
} as const;

export function layoutMindmap(
  nodes: MindmapNode[],
  opts?: MindmapLayoutOptions,
): MindmapLayoutResult {
  const collapsed = opts?.collapsed ?? new Set<string>();
  const nodeWidth = opts?.nodeWidth ?? MINDMAP_LAYOUT_DEFAULTS.nodeWidth;
  const rowHeight = opts?.rowHeight ?? MINDMAP_LAYOUT_DEFAULTS.rowHeight;
  const depthGap = opts?.depthGap ?? MINDMAP_LAYOUT_DEFAULTS.depthGap;
  const siblingGap = opts?.siblingGap ?? Math.round(rowHeight * 0.6);

  const ids = new Set(nodes.map((n) => n.id));
  const childrenOf = new Map<string, MindmapNode[]>();
  const roots: MindmapNode[] = [];
  for (const n of nodes) {
    // 父 id 不在节点集内（孤儿）按根处理，保证节点不丢失
    const pid = n.parentId !== null && ids.has(n.parentId) ? n.parentId : null;
    if (pid === null) {
      roots.push(n);
    } else {
      const list = childrenOf.get(pid);
      if (list) list.push(n);
      else childrenOf.set(pid, [n]);
    }
  }

  const positioned: PositionedNode[] = [];
  const posById = new Map<string, PositionedNode>();
  const edges: MindmapEdge[] = [];
  const visited = new Set<string>();
  let maxBottom = 0;
  let maxRight = 0;

  /** 放置 node 的子树块，返回块高度。top 为块顶边的 y 坐标。 */
  const place = (node: MindmapNode, depth: number, top: number): number => {
    if (visited.has(node.id)) return 0; // 防御：重复 id / 环
    visited.add(node.id);

    const x = depth * (nodeWidth + depthGap);
    const kids = collapsed.has(node.id) ? [] : (childrenOf.get(node.id) ?? []);

    let span: number;
    if (kids.length === 0) {
      span = rowHeight;
    } else {
      let cursor = top;
      let childrenSpan = 0;
      let first = true;
      for (const kid of kids) {
        if (!first) {
          cursor += siblingGap;
          childrenSpan += siblingGap;
        }
        first = false;
        const childSpan = place(kid, depth + 1, cursor);
        cursor += childSpan;
        childrenSpan += childSpan;
      }
      span = childrenSpan;
    }

    const y = kids.length === 0 ? top : top + (span - rowHeight) / 2;
    const p: PositionedNode = { node, x, y, w: nodeWidth, h: rowHeight, depth };
    positioned.push(p);
    posById.set(node.id, p);
    if (y + rowHeight > maxBottom) maxBottom = y + rowHeight;
    if (x + nodeWidth > maxRight) maxRight = x + nodeWidth;

    if (kids.length > 0) {
      const x1 = x + nodeWidth;
      const y1 = y + rowHeight / 2;
      const dx = depthGap / 2;
      for (const kid of kids) {
        const cp = posById.get(kid.id);
        if (!cp) continue;
        const x2 = cp.x;
        const y2 = cp.y + rowHeight / 2;
        edges.push({
          from: node.id,
          to: kid.id,
          path: `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`,
        });
      }
    }
    return span;
  };

  let cursor = 0;
  let first = true;
  for (const root of roots) {
    if (!first) cursor += siblingGap;
    first = false;
    cursor += place(root, 0, cursor);
  }

  return { positioned, edges, height: maxBottom, width: maxRight };
}

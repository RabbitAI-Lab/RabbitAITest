"use client";

/**
 * CASE-007 用例页「脑图」视图：模块→用例→步骤三层层级树。
 *
 * 数据装配：moduleApi.list + caseApiV2.list（pageSize=100——列表契约上限，循环翻页取全量）→ 本地工作树
 * （临时节点 tmp-*、重命名/删除标记、步骤内联于用例节点）；编辑即写本地树，
 * 「保存」收集 diff 调 mindmapApi.save 批量提交；失败/冲突保留本地树。
 * 快捷键体系（Enter/Tab/Ctrl+Enter/M/C/Backspace/F2/方向键/Esc）见 useMindmapKeyboard。
 * 只读（无 PROJECT_CASE:UPDATE）隐藏工具条并禁用快捷键。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Empty, Input, Select, Tag } from "antd";
import { FilePlus2, FolderPlus, Plus, Save, Trash2, Undo2 } from "lucide-react";
import {
  caseApiV2,
  mindmapApi,
  moduleApi,
  type CaseRowV2,
  type ModuleNodeDto,
} from "@rabbit/api-client";
import type { MindmapSave } from "@rabbit/shared";
import { useProjectStore } from "@/stores/project";
import { usePermissions } from "@/hooks/usePermissions";
import { useApp } from "@/hooks/useApp";
import { layoutMindmap, type MindmapNode } from "./layout";
import { MindmapTree, type MindmapCommand } from "./MindmapTree";
import { useMindmapKeyboard, type MindmapKey } from "./useMindmapKeyboard";

const ROOT_ID = "__root__";
const STEP_SEP = "::s";
const MAX_STEPS = 100;
const UNDO_LIMIT = 20;

type MindmapLevel = "P0" | "P1" | "P2" | "P3";
const LEVELS: MindmapLevel[] = ["P0", "P1", "P2", "P3"];

interface ModuleW {
  id: string;
  /** 父模块 id 或 ROOT_ID */
  parentId: string;
  name: string;
  tmp: boolean;
  deleted: boolean;
  renamed: boolean;
  order: number;
  isDefault: boolean;
}

interface CaseW {
  id: string;
  moduleId: string | null;
  /** 构建时的服务端归属（判断是否发生移动） */
  originModuleId: string | null;
  name: string;
  level: MindmapLevel;
  precondition: string;
  steps: { desc: string; expect: string }[];
  version: number;
  tmp: boolean;
  deleted: boolean;
  dirty: boolean;
  order: number;
}

interface MindmapSnapshot {
  mods: Record<string, ModuleW>;
  cases: Record<string, CaseW>;
}

interface MindmapSaveResult {
  idMap: Record<string, string>;
  conflicts: { id: string; reason: string }[];
  /** 服务端实际返回命名计数（modulesCreated/casesCreated/…），客户端按索引读取 */
  saved: Record<string, number>;
}

interface MindmapDiffView {
  body: MindmapSave;
  /** 依赖未保存父模块而暂缓提交的节点数（需二次保存） */
  deferred: number;
  total: number;
}

const stepNodeId = (caseId: string, idx: number): string => `${caseId}${STEP_SEP}${idx}`;
const caseIdOfStepId = (id: string): string | null => {
  const i = id.indexOf(STEP_SEP);
  return i >= 0 ? id.slice(0, i) : null;
};
const stepIndexOfId = (id: string): number => {
  const i = id.indexOf(STEP_SEP);
  return i >= 0 ? Number(id.slice(i + STEP_SEP.length)) : -1;
};

function normalizeLevel(lv: string): MindmapLevel {
  return lv === "P0" || lv === "P1" || lv === "P2" || lv === "P3" ? lv : "P1";
}

function freshName(prefix: string, taken: Set<string>): string {
  if (!taken.has(prefix)) return prefix;
  for (let i = 2; ; i++) {
    const n = `${prefix}${i}`;
    if (!taken.has(n)) return n;
  }
}

function cloneMods(r: Record<string, ModuleW>): Record<string, ModuleW> {
  const out: Record<string, ModuleW> = {};
  for (const [k, v] of Object.entries(r)) out[k] = { ...v };
  return out;
}

function cloneCases(r: Record<string, CaseW>): Record<string, CaseW> {
  const out: Record<string, CaseW> = {};
  for (const [k, v] of Object.entries(r))
    out[k] = { ...v, steps: v.steps.map((s) => ({ ...s })) };
  return out;
}

function buildWorking(
  tree: ModuleNodeDto[],
  rows: CaseRowV2[],
): { mods: Record<string, ModuleW>; cases: Record<string, CaseW>; nextOrder: number } {
  const mods: Record<string, ModuleW> = {};
  let moduleOrder = 0;
  const walk = (list: ModuleNodeDto[], parentId: string): void => {
    for (const m of list) {
      mods[m.id] = {
        id: m.id,
        parentId,
        name: m.name,
        tmp: false,
        deleted: false,
        renamed: false,
        order: moduleOrder++,
        isDefault: m.isDefault,
      };
      walk(m.children, m.id);
    }
  };
  walk(tree, ROOT_ID);
  const cases: Record<string, CaseW> = {};
  rows.forEach((r, i) => {
    cases[r.id] = {
      id: r.id,
      moduleId: r.moduleId,
      originModuleId: r.moduleId,
      name: r.name,
      level: normalizeLevel(r.level),
      precondition: r.precondition,
      steps: (r.steps ?? []).map((s) => ({ desc: s.desc, expect: s.expect })),
      version: r.version,
      tmp: false,
      deleted: false,
      dirty: false,
      order: i,
    };
  });
  return { mods, cases, nextOrder: Math.max(moduleOrder, rows.length) + 1 };
}

/** 收集保存 diff（纯函数）：tmp 直存/重命名/删除集；嵌套在未保存模块下的节点暂缓（deferred）。 */
function collectDiff(
  mods: Record<string, ModuleW>,
  cases: Record<string, CaseW>,
): MindmapDiffView {
  // 可本轮提交的 tmp 模块：父为根或已存未删模块（服务端 created.parentId 须为已存 uuid）
  const commitTmpModules = new Set<string>();
  for (const m of Object.values(mods)) {
    if (m.deleted || !m.tmp) continue;
    const parent = m.parentId === ROOT_ID ? undefined : mods[m.parentId];
    const parentOk =
      m.parentId === ROOT_ID || (parent !== undefined && !parent.tmp && !parent.deleted);
    if (parentOk) commitTmpModules.add(m.id);
  }

  const created: MindmapSave["modules"]["created"] = [];
  const renamed: MindmapSave["modules"]["renamed"] = [];
  const modsDeleted: string[] = [];
  let deferred = 0;
  for (const m of Object.values(mods)) {
    if (m.deleted) {
      if (!m.tmp) modsDeleted.push(m.id);
      continue;
    }
    if (m.tmp) {
      if (commitTmpModules.has(m.id)) {
        created.push({
          tmpId: m.id,
          name: m.name,
          parentId: m.parentId === ROOT_ID ? null : m.parentId,
        });
      } else {
        deferred++;
      }
    } else if (m.renamed) {
      renamed.push({ id: m.id, name: m.name });
    }
  }

  const casesCreated: MindmapSave["cases"]["created"] = [];
  const casesUpdated: MindmapSave["cases"]["updated"] = [];
  const casesDeleted: string[] = [];
  for (const c of Object.values(cases)) {
    if (c.deleted) {
      if (!c.tmp) casesDeleted.push(c.id);
      continue;
    }
    if (c.tmp) {
      const mid = c.moduleId;
      const moduleOk =
        mid === null ||
        commitTmpModules.has(mid) ||
        (mods[mid] !== undefined && !mods[mid].tmp && !mods[mid].deleted);
      if (!moduleOk) {
        deferred++;
        continue;
      }
      casesCreated.push({
        tmpId: c.id,
        name: c.name,
        moduleId: mid,
        level: c.level,
        precondition: c.precondition,
        steps: c.steps.map((s) => ({ desc: s.desc, expect: s.expect })),
      });
    } else if (c.dirty) {
      casesUpdated.push({
        id: c.id,
        version: c.version,
        name: c.name,
        level: c.level,
        precondition: c.precondition,
        steps: c.steps.map((s) => ({ desc: s.desc, expect: s.expect })),
        ...(c.moduleId !== c.originModuleId ? { moduleId: c.moduleId } : {}),
      });
    }
  }

  const body: MindmapSave = {
    modules: { created, renamed, deleted: modsDeleted },
    cases: { created: casesCreated, updated: casesUpdated, deleted: casesDeleted },
  };
  const total =
    created.length +
    renamed.length +
    modsDeleted.length +
    casesCreated.length +
    casesUpdated.length +
    casesDeleted.length;
  return { body, deferred, total };
}

export function CaseMindmapView() {
  const qc = useQueryClient();
  const { message, modal } = useApp();
  const { can } = usePermissions();
  const { currentProjectId: projectId } = useProjectStore();
  const canUpdate = can("PROJECT_CASE:UPDATE");

  // ── 服务端数据 ──
  const modulesQ = useQuery({
    queryKey: ["modules", projectId, "case"],
    queryFn: () => moduleApi.list(projectId!, "case"),
    enabled: Boolean(projectId),
  });
  const casesQ = useQuery({
    queryKey: ["case", "mindmap-all", projectId],
    queryFn: async (): Promise<CaseRowV2[]> => {
      const out: CaseRowV2[] = [];
      for (let p = 1; p <= 100; p++) {
        const r = await caseApiV2.list(projectId!, {
          page: p,
          pageSize: 100,
          recycled: "false",
        });
        out.push(...r.items);
        if (out.length >= r.total || r.items.length === 0) break;
      }
      return out;
    },
    enabled: Boolean(projectId),
  });

  // ── 本地工作树 ──
  const [mods, setMods] = useState<Record<string, ModuleW>>({});
  const [cases, setCases] = useState<Record<string, CaseW>>({});
  const [undoStack, setUndoStack] = useState<MindmapSnapshot[]>([]);
  const [focusId, setFocusId] = useState<string | null>(ROOT_ID);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [panelOpen, setPanelOpen] = useState(true);
  const [keyword, setKeyword] = useState("");
  const [batchTarget, setBatchTarget] = useState<string | undefined>(undefined);
  const [editDepth, setEditDepth] = useState(0);
  const tmpSeq = useRef(0);
  const orderSeq = useRef(1);

  // latest-ref：事件/快捷键处理器读取最新状态
  const modsRef = useRef(mods);
  const casesRef = useRef(cases);
  const undoRef = useRef(undoStack);
  modsRef.current = mods;
  casesRef.current = cases;
  undoRef.current = undoStack;

  const diff = useMemo(() => collectDiff(mods, cases), [mods, cases]);
  const diffRef = useRef(diff);
  diffRef.current = diff;
  const changeCount = diff.total;

  const moduleList = useMemo(
    () => Object.values(mods).filter((m) => !m.deleted).sort((a, b) => a.order - b.order),
    [mods],
  );
  const caseList = useMemo(
    () => Object.values(cases).filter((c) => !c.deleted).sort((a, b) => a.order - b.order),
    [cases],
  );
  const defaultModuleId = useMemo(
    () => moduleList.find((m) => m.isDefault)?.id ?? null,
    [moduleList],
  );

  // ── 服务端数据 → 工作树（初始化 / 保存成功后刷新重建；有本地修改时外部刷新不打断） ──
  const dataSig = useMemo(
    () =>
      JSON.stringify({
        m: modulesQ.data?.items ?? null,
        c: (casesQ.data ?? null)?.map((r) => [r.id, r.version, r.name, r.updatedAt]),
      }),
    [modulesQ.data, casesQ.data],
  );
  const lastSigRef = useRef<string | null>(null);
  const changeCountRef = useRef(0);
  changeCountRef.current = changeCount;
  useEffect(() => {
    if (!modulesQ.data || !casesQ.data) return;
    if (lastSigRef.current === dataSig) return;
    if (lastSigRef.current !== null && changeCountRef.current > 0) return; // 保存失败/冲突：保留本地树
    lastSigRef.current = dataSig;
    const built = buildWorking(modulesQ.data.items, casesQ.data);
    setMods(built.mods);
    setCases(built.cases);
    orderSeq.current = built.nextOrder;
    setUndoStack([]);
    undoRef.current = [];
    setCollapsed(new Set());
    setSelected(new Set());
  }, [dataSig, modulesQ.data, casesQ.data]);

  // ── 派生渲染节点 ──
  const renderModuleOf = useCallback(
    (c: CaseW): string => c.moduleId ?? defaultModuleId ?? ROOT_ID,
    [defaultModuleId],
  );

  const nodes = useMemo((): MindmapNode[] => {
    const countByModule = new Map<string, number>();
    for (const c of caseList) {
      const k = renderModuleOf(c);
      countByModule.set(k, (countByModule.get(k) ?? 0) + 1);
    }
    const out: MindmapNode[] = [
      {
        id: ROOT_ID,
        parentId: null,
        kind: "root",
        label: "全部用例",
        meta: { caseCount: caseList.length },
      },
    ];
    for (const m of moduleList) {
      out.push({
        id: m.id,
        parentId: m.parentId,
        kind: "module",
        label: m.name,
        badge: m.tmp ? "未保存" : undefined,
        meta: { caseCount: countByModule.get(m.id) ?? 0 },
      });
    }
    for (const c of caseList) {
      out.push({
        id: c.id,
        parentId: renderModuleOf(c),
        kind: "case",
        label: c.name,
        badge: c.tmp ? "未保存" : c.dirty ? "已修改" : undefined,
        meta: { level: c.level },
      });
      for (let i = 0; i < c.steps.length; i++) {
        const st = c.steps[i];
        if (!st) continue;
        out.push({
          id: stepNodeId(c.id, i),
          parentId: c.id,
          kind: "step",
          label: st.desc || `步骤 ${i + 1}`,
          meta: { step: st },
        });
      }
    }
    return out;
  }, [moduleList, caseList, renderModuleOf]);

  const nodesById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const idsSet = useMemo(() => new Set(nodesById.keys()), [nodesById]);
  const effFocusId = focusId !== null && idsSet.has(focusId) ? focusId : ROOT_ID;

  const layout = useMemo(() => layoutMindmap(nodes, { collapsed }), [nodes, collapsed]);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  const highlightIds = useMemo(() => {
    const k = keyword.trim().toLowerCase();
    if (!k) return undefined;
    return new Set(nodes.filter((n) => n.label.toLowerCase().includes(k)).map((n) => n.id));
  }, [keyword, nodes]);

  // ── 撤销栈（快照式，最近 20 步） ──
  const pushUndo = useCallback((): void => {
    const snap: MindmapSnapshot = {
      mods: cloneMods(modsRef.current),
      cases: cloneCases(casesRef.current),
    };
    const top = undoRef.current[undoRef.current.length - 1];
    const sig = JSON.stringify(snap);
    if (top && JSON.stringify(top) === sig) return; // 状态未变不入栈
    const next = [...undoRef.current, snap].slice(-UNDO_LIMIT);
    undoRef.current = next;
    setUndoStack(next);
  }, []);

  const undo = useCallback((): void => {
    const stack = undoRef.current;
    if (stack.length === 0) return;
    const snap = stack[stack.length - 1];
    if (!snap) return;
    const rest = stack.slice(0, -1);
    undoRef.current = rest;
    setUndoStack(rest);
    setMods(cloneMods(snap.mods));
    setCases(cloneCases(snap.cases));
  }, []);

  // ── 本地编辑 helper ──
  const setModulePatch = useCallback((id: string, patch: Partial<ModuleW>): void => {
    setMods((prev) => {
      const m = prev[id];
      if (!m) return prev;
      return { ...prev, [id]: { ...m, ...patch } };
    });
  }, []);

  const updateModule = useCallback((id: string, patch: Partial<ModuleW>): void => {
    setMods((prev) => {
      const m = prev[id];
      if (!m) return prev;
      const renamed = m.tmp ? false : patch.name !== undefined ? true : m.renamed;
      return { ...prev, [id]: { ...m, ...patch, renamed } };
    });
  }, []);

  const updateCase = useCallback((id: string, patch: Partial<CaseW>): void => {
    setCases((prev) => {
      const c = prev[id];
      if (!c) return prev;
      return { ...prev, [id]: { ...c, ...patch, dirty: c.tmp ? false : true } };
    });
  }, []);

  const updateStep = useCallback(
    (caseId: string, idx: number, patch: Partial<{ desc: string; expect: string }>): void => {
      setCases((prev) => {
        const c = prev[caseId];
        if (!c || c.steps[idx] === undefined) return prev;
        const steps = c.steps.map((s, i) => (i === idx ? { ...s, ...patch } : s));
        return { ...prev, [caseId]: { ...c, steps, dirty: c.tmp ? false : true } };
      });
    },
    [],
  );

  const addStepToCase = useCallback((caseId: string): void => {
    setCases((prev) => {
      const c = prev[caseId];
      if (!c || c.steps.length >= MAX_STEPS) return prev;
      return {
        ...prev,
        [caseId]: {
          ...c,
          steps: [...c.steps, { desc: "", expect: "" }],
          dirty: c.tmp ? false : true,
        },
      };
    });
  }, []);

  const removeStep = useCallback((caseId: string, idx: number): void => {
    setCases((prev) => {
      const c = prev[caseId];
      if (!c) return prev;
      return {
        ...prev,
        [caseId]: {
          ...c,
          steps: c.steps.filter((_, i) => i !== idx),
          dirty: c.tmp ? false : true,
        },
      };
    });
  }, []);

  const toggleCollapse = useCallback((id: string): void => {
    setCollapsed((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }, []);

  const expandNode = useCallback((id: string): void => {
    if (id === ROOT_ID) return;
    setCollapsed((prev) => (prev.has(id) ? new Set([...prev].filter((x) => x !== id)) : prev));
  }, []);

  const handleSelect = useCallback((id: string, additive: boolean): void => {
    if (additive) {
      setSelected((prev) => {
        const n = new Set(prev);
        if (n.has(id)) n.delete(id);
        else n.add(id);
        return n;
      });
    } else {
      setSelected(new Set());
    }
  }, []);

  // ── 结构操作 ──
  const moduleSubtreeIds = (rootId: string): Set<string> => {
    const out = new Set<string>([rootId]);
    let frontier = [rootId];
    while (frontier.length > 0) {
      const next: string[] = [];
      for (const m of Object.values(mods)) {
        if (!out.has(m.id) && m.parentId !== null && frontier.includes(m.parentId)) {
          out.add(m.id);
          next.push(m.id);
        }
      }
      frontier = next;
    }
    return out;
  };

  const addModuleAt = (parentId: string, afterId: string | null): void => {
    pushUndo();
    const taken = new Set(Object.values(modsRef.current).map((m) => m.name));
    const sibs = Object.values(modsRef.current)
      .filter((m) => !m.deleted && m.parentId === parentId)
      .sort((a, b) => a.order - b.order);
    let order = orderSeq.current++;
    if (afterId !== null) {
      const idx = sibs.findIndex((m) => m.id === afterId);
      const cur = idx >= 0 ? sibs[idx] : undefined;
      if (cur) {
        const next = sibs[idx + 1];
        order = next ? (cur.order + next.order) / 2 : cur.order + 1;
      }
    }
    const id = `tmp-m${++tmpSeq.current}`;
    setMods((prev) => ({
      ...prev,
      [id]: {
        id,
        parentId,
        name: freshName("新模块", taken),
        tmp: true,
        deleted: false,
        renamed: false,
        order,
        isDefault: false,
      },
    }));
    expandNode(parentId);
    setFocusId(id);
    setPanelOpen(true);
  };

  const addCaseAt = (moduleId: string | null, afterId: string | null): void => {
    pushUndo();
    const taken = new Set(Object.values(casesRef.current).map((c) => c.name));
    const sibs = Object.values(casesRef.current)
      .filter((c) => !c.deleted)
      .sort((a, b) => a.order - b.order);
    let order = orderSeq.current++;
    if (afterId !== null) {
      const idx = sibs.findIndex((c) => c.id === afterId);
      const cur = idx >= 0 ? sibs[idx] : undefined;
      if (cur) {
        const next = sibs[idx + 1];
        order = next ? (cur.order + next.order) / 2 : cur.order + 1;
      }
    }
    const id = `tmp-c${++tmpSeq.current}`;
    setCases((prev) => ({
      ...prev,
      [id]: {
        id,
        moduleId,
        originModuleId: null,
        name: freshName("新用例", taken),
        level: "P1",
        precondition: "",
        steps: [],
        version: 0,
        tmp: true,
        deleted: false,
        dirty: false,
        order,
      },
    }));
    if (moduleId !== null) expandNode(moduleId);
    setFocusId(id);
    setPanelOpen(true);
  };

  /** 焦点所在模块（M 键目标）：模块/根=自身；用例/步骤=所属模块 */
  const focusModuleId = (): string => {
    const n = nodesById.get(effFocusId);
    if (n?.kind === "module") return n.id;
    if (n?.kind === "root") return ROOT_ID;
    if (n?.kind === "case") {
      const c = cases[effFocusId];
      return c !== undefined ? renderModuleOf(c) : (defaultModuleId ?? ROOT_ID);
    }
    if (n?.kind === "step") {
      const cid = caseIdOfStepId(effFocusId);
      const c = cid !== null ? cases[cid] : undefined;
      if (c) return renderModuleOf(c);
    }
    return defaultModuleId ?? ROOT_ID;
  };

  /** 新用例归属模块（C 键目标）：模块=自身；根/用例/步骤=默认或所属模块；null=服务端回落默认模块 */
  const moduleForNewCase = (): string | null => {
    const n = nodesById.get(effFocusId);
    if (n?.kind === "module") return n.id;
    if (n?.kind === "case") return cases[effFocusId]?.moduleId ?? defaultModuleId ?? null;
    if (n?.kind === "step") {
      const cid = caseIdOfStepId(effFocusId);
      const c = cid !== null ? cases[cid] : undefined;
      return c?.moduleId ?? defaultModuleId ?? null;
    }
    return defaultModuleId ?? null;
  };

  const cmdAddModuleAtFocus = (): void => {
    addModuleAt(focusModuleId(), null);
  };

  const cmdAddCaseAtFocus = (): void => {
    addCaseAt(moduleForNewCase(), null);
  };

  const cmdEnterSibling = (fid: string): void => {
    const n = nodesById.get(fid);
    if (!n) return;
    if (n.kind === "module") {
      addModuleAt(mods[fid]?.parentId ?? ROOT_ID, fid);
      return;
    }
    if (n.kind === "root") {
      addModuleAt(ROOT_ID, null);
      return;
    }
    if (n.kind === "case") {
      addCaseAt(cases[fid]?.moduleId ?? defaultModuleId ?? null, fid);
      return;
    }
    // 步骤层：给所属用例加一行步骤并进侧栏
    const cid = caseIdOfStepId(fid);
    if (cid === null) return;
    const c = cases[cid];
    if (!c || c.steps.length >= MAX_STEPS) return;
    pushUndo();
    const newIdx = c.steps.length;
    addStepToCase(cid);
    expandNode(cid);
    setFocusId(stepNodeId(cid, newIdx));
    setPanelOpen(true);
  };

  const cmdEnterNode = (fid: string): void => {
    const kids = layoutRef.current.positioned
      .filter((p) => p.node.parentId === fid)
      .sort((a, b) => a.y - b.y);
    const first = kids[0];
    if (first) {
      expandNode(fid);
      setFocusId(first.node.id);
    } else {
      setPanelOpen(true); // 无子（如空步骤用例）：进侧栏编辑
    }
  };

  const cmdTab = (fid: string): void => {
    const n = nodesById.get(fid);
    if (n?.kind !== "module") {
      message.info("Tab 降级仅模块层可用");
      return;
    }
    const m = mods[fid];
    if (!m) return;
    if (!m.tmp) {
      message.info("存量模块的层级调整请在列表模式模块树操作（脑图保存不含模块移动）");
      return;
    }
    const sibs = Object.values(mods)
      .filter((x) => !x.deleted && x.parentId === m.parentId)
      .sort((a, b) => a.order - b.order);
    const idx = sibs.findIndex((x) => x.id === fid);
    if (idx <= 0) {
      message.info("已是首个同级节点，无法降级");
      return;
    }
    const prev = sibs[idx - 1];
    if (!prev) return;
    pushUndo();
    setModulePatch(fid, { parentId: prev.id });
  };

  const deleteNodeLocal = (id: string): void => {
    if (id === ROOT_ID) return;
    const n = nodesById.get(id);
    if (!n) return;
    if (n.kind === "module") {
      // 模块连同子树标记删除（空校验留给服务端；撤销可恢复）
      const subtree = moduleSubtreeIds(id);
      const caseIds = Object.values(cases)
        .filter((c) => !c.deleted && c.moduleId !== null && subtree.has(c.moduleId))
        .map((c) => c.id);
      setMods((prev) => {
        const next = { ...prev };
        for (const mid of subtree) {
          const m = next[mid];
          if (m) next[mid] = { ...m, deleted: true };
        }
        return next;
      });
      setCases((prev) => {
        const next = { ...prev };
        for (const cid of caseIds) {
          const c = next[cid];
          if (c) next[cid] = { ...c, deleted: true };
        }
        return next;
      });
      return;
    }
    if (n.kind === "case") {
      setCases((prev) => {
        const c = prev[id];
        if (!c) return prev;
        if (c.tmp) {
          const next = { ...prev };
          delete next[id];
          return next;
        }
        return { ...prev, [id]: { ...c, deleted: true } };
      });
      return;
    }
    if (n.kind === "step") {
      const cid = caseIdOfStepId(id);
      const idx = stepIndexOfId(id);
      if (cid !== null && idx >= 0) removeStep(cid, idx);
    }
  };

  const cmdDelete = (fid: string): void => {
    const n = nodesById.get(fid);
    if (!n || n.kind === "root") return;
    const parent = n.parentId ?? ROOT_ID;
    if (n.kind === "module") {
      const subtree = moduleSubtreeIds(fid);
      const childModCount = Object.values(mods).filter(
        (m) => !m.tmp && subtree.has(m.id) && m.id !== fid,
      ).length;
      const caseCount = Object.values(cases).filter(
        (c) => !c.tmp && !c.deleted && c.moduleId !== null && subtree.has(c.moduleId),
      ).length;
      const doIt = (): void => {
        pushUndo();
        deleteNodeLocal(fid);
        setFocusId(parent);
      };
      if (childModCount + caseCount > 0) {
        modal.confirm({
          title: `删除模块「${n.label}」？`,
          content: `将连同 ${childModCount} 个子模块、${caseCount} 个用例一起标记删除。注意：非空模块保存时会被服务端拒绝（整体回滚、本地修改保留），请先移出或删除子节点。`,
          okText: "标记删除",
          okButtonProps: { danger: true },
          onOk: doIt,
        });
      } else {
        doIt();
      }
      return;
    }
    pushUndo();
    deleteNodeLocal(fid);
    setFocusId(parent);
  };

  const navigate = (dir: "up" | "down" | "left" | "right", fromId: string): void => {
    const pos = layoutRef.current.positioned.find((p) => p.node.id === fromId);
    if (!pos) return;
    if (dir === "left") {
      const pid = nodesById.get(fromId)?.parentId;
      if (pid !== null && pid !== undefined) setFocusId(pid);
      return;
    }
    if (dir === "right") {
      const kids = layoutRef.current.positioned
        .filter((p) => p.node.parentId === fromId)
        .sort((a, b) => a.y - b.y);
      const first = kids[0];
      if (first) {
        expandNode(fromId);
        setFocusId(first.node.id);
      }
      return;
    }
    const cands = layoutRef.current.positioned.filter((p) =>
      dir === "up" ? p.y < pos.y - 2 : p.y > pos.y + 2,
    );
    if (cands.length === 0) return;
    const sameCol = cands
      .filter((p) => p.x === pos.x)
      .sort((a, b) => Math.abs(a.y - pos.y) - Math.abs(b.y - pos.y));
    const pick =
      sameCol[0] ??
      cands.sort(
        (a, b) =>
          Math.abs(a.y - pos.y) +
          Math.abs(a.x - pos.x) * 0.6 -
          (Math.abs(b.y - pos.y) + Math.abs(b.x - pos.x) * 0.6),
      )[0];
    if (pick) setFocusId(pick.node.id);
  };

  const handleCommand = (cmd: MindmapCommand): void => {
    if (!canUpdate) return;
    switch (cmd.type) {
      case "enter-sibling":
        cmdEnterSibling(cmd.nodeId);
        break;
      case "child":
        cmdEnterNode(cmd.nodeId);
        break;
      case "delete":
        cmdDelete(cmd.nodeId);
        break;
      case "rename":
        setPanelOpen(true);
        break;
      case "navigate":
        if (cmd.direction) navigate(cmd.direction, cmd.nodeId);
        break;
    }
  };

  const doKey = (key: MindmapKey): void => {
    if (!canUpdate) return;
    const fid = effFocusId;
    switch (key) {
      case "enter":
        handleCommand({ type: "enter-sibling", nodeId: fid });
        break;
      case "ctrl-enter":
        handleCommand({ type: "child", nodeId: fid });
        break;
      case "backspace":
        handleCommand({ type: "delete", nodeId: fid });
        break;
      case "f2":
        handleCommand({ type: "rename", nodeId: fid });
        break;
      case "tab":
        cmdTab(fid);
        break;
      case "m":
        cmdAddModuleAtFocus();
        break;
      case "c":
        cmdAddCaseAtFocus();
        break;
      case "escape":
        setSelected(new Set());
        setPanelOpen(false);
        break;
      case "up":
      case "down":
      case "left":
      case "right":
        navigate(key, fid);
        break;
    }
  };
  const keyRef = useRef(doKey);
  keyRef.current = doKey;
  const stableOnKey = useCallback((k: MindmapKey) => keyRef.current(k), []);
  useMindmapKeyboard({
    enabled: canUpdate && Boolean(projectId),
    isEditing: editDepth > 0,
    onKey: stableOnKey,
  });

  // ── 保存 ──
  const saveMutation = useMutation({
    mutationFn: (body: MindmapSave) => mindmapApi.save(projectId!, body),
    onSuccess: (r) => {
      applySaveResult(r);
      void qc.invalidateQueries({ queryKey: ["case"] });
      void qc.invalidateQueries({ queryKey: ["modules", projectId, "case"] });
      const cnt = (k: string): number => Number(r.saved[k] ?? 0);
      message.success(
        `已保存（建 ${cnt("modulesCreated") + cnt("casesCreated")} 改 ${cnt("modulesRenamed") + cnt("casesUpdated")} 删 ${cnt("modulesDeleted") + cnt("casesDeleted")}）`,
      );
      if (r.conflicts.length > 0) {
        const names = r.conflicts
          .map((c0) => `${casesRef.current[c0.id]?.name ?? c0.id}（${c0.reason}）`)
          .join("、");
        message.warning(`${r.conflicts.length} 处冲突已跳过：${names}`);
      }
      if (diffRef.current.deferred > 0) {
        message.info(
          `${diffRef.current.deferred} 个节点挂在未保存的新模块下，待父模块保存后再次点击「保存」即可提交`,
        );
      }
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "保存失败，本地修改已保留"),
  });

  function applySaveResult(r: MindmapSaveResult): void {
    const conflicted = new Set(r.conflicts.map((c0) => c0.id));
    setMods((prev) => {
      const next: Record<string, ModuleW> = {};
      for (const m of Object.values(prev)) {
        if (m.deleted) continue; // 服务端已删除 / 临时节点已消亡
        if (m.tmp) {
          const realId = r.idMap[m.id];
          if (!realId) {
            next[m.id] = { ...m }; // 暂缓提交：保持临时
            continue;
          }
          next[realId] = { ...m, id: realId, tmp: false, renamed: false };
        } else {
          next[m.id] = { ...m, renamed: false };
        }
      }
      for (const m of Object.values(next)) {
        if (m.parentId !== ROOT_ID) {
          const mapped = r.idMap[m.parentId];
          if (mapped) m.parentId = mapped;
          else if (next[m.parentId] === undefined) m.parentId = ROOT_ID; // 父已删（防御）
        }
      }
      return next;
    });
    setCases((prev) => {
      const next: Record<string, CaseW> = {};
      for (const c of Object.values(prev)) {
        if (c.deleted) continue;
        if (c.tmp) {
          const realId = r.idMap[c.id];
          if (!realId) {
            next[c.id] = { ...c, steps: c.steps.map((s) => ({ ...s })) };
            continue;
          }
          const moduleId =
            c.moduleId !== null ? (r.idMap[c.moduleId] ?? c.moduleId) : null;
          next[realId] = {
            ...c,
            id: realId,
            moduleId,
            originModuleId: moduleId,
            tmp: false,
            dirty: false,
            version: 1,
            steps: c.steps.map((s) => ({ ...s })),
          };
        } else {
          const wasConflicted = conflicted.has(c.id);
          next[c.id] = {
            ...c,
            dirty: wasConflicted,
            version: wasConflicted ? c.version : c.version + 1,
          };
        }
      }
      return next;
    });
    setUndoStack([]);
    undoRef.current = [];
  }

  const doSave = (): void => {
    if (!canUpdate || changeCount === 0 || saveMutation.isPending) return;
    saveMutation.mutate(diff.body);
  };

  // ── 批量操作 ──
  const selectedInView = useMemo(
    () => new Set([...selected].filter((id) => idsSet.has(id) && id !== ROOT_ID)),
    [selected, idsSet],
  );

  const moduleOptions = useMemo(() => {
    const byParent = new Map<string, ModuleW[]>();
    for (const m of moduleList) {
      const arr = byParent.get(m.parentId) ?? [];
      arr.push(m);
      byParent.set(m.parentId, arr);
    }
    const out: { value: string; label: string }[] = [];
    const walk = (parentId: string, depth: number): void => {
      for (const m of byParent.get(parentId) ?? []) {
        out.push({
          value: m.id,
          label: `${"\u00A0\u00A0".repeat(depth)}${m.name}${m.tmp ? "（未保存）" : ""}`,
        });
        walk(m.id, depth + 1);
      }
    };
    walk(ROOT_ID, 0);
    return out;
  }, [moduleList]);

  const applyBatchMove = (target: string): void => {
    const ids = [...selectedInView];
    const caseIds = ids.filter((id) => cases[id] !== undefined && !cases[id].deleted);
    const moduleIds = ids.filter((id) => mods[id] !== undefined);
    pushUndo();
    setCases((prev) => {
      const next = { ...prev };
      for (const id of caseIds) {
        const c = next[id];
        if (c) next[id] = { ...c, moduleId: target, dirty: c.tmp ? false : true };
      }
      return next;
    });
    setSelected(new Set());
    if (moduleIds.length > 0) message.info(`${moduleIds.length} 个模块不支持脑图内移动，已跳过`);
    message.success(`已移动 ${caseIds.length} 个用例到「${mods[target]?.name ?? target}」`);
  };

  const confirmBatchDelete = (): void => {
    const ids = [...selectedInView];
    if (ids.length === 0) return;
    modal.confirm({
      title: `批量删除 ${ids.length} 个节点？`,
      content:
        "临时节点直接删除；已存节点保存后生效（用例软删入回收站；非空模块将被服务端拒绝并整体保留本地修改）。",
      okText: "删除",
      okButtonProps: { danger: true },
      onOk: () => {
        pushUndo();
        for (const id of ids) deleteNodeLocal(id);
        setSelected(new Set());
      },
    });
  };

  // ── 侧栏 ──
  const panelCase: CaseW | null = useMemo(() => {
    if (focusId === null) return null;
    const direct = cases[focusId];
    if (direct && !direct.deleted) return direct;
    const cid = caseIdOfStepId(focusId);
    if (cid !== null) {
      const c = cases[cid];
      if (c && !c.deleted) return c;
    }
    return null;
  }, [focusId, cases]);

  const panelModule: ModuleW | null = useMemo(() => {
    if (panelCase !== null || focusId === null) return null;
    const m = mods[focusId];
    return m !== undefined && !m.deleted ? m : null;
  }, [panelCase, focusId, mods]);

  // 焦点切到可编辑节点时自动展开侧栏（Esc 可收起，F2/双击再展开）
  useEffect(() => {
    if (focusId === null || focusId === ROOT_ID) return;
    const n = nodesById.get(focusId);
    if (n && n.kind !== "root") setPanelOpen(true);
  }, [focusId, nodesById]);

  if (!projectId) return <Empty description="请先选择项目" />;

  const loading = modulesQ.isLoading || casesQ.isLoading;
  const loadError = modulesQ.isError || casesQ.isError;
  const ro = !canUpdate;

  return (
    <div
      data-testid="view-mindmap"
      className="rabbit-card flex-1 min-w-0 flex flex-col h-[calc(100vh-232px)] min-h-[440px] overflow-hidden"
    >
      {/* 工具条 */}
      <div className="flex items-center gap-2 px-3 min-h-12 border-b border-[#F0F1F3] flex-wrap">
        <Input.Search
          size="small"
          className="w-52"
          allowClear
          placeholder="搜索（高亮命中节点）"
          data-testid="mindmap-search"
          onSearch={(v) => setKeyword(v)}
        />
        {ro && <span className="text-xs text-[#87888D]">只读模式（缺少用例编辑权限）</span>}
        {canUpdate && (
          <div className="ml-auto flex items-center gap-2">
            <Button
              size="small"
              icon={<FolderPlus size={13} />}
              onClick={cmdAddModuleAtFocus}
              data-testid="mindmap-add-module"
            >
              ＋ 模块 (M)
            </Button>
            <Button
              size="small"
              icon={<FilePlus2 size={13} />}
              onClick={cmdAddCaseAtFocus}
              data-testid="mindmap-add-case"
            >
              ＋ 用例 (C)
            </Button>
            <Button
              size="small"
              icon={<Undo2 size={13} />}
              disabled={undoStack.length === 0 || saveMutation.isPending}
              onClick={undo}
              data-testid="mindmap-undo"
              title="撤销最近一次本地操作（最多 20 步）"
            >
              撤销
            </Button>
            <Button
              type="primary"
              size="small"
              icon={<Save size={13} />}
              loading={saveMutation.isPending}
              disabled={changeCount === 0}
              onClick={doSave}
              data-testid="mindmap-save-btn"
            >
              保存
              {changeCount > 0 && (
                <span className="ml-1 rounded-full bg-white/25 px-1.5 text-[10px] leading-4">
                  {changeCount}
                </span>
              )}
            </Button>
          </div>
        )}
      </div>

      {/* 多选批量条 */}
      {canUpdate && selectedInView.size >= 2 && (
        <div
          className="flex items-center gap-3 px-3 py-2 border-b border-[#F0F1F3] bg-[#574BFF]/[.05] text-[13px] flex-wrap"
          data-testid="mindmap-batch-bar"
        >
          <span className="text-[#574BFF] font-medium">已选 {selectedInView.size} 节点</span>
          <Select
            size="small"
            className="w-48"
            virtual={false}
            allowClear
            placeholder="移动到模块…"
            value={batchTarget}
            options={moduleOptions}
            onChange={(v) => setBatchTarget(v)}
            data-testid="mindmap-batch-move-target"
          />
          <Button
            size="small"
            type="primary"
            disabled={batchTarget === undefined}
            data-testid="mindmap-batch-move"
            onClick={() => batchTarget !== undefined && applyBatchMove(batchTarget)}
          >
            移动
          </Button>
          <Button size="small" danger data-testid="mindmap-batch-delete" onClick={confirmBatchDelete}>
            批量删除
          </Button>
          <Button
            size="small"
            type="link"
            className="!px-0 ml-auto"
            onClick={() => setSelected(new Set())}
          >
            取消选择
          </Button>
        </div>
      )}

      {/* 画布 + 侧栏 */}
      <div className="relative flex flex-1 min-h-0 pt-8">
        {/* 快捷键提示条 */}
        {canUpdate && (
          <div className="absolute left-3 top-1 z-10 flex flex-wrap gap-1 text-[10px] text-[#87888D] max-w-[640px] pointer-events-none">
            {[
              "Enter 同级",
              "Tab 子级",
              "Ctrl+↵ 进入",
              "M 模块",
              "C 用例",
              "⌫ 删除",
              "F2 重命名",
              "↑↓←→ 导航",
              "Esc 取消选择",
            ].map((k) => (
              <span key={k} className="border border-[#E5E6EB] bg-white/80 rounded px-1.5 py-0.5">
                {k}
              </span>
            ))}
          </div>
        )}

        {loading ? (
          <div
            className="flex-1 flex items-center justify-center text-[13px] text-[#87888D]"
            data-testid="mindmap-loading"
          >
            脑图数据加载中…
          </div>
        ) : loadError ? (
          <div className="flex-1 flex items-center justify-center text-[13px] text-[#FF4D4F]">
            数据加载失败，请刷新重试
          </div>
        ) : (
          <MindmapTree
            nodes={nodes}
            focusId={effFocusId}
            collapsed={collapsed}
            selected={selectedInView}
            highlightIds={highlightIds}
            onFocus={setFocusId}
            onToggleCollapse={toggleCollapse}
            onSelect={handleSelect}
            onCommand={handleCommand}
          />
        )}

        {/* 空态引导 */}
        {moduleList.length === 0 && !loading && (
          <div
            data-testid="mindmap-empty-hint"
            className="absolute left-6 top-[104px] text-[13px] text-[#87888D]"
          >
            {canUpdate ? "按 M 创建第一个模块" : "暂无模块，请先在列表模式创建模块"}
          </div>
        )}

        {/* 侧栏：用例完整表单 / 模块重命名 */}
        {panelOpen && (panelCase !== null || panelModule !== null) && (
          <aside
            data-testid="mindmap-case-panel"
            className="w-[340px] shrink-0 border-l border-[#F0F1F3] bg-white overflow-y-auto"
            onFocusCapture={() => setEditDepth((d) => d + 1)}
            onBlurCapture={() => setEditDepth((d) => Math.max(0, d - 1))}
          >
            <div className="p-4 space-y-3 text-[13px]">
              {panelCase !== null ? (
                <>
                  <p className="font-medium flex items-center gap-2">
                    用例详情
                    {panelCase.tmp ? (
                      <Tag bordered={false}>未保存</Tag>
                    ) : panelCase.dirty ? (
                      <Tag bordered={false} color="warning">
                        已修改
                      </Tag>
                    ) : null}
                  </p>
                  <div>
                    <label className="block mb-1 text-xs text-[#646A73]">名称</label>
                    <Input
                      value={panelCase.name}
                      maxLength={256}
                      disabled={ro}
                      data-testid="mindmap-panel-name"
                      onFocus={() => pushUndo()}
                      onChange={(e) => updateCase(panelCase.id, { name: e.target.value })}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-[#646A73] w-10 shrink-0">等级</span>
                    <Select
                      className="w-24"
                      virtual={false}
                      value={panelCase.level}
                      disabled={ro}
                      options={LEVELS.map((l) => ({ value: l, label: l }))}
                      onChange={(v) => {
                        pushUndo();
                        updateCase(panelCase.id, { level: v });
                      }}
                      data-testid="mindmap-panel-level"
                    />
                  </div>
                  <div>
                    <label className="block mb-1 text-xs text-[#646A73]">前置条件</label>
                    <Input.TextArea
                      rows={2}
                      maxLength={2000}
                      value={panelCase.precondition}
                      disabled={ro}
                      onFocus={() => pushUndo()}
                      onChange={(e) => updateCase(panelCase.id, { precondition: e.target.value })}
                      data-testid="mindmap-panel-precondition"
                    />
                  </div>
                  <div>
                    <p className="text-xs text-[#646A73] mb-1">步骤（脑图节点与侧栏双向同步）</p>
                    <div className="space-y-1.5">
                      {panelCase.steps.map((s, i) => (
                        <div
                          key={i}
                          className="border border-[#F0F1F3] rounded p-1.5 space-y-1"
                          data-testid={`mindmap-step-row-${i}`}
                        >
                          <div className="flex items-center gap-1">
                            <span className="text-[10px] text-[#87888D] w-4 shrink-0">{i + 1}</span>
                            <Input
                              size="small"
                              placeholder="步骤操作"
                              maxLength={2000}
                              value={s.desc}
                              disabled={ro}
                              onFocus={() => pushUndo()}
                              onChange={(e) =>
                                updateStep(panelCase.id, i, { desc: e.target.value })
                              }
                            />
                            <Button
                              size="small"
                              type="text"
                              danger
                              disabled={ro}
                              icon={<Trash2 size={12} />}
                              onClick={() => {
                                pushUndo();
                                removeStep(panelCase.id, i);
                              }}
                            />
                          </div>
                          <Input
                            size="small"
                            placeholder="预期结果"
                            maxLength={2000}
                            value={s.expect}
                            disabled={ro}
                            onFocus={() => pushUndo()}
                            onChange={(e) =>
                              updateStep(panelCase.id, i, { expect: e.target.value })
                            }
                          />
                        </div>
                      ))}
                      <Button
                        size="small"
                        type="dashed"
                        block
                        icon={<Plus size={12} />}
                        disabled={ro || panelCase.steps.length >= MAX_STEPS}
                        onClick={() => {
                          pushUndo();
                          addStepToCase(panelCase.id);
                        }}
                        data-testid="mindmap-add-step"
                      >
                        添加步骤
                      </Button>
                    </div>
                  </div>
                  <p className="text-[11px] text-[#A8ABB0]">
                    修改即时写入本地树，点击顶部「保存」批量提交。
                  </p>
                </>
              ) : panelModule !== null ? (
                <>
                  <p className="font-medium flex items-center gap-2">
                    模块
                    {panelModule.tmp ? (
                      <Tag bordered={false}>未保存</Tag>
                    ) : panelModule.renamed ? (
                      <Tag bordered={false} color="warning">
                        已重命名
                      </Tag>
                    ) : null}
                  </p>
                  <div>
                    <label className="block mb-1 text-xs text-[#646A73]">模块名称</label>
                    <Input
                      value={panelModule.name}
                      maxLength={256}
                      disabled={ro}
                      data-testid="mindmap-panel-module-name"
                      onFocus={() => pushUndo()}
                      onChange={(e) => updateModule(panelModule.id, { name: e.target.value })}
                    />
                  </div>
                  <p className="text-[11px] text-[#A8ABB0]">
                    直接用例{" "}
                    {caseList.filter((c) => renderModuleOf(c) === panelModule.id).length} 个；子模块{" "}
                    {moduleList.filter((m) => m.parentId === panelModule.id).length} 个。
                  </p>
                </>
              ) : null}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}

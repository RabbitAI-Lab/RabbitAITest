"use client";

import { Button, Dropdown, Input, Tree } from "antd";
import type { DataNode } from "antd/es/tree";
import { FoldVertical, Plus, RefreshCw } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { moduleApi, type ModuleNodeDto } from "@rabbit/api-client";
import { useApp } from "@/hooks/useApp";
import { useState } from "react";

/**
 * CASE-002/BUG-001：模块树面板（scene=case|bug 复用）。
 * 能力：选中过滤（含子级开关）、+同级/+子级、重命名/删除（右键菜单）、拖拽移动（环由服务端复验）、计数。
 */
export function ModuleTreePanel({
  projectId,
  scene,
  selectedId,
  includeChildren,
  onSelect,
  onIncludeChildrenChange,
  canEdit,
}: {
  projectId: string;
  scene: string;
  selectedId?: string | null;
  includeChildren?: boolean;
  onSelect?: (id: string | null) => void;
  onIncludeChildrenChange?: (v: boolean) => void;
  canEdit?: boolean;
}) {
  const qc = useQueryClient();
  const { message, modal } = useApp();
  const [keyword, setKeyword] = useState("");
  const { data } = useQuery({
    queryKey: ["modules", projectId, scene],
    queryFn: () => moduleApi.list(projectId, scene),
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["modules", projectId, scene] });
  const create = useMutation({
    mutationFn: (body: { name: string; parentId?: string | null }) =>
      moduleApi.create(projectId, scene, body),
    onSuccess: () => {
      invalidate();
      message.success("模块已创建");
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "创建失败"),
  });
  const rename = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      moduleApi.rename(projectId, scene, id, name),
    onSuccess: () => {
      invalidate();
      message.success("已重命名");
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "重命名失败"),
  });
  const remove = useMutation({
    mutationFn: (id: string) => moduleApi.remove(projectId, scene, id),
    onSuccess: () => {
      invalidate();
      onSelect?.(null);
      message.success("模块已删除，其下用例已移至默认模块");
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "删除失败"),
  });
  const move = useMutation({
    mutationFn: ({ id, parentId, order }: { id: string; parentId: string | null; order: number }) =>
      moduleApi.move(projectId, scene, id, { parentId, order }),
    onSuccess: () => invalidate(),
    onError: (e) => {
      invalidate();
      message.error(e instanceof Error ? e.message : "移动失败");
    },
  });

  const flatten = (nodes: ModuleNodeDto[], depth = 0): (ModuleNodeDto & { depth: number })[] =>
    nodes.flatMap((n) => [{ ...n, depth }, ...flatten(n.children, depth + 1)]);

  const toTreeData = (nodes: ModuleNodeDto[]): DataNode[] =>
    nodes.map((n) => ({
      key: n.id,
      title: (
        <span className="flex items-center gap-1.5">
          <span className="truncate max-w-28">{n.name}</span>
          <span className="text-[10px] text-[#A8ABB0]">{n.subtreeCount}</span>
        </span>
      ),
      children: n.children.length ? toTreeData(n.children) : undefined,
      isLeaf: n.children.length === 0,
    }));

  const visibleRoots = (data?.items ?? []).filter(
    (n) => !keyword || JSON.stringify(n).includes(keyword),
  );

  const promptCreate = (parentId: string | null, isChild: boolean) => {
    let value = "";
    modal.confirm({
      title: isChild ? "新建子模块" : "新建同级模块",
      content: (
        <Input
          placeholder="模块名称"
          onChange={(e) => {
            value = e.target.value;
          }}
        />
      ),
      onOk: () => create.mutateAsync({ name: value.trim(), parentId }),
    });
  };
  const promptRename = (node: ModuleNodeDto) => {
    let value = node.name;
    modal.confirm({
      title: "重命名模块",
      content: (
        <Input
          defaultValue={node.name}
          onChange={(e) => {
            value = e.target.value;
          }}
        />
      ),
      onOk: async () => rename.mutateAsync({ id: node.id, name: value.trim() }),
    });
  };
  const findNode = (nodes: ModuleNodeDto[], id: string): ModuleNodeDto | null => {
    for (const n of nodes) {
      if (n.id === id) return n;
      const hit = findNode(n.children, id);
      if (hit) return hit;
    }
    return null;
  };
  const all = data?.items ?? [];

  return (
    <div
      className="w-[240px] shrink-0 bg-white border border-[#E5E6EB] rounded-md flex flex-col"
      data-testid={`module-panel-${scene}`}
    >
      <div className="flex items-center gap-1 px-2 py-2 border-b border-[#F0F1F3]">
        <span className="text-[13px] font-medium flex-1">模块</span>
        {canEdit && (
          <>
            <Button
              type="text"
              size="small"
              icon={<Plus size={14} />}
              onClick={() => promptCreate(null, false)}
              data-testid="module-add-root"
            />
          </>
        )}
        <Button
          type="text"
          size="small"
          icon={<RefreshCw size={13} />}
          onClick={() => invalidate()}
        />
      </div>
      <div className="px-2 py-1.5">
        <Input
          size="small"
          allowClear
          placeholder="定位模块"
          prefix={<FoldVertical size={12} className="text-[#A8ABB0]" />}
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
      </div>
      <div className="flex-1 overflow-auto px-1 pb-2">
        <Tree
          blockNode
          showIcon={false}
          selectedKeys={selectedId ? [selectedId] : []}
          treeData={toTreeData(visibleRoots)}
          defaultExpandAll
          onSelect={(keys) => onSelect?.(keys[0] ? String(keys[0]) : null)}
          draggable={{ icon: false }}
          onDrop={(info) => {
            const id = String(info.dragNode.key);
            const targetKey = info.node.key;
            const dropPos = info.dropPosition ?? 0;
            const parentId = info.dropToGap
              ? (findNode(all, String(targetKey))?.parentId ?? null)
              : String(targetKey);
            move.mutate({ id, parentId, order: Math.max(dropPos, 0) });
          }}
          titleRender={(node) => {
            const n = findNode(all, String(node.key));
            return (
              <Dropdown
                trigger={["contextMenu"]}
                menu={{
                  items: [
                    ...(canEdit
                      ? [
                          {
                            key: "add-child",
                            label: "新建子模块",
                            onClick: () => promptCreate(String(node.key), true),
                          },
                        ]
                      : []),
                    ...(canEdit && n && !n.isDefault
                      ? [{ key: "rename", label: "重命名", onClick: () => n && promptRename(n) }]
                      : []),
                    ...(canEdit && n && !n.isDefault
                      ? [{ key: "delete", label: "删除", danger: true }]
                      : []),
                  ],
                  onClick: ({ key }) => {
                    if (key === "delete" && n) {
                      modal.confirm({
                        title: `删除模块「${n.name}」？`,
                        content: "子树将一并删除，其下用例会移至默认模块。",
                        okButtonProps: { danger: true },
                        onOk: () => remove.mutateAsync(n.id),
                      });
                    }
                  },
                }}
              >
                <div className="group w-full" data-testid={`module-node-${n?.name}`}>
                  <span className="flex items-center gap-1.5 w-full">
                    <span className="truncate flex-1">{n?.name}</span>
                    <span className="text-[10px] text-[#A8ABB0]">{n?.subtreeCount ?? 0}</span>
                  </span>
                </div>
              </Dropdown>
            );
          }}
        />
      </div>
      <div className="border-t border-[#F0F1F3] px-3 py-2 text-xs text-[#646A73] flex items-center justify-between">
        <span>共 {flatten(all).length} 个模块</span>
        {onIncludeChildrenChange && (
          <label className="flex items-center gap-1 cursor-pointer" data-testid="include-children">
            <input
              type="checkbox"
              checked={Boolean(includeChildren)}
              onChange={(e) => onIncludeChildrenChange(e.target.checked)}
            />
            含子级
          </label>
        )}
      </div>
    </div>
  );
}

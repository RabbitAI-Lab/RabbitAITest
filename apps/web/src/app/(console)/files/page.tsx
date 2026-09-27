"use client";

import { Button, Empty, Input, Modal, Popconfirm, Select, Switch, Table, Tooltip, Upload } from "antd";
import { FolderInput, Pencil, Trash2, UploadCloud } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { fileApi, moduleApi, ApiError, type FileRow, type ModuleNodeDto } from "@rabbit/api-client";
import { ModuleTreePanel } from "@/components/ModuleTreePanel";
import { useApp } from "@/hooks/useApp";
import { usePermissions } from "@/hooks/usePermissions";
import { useProjectStore } from "@/stores/project";

/** PROJ-004：文件管理（左 file 场景模块树 + 上传区 + 筛选 + 列表：JAR 开关/下载/重命名/移动/删除）。 */

const fmtTime = (v: string) => v.replace("T", " ").slice(0, 16);

const flattenModules = (
  nodes: ModuleNodeDto[],
  depth = 0,
): (ModuleNodeDto & { depth: number })[] =>
  nodes.flatMap((n) => [{ ...n, depth }, ...flattenModules(n.children, depth + 1)]);

export default function FilesPage() {
  const qc = useQueryClient();
  const { message } = useApp();
  const { can } = usePermissions();
  const { currentProjectId: projectId } = useProjectStore();
  const canUpdate = can("PROJECT_FILE:UPDATE");
  const canDelete = can("PROJECT_FILE:DELETE");

  const [selectedModuleId, setSelectedModuleId] = useState<string | null>(null);
  const [includeChildren, setIncludeChildren] = useState(true);
  const [keyword, setKeyword] = useState("");
  const [page, setPage] = useState(1);
  const [renameTarget, setRenameTarget] = useState<FileRow | null>(null);
  const [renameName, setRenameName] = useState("");
  const [moveTarget, setMoveTarget] = useState<FileRow | null>(null);
  const [moveModuleId, setMoveModuleId] = useState<string>();

  const modulesQ = useQuery({
    queryKey: ["modules", projectId, "file"],
    queryFn: () => moduleApi.list(projectId!, "file"),
    enabled: Boolean(projectId),
  });
  const flat = flattenModules(modulesQ.data?.items ?? []);
  const moduleName = (id: string | null) =>
    id ? (flat.find((m) => m.id === id)?.name ?? "—") : "—";
  const defaultModuleId = flat.find((m) => m.isDefault)?.id;

  const filesQ = useQuery({
    queryKey: ["files", projectId, selectedModuleId, includeChildren, keyword, page],
    queryFn: () =>
      fileApi.list(projectId!, {
        moduleId: selectedModuleId ?? undefined,
        includeChildren,
        keyword: keyword || undefined,
        page,
        pageSize: 20,
      }),
    enabled: Boolean(projectId),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["files", projectId] });

  const upload = useMutation({
    mutationFn: (file: File) => fileApi.upload(projectId!, file),
    onSuccess: (r) => {
      invalidate();
      message.success(`${r.name} 上传成功`);
    },
    onError: (e) => message.error(e instanceof ApiError ? e.message : "上传失败"),
  });

  const updateFile = useMutation({
    mutationFn: ({ id, body }: { id: string; body: { name?: string; moduleId?: string; jarEnabled?: boolean } }) =>
      fileApi.update(projectId!, id, body),
    onSuccess: (_r, v) => {
      invalidate();
      if (v.body.jarEnabled !== undefined) message.success(v.body.jarEnabled ? "JAR 已启用：项目内前后置脚本可引用" : "JAR 已禁用");
      else if (v.body.name !== undefined) message.success("已重命名");
      else message.success("已移动");
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "操作失败"),
  });
  const removeFile = useMutation({
    mutationFn: (id: string) => fileApi.remove(projectId!, id),
    onSuccess: () => {
      invalidate();
      message.success("文件已删除（软删，执行引用时任务将 CONFIG_ERROR）");
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "删除失败"),
  });

  const rows = filesQ.data?.items ?? [];

  return (
    <div className="flex gap-4 items-start">
      <ModuleTreePanel
        projectId={projectId!}
        scene="file"
        selectedId={selectedModuleId}
        includeChildren={includeChildren}
        onSelect={(id) => {
          setSelectedModuleId(id);
          setPage(1);
        }}
        onIncludeChildrenChange={setIncludeChildren}
        canEdit={canUpdate}
      />

      <div className="flex-1 min-w-0 rabbit-card" data-testid="file-manager">
        {/* 上传区：beforeUpload 返回 false 阻止 antd 自动上传，手动走 fileApi.upload */}
        <div className="p-3 border-b border-[#F0F1F3]" data-testid="file-upload">
          <Upload.Dragger
            multiple
            showUploadList={false}
            accept=".jar,.csv,.js,.ts,.json,.txt,.xmind,.zip,.png,.jpg,.jpeg,.xlsx"
            beforeUpload={(file) => {
              if (projectId) upload.mutate(file);
              return false;
            }}
          >
            <p className="flex flex-col items-center gap-1 py-3 text-[#87888D]">
              <UploadCloud size={26} className="text-[#574BFF]" />
              <span className="text-[13px] text-[#3D4350]">
                拖拽文件到此处或<span className="text-[#574BFF]">点击上传</span>（支持多文件）
              </span>
              <span className="text-xs text-[#A8ABB0]">
                类型白名单 jar / csv / js / ts / json / txt / xmind / zip / png / jpg / jpeg / xlsx ·
                单文件大小上限由系统参数控制（SYS-005 file.maxSizeMB）
              </span>
            </p>
          </Upload.Dragger>
        </div>

        {/* 筛选行 */}
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-[#F0F1F3] flex-wrap">
          <Input.Search
            className="w-56"
            allowClear
            placeholder="名称关键字"
            onSearch={(v) => {
              setKeyword(v.trim());
              setPage(1);
            }}
            data-testid="file-filter-keyword"
          />
          <span className="text-xs text-[#A8ABB0] ml-auto">
            同名文件允许上传，按上传时间区分 · 下载走鉴权流式 · 删除为软删
          </span>
        </div>

        <Table<FileRow>
          rowKey="id"
          loading={filesQ.isLoading}
          dataSource={rows}
          data-testid="file-list-table"
          pagination={{
            total: filesQ.data?.total ?? 0,
            current: page,
            pageSize: 20,
            showSizeChanger: false,
            onChange: setPage,
          }}
          locale={{
            emptyText: (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  <span className="text-[13px]">
                    暂无文件
                    <br />
                    <span className="text-xs text-[#A8ABB0]">
                      拖拽或点击上方上传区，支持 jar / csv / js / xlsx 等类型
                    </span>
                  </span>
                }
              />
            ),
          }}
          columns={[
            { title: "名称", dataIndex: "name", render: (v: string) => <span className="font-medium">{v}</span> },
            { title: "大小", dataIndex: "sizeText", width: 90 },
            {
              title: "模块",
              dataIndex: "moduleId",
              width: 120,
              render: (id: string | null) => <span className="text-[#646A73]">{moduleName(id)}</span>,
            },
            {
              title: "JAR",
              dataIndex: "isJar",
              width: 110,
              render: (_, row) =>
                row.isJar ? (
                  <Tooltip title="JAR 启用后项目内前后置脚本可引用（默认禁用）">
                    <Switch
                      size="small"
                      checked={row.jarEnabled}
                      disabled={!canUpdate}
                      onChange={(jarEnabled) => updateFile.mutate({ id: row.id, body: { jarEnabled } })}
                      data-testid={`jar-switch-${row.id}`}
                    />
                  </Tooltip>
                ) : (
                  <span className="text-[#A8ABB0]" title="仅 .jar 文件可切换启用状态">
                    —
                  </span>
                ),
            },
            {
              title: "上传时间",
              dataIndex: "createdAt",
              width: 130,
              render: (v: string) => <span className="text-[#87888D]">{fmtTime(v)}</span>,
            },
            {
              title: "操作",
              key: "op",
              width: 230,
              render: (_, row) => (
                <span className="flex gap-1">
                  <Button
                    type="link"
                    size="small"
                    className="!px-0"
                    onClick={() => window.open(fileApi.downloadUrl(projectId!, row.id))}
                  >
                    下载
                  </Button>
                  {canUpdate && (
                    <>
                      <Button
                        type="link"
                        size="small"
                        className="!px-0"
                        icon={<Pencil size={12} />}
                        onClick={() => {
                          setRenameTarget(row);
                          setRenameName(row.name);
                        }}
                      >
                        重命名
                      </Button>
                      <Button
                        type="link"
                        size="small"
                        className="!px-0"
                        icon={<FolderInput size={12} />}
                        onClick={() => {
                          setMoveTarget(row);
                          setMoveModuleId(row.moduleId ?? defaultModuleId);
                        }}
                      >
                        移动
                      </Button>
                    </>
                  )}
                  {canDelete && (
                    <Popconfirm
                      title={`删除文件「${row.name}」？`}
                      description="软删除；被执行引用时任务将 CONFIG_ERROR"
                      onConfirm={() => removeFile.mutate(row.id)}
                    >
                      <Button type="link" size="small" danger className="!px-0" icon={<Trash2 size={12} />}>
                        删除
                      </Button>
                    </Popconfirm>
                  )}
                </span>
              ),
            },
          ]}
        />
      </div>

      {/* 重命名弹窗 */}
      <Modal
        title="重命名文件"
        open={Boolean(renameTarget)}
        onCancel={() => setRenameTarget(null)}
        onOk={() => {
          if (renameTarget && renameName.trim())
            updateFile.mutate({ id: renameTarget.id, body: { name: renameName.trim() } });
          setRenameTarget(null);
        }}
        okButtonProps={{ disabled: !renameName.trim() }}
      >
        <Input
          className="mt-1"
          value={renameName}
          maxLength={256}
          onChange={(e) => setRenameName(e.target.value)}
          onPressEnter={() => {
            if (renameTarget && renameName.trim())
              updateFile.mutate({ id: renameTarget.id, body: { name: renameName.trim() } });
            setRenameTarget(null);
          }}
          data-testid="input-rename-file"
        />
      </Modal>

      {/* 移动弹窗 */}
      <Modal
        title={`移动「${moveTarget?.name ?? ""}」到模块`}
        open={Boolean(moveTarget)}
        onCancel={() => setMoveTarget(null)}
        onOk={() => {
          if (moveTarget && moveModuleId) updateFile.mutate({ id: moveTarget.id, body: { moduleId: moveModuleId } });
          setMoveTarget(null);
        }}
        okButtonProps={{ disabled: !moveModuleId }}
      >
        <Select
          className="w-full mt-1"
          value={moveModuleId}
          onChange={setMoveModuleId}
          options={flat.map((m) => ({
            value: m.id,
            label: `${"— ".repeat(m.depth)}${m.name}${m.isDefault ? "（默认，不可删）" : ""}`,
          }))}
          data-testid="select-move-module"
        />
      </Modal>
    </div>
  );
}

"use client";

import { Alert, Button, Input, Modal, Popconfirm, Radio, Select, Space, Table, Tag } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { fileRepoApi, type FileRepoRow } from "@rabbit/api-client";
import { useApp } from "@/hooks/useApp";

const PLATFORM_LABEL: Record<string, string> = { gitea: "Gitea", github: "GitHub", gitlab: "GitLab", gitee: "Gitee" };

/** FILE-001：存储库管理弹窗（连接/测试/拉取）。 */
export function FileReposModal({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { message } = useApp();
  const [editing, setEditing] = useState<FileRepoRow | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [pullTarget, setPullTarget] = useState<FileRepoRow | null>(null);
  const [pullBranch, setPullBranch] = useState("main");
  const [pullPath, setPullPath] = useState("");

  const repos = useQuery({
    queryKey: ["file-repos", projectId],
    queryFn: () => fileRepoApi.list(projectId),
  });
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["file-repos", projectId] });
    void qc.invalidateQueries({ queryKey: ["files", projectId] });
  };

  const test = useMutation({
    mutationFn: (id: string) => fileRepoApi.test(projectId, id),
    onSuccess: (r) => message.success(`连接成功（${r.message}）`),
    onError: (e) => message.error(e instanceof Error ? e.message : "连接失败"),
  });
  const remove = useMutation({
    mutationFn: (id: string) => fileRepoApi.remove(projectId, id),
    onSuccess: () => {
      message.success("已删除（已拉取文件保留）");
      invalidate();
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "删除失败"),
  });
  const pull = useMutation({
    mutationFn: ({ id, branch, path }: { id: string; branch: string; path: string }) =>
      fileRepoApi.pull(projectId, id, { branch, path }),
    onSuccess: (r) => {
      message.success(`拉取完成：新增 ${r.pulled} · 刷新 ${r.refreshed}`);
      setPullTarget(null);
      invalidate();
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "拉取失败"),
  });

  return (
    <Modal title="存储库管理（Git 平台对接）" open footer={null} onCancel={onClose} width={760} destroyOnClose>
      <div className="space-y-3">
        <div className="flex items-center">
          <span className="text-xs text-gray-400">Gitea / GitHub / GitLab / Gitee · Token 加密存储永不回显 · 地址过 SSRF 出站守卫</span>
          <Button className="ml-auto" size="small" type="primary" onClick={() => setCreateOpen(true)} data-testid="btn-new-file-repo">
            ＋ 连接存储库
          </Button>
        </div>
        <Table
          rowKey="id"
          size="small"
          loading={repos.isLoading}
          dataSource={repos.data?.items ?? []}
          pagination={false}
          data-testid="file-repo-table"
          columns={[
            { title: "平台", dataIndex: "platform", width: 90, render: (v: string) => <Tag>{PLATFORM_LABEL[v] ?? v}</Tag> },
            { title: "地址", dataIndex: "url", render: (v: string) => <code className="text-xs text-gray-500">{v}</code> },
            { title: "Token", dataIndex: "hasToken", width: 130, render: (v: boolean) => (v ? <span className="text-xs text-gray-500">● 已配置</span> : <span className="text-xs text-gray-400">○ 未配置</span>) },
            {
              title: "操作",
              width: 240,
              render: (_: unknown, r: FileRepoRow) => (
                <Space size={4}>
                  <Button size="small" type="link" loading={test.isPending && test.variables === r.id} onClick={() => test.mutate(r.id)}>
                    测试
                  </Button>
                  <Button size="small" type="link" onClick={() => { setPullTarget(r); setPullBranch("main"); setPullPath(""); }} data-testid={`repo-pull-${r.id}`}>
                    拉取
                  </Button>
                  <Button size="small" type="link" onClick={() => setEditing(r)}>
                    编辑
                  </Button>
                  <Popconfirm title="删除仓库？（已拉取文件保留）" onConfirm={() => remove.mutate(r.id)}>
                    <Button size="small" type="link" danger>
                      删除
                    </Button>
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
        />
        {(createOpen || editing) && (
          <FileRepoFormModal
            key={editing?.id ?? "new"}
            initial={editing}
            onClose={() => {
              setEditing(null);
              setCreateOpen(false);
            }}
            onSaved={() => {
              setEditing(null);
              setCreateOpen(false);
              invalidate();
            }}
            projectId={projectId}
          />
        )}
        {pullTarget && (
          <Modal
            title={`按分支 + 路径拉取 · ${pullTarget.url}`}
            open
            onCancel={() => setPullTarget(null)}
            confirmLoading={pull.isPending}
            okButtonProps={{ disabled: !pullBranch || !pullPath }}
            onOk={() => pull.mutate({ id: pullTarget.id, branch: pullBranch, path: pullPath })}
            destroyOnClose
          >
            <div className="space-y-3">
              <Alert type="info" showIcon message="目录递归深度≤3、文件数≤50；同分支同路径重复拉取=覆盖更新" />
              <div className="flex gap-2">
                <div className="w-32">
                  <p className="text-xs text-gray-500 mb-1">分支</p>
                  <Input value={pullBranch} onChange={(e) => setPullBranch(e.target.value)} data-testid="repo-pull-branch" />
                </div>
                <div className="flex-1">
                  <p className="text-xs text-gray-500 mb-1">路径（文件或目录）</p>
                  <Input placeholder="data/" value={pullPath} onChange={(e) => setPullPath(e.target.value)} data-testid="repo-pull-path" />
                </div>
              </div>
            </div>
          </Modal>
        )}
      </div>
    </Modal>
  );
}

function FileRepoFormModal({
  initial,
  onClose,
  onSaved,
  projectId,
}: {
  initial: FileRepoRow | null;
  onClose: () => void;
  onSaved: () => void;
  projectId: string;
}) {
  const { message } = useApp();
  const [platform, setPlatform] = useState<FileRepoRow["platform"]>(initial?.platform ?? "gitea");
  const [url, setUrl] = useState(initial?.url ?? "");
  const [token, setToken] = useState("");
  const save = useMutation({
    mutationFn: () =>
      initial
        ? fileRepoApi.update(projectId, initial.id, { platform, url, token: token || undefined })
        : fileRepoApi.create(projectId, { platform, url, token: token || undefined }),
    onSuccess: () => {
      message.success("已保存");
      onSaved();
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "保存失败"),
  });
  return (
    <Modal
      title={initial ? "编辑存储库" : "连接存储库"}
      open
      onCancel={onClose}
      confirmLoading={save.isPending}
      okButtonProps={{ disabled: !url }}
      onOk={() => save.mutate()}
      destroyOnClose
    >
      <div className="space-y-3">
        <div>
          <p className="text-xs text-gray-500 mb-1">平台</p>
          <Radio.Group
            value={platform}
            onChange={(e) => setPlatform(e.target.value)}
            options={(Object.keys(PLATFORM_LABEL) as FileRepoRow["platform"][]).map((v) => ({ value: v, label: PLATFORM_LABEL[v] }))}
            optionType="button"
            buttonStyle="solid"
            data-testid="repo-platform-radio"
          />
        </div>
        <div>
          <p className="text-xs text-gray-500 mb-1">仓库地址（https://host/owner/repo）</p>
          <Input className="font-mono text-xs" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://git.example.com/qa/testdata.git" data-testid="repo-url-input" />
        </div>
        <div>
          <p className="text-xs text-gray-500 mb-1">Token（私有仓库必填；{initial ? "留空=不更新" : "加密存储"}）</p>
          <Input.Password className="font-mono text-xs" value={token} onChange={(e) => setToken(e.target.value)} data-testid="repo-token-input" />
        </div>
      </div>
    </Modal>
  );
}

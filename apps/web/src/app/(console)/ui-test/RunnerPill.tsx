"use client";

/**
 * S14 UIT-004：Runner 管理入口（列表页 header 胶囊 + 抽屉 + 安装弹窗）。
 * 胶囊三态：正常（默认 runner 环境 ok）/ 缺失（checklist 有 fail 项，红点脉冲）/ 安装中（琥珀）。
 * 抽屉：内置 runner 只读卡 + 本项目 runner 列表（检测/设默认/删除/重试）——仅当前项目可见（隔离四级之 API 面）。
 * checklist：六项三态行 + fail 处置指引（复制命令）；warn 不阻断（文案显式注明）。
 */
import { Button, Drawer, Input, Modal, Popconfirm, Tag, message } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { uiRunnerApi } from "@rabbit/api-client";
import type { UiRunnerView } from "@rabbit/api-client";
import type { RunnerEnvCheckItem } from "@rabbit/shared";
import { useProjectStore } from "@/stores/project";

const STATUS_TAG: Record<string, { color: string; label: string }> = {
  INSTALLING: { color: "processing", label: "安装中" },
  READY: { color: "success", label: "READY" },
  FAILED: { color: "error", label: "FAILED" },
  INSTALL_CANCELLED: { color: "default", label: "已取消" },
};

export function checkHasFail(items: RunnerEnvCheckItem[]): boolean {
  return items.some((i) => i.status === "fail");
}

function CheckItemRow({ item }: { item: RunnerEnvCheckItem }) {
  const icon = item.status === "ok" ? "✓" : item.status === "warn" ? "⚠" : "✗";
  const color =
    item.status === "ok"
      ? "text-emerald-500"
      : item.status === "warn"
        ? "text-amber-500"
        : "text-red-500";
  return (
    <div
      className={`flex items-start gap-3 px-3 py-1.5 text-sm ${
        item.status === "fail" ? "bg-red-50/60" : item.status === "warn" ? "bg-amber-50/50" : ""
      }`}
      data-testid={`uit4-check-${item.key}`}
    >
      <span className={`${color} w-4`}>{icon}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-slate-600">{item.label}</span>
          <span
            className={`text-xs ${
              item.status === "fail"
                ? "text-red-600"
                : item.status === "warn"
                  ? "text-amber-600"
                  : "text-slate-500"
            }`}
          >
            {item.detail}
          </span>
        </div>
        {item.hint && (
          <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">
            <span>{item.hint}</span>
            {item.key === "chromium" && (
              <Button
                size="small"
                type="text"
                className="!p-0 !h-auto text-[#574BFF]"
                onClick={() => {
                  void navigator.clipboard?.writeText("node cli.js install chromium");
                  message.success("已复制处置命令");
                }}
              >
                复制
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function RunnerChecklist({ runner }: { runner: UiRunnerView }) {
  if (!runner.check) {
    return (
      <div className="text-xs text-slate-400 px-3 py-2" data-testid="uit4-check-empty">
        尚未检测——点击「环境检测」获取 checklist
      </div>
    );
  }
  return (
    <div className="border rounded divide-y" data-testid="uit4-check-list">
      {runner.check.items.map((item) => (
        <CheckItemRow key={item.key} item={item} />
      ))}
    </div>
  );
}

export function RunnerPill() {
  const { currentProjectId } = useProjectStore();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [installOpen, setInstallOpen] = useState(false);
  const [version, setVersion] = useState("1.63.0");
  const [msg, ctxHolder] = message.useMessage();

  const { data } = useQuery({
    queryKey: ["ui-runners", currentProjectId],
    queryFn: () => uiRunnerApi.list(currentProjectId!),
    enabled: Boolean(currentProjectId),
    refetchInterval: (q) =>
      (q.state.data?.items ?? []).some((r) => r.kind === "project" && r.status === "INSTALLING")
        ? 2500
        : false,
  });

  const runners = useMemo(() => data?.items ?? [], [data]);
  const active = useMemo(
    () => runners.find((r) => r.kind === "project" && r.isDefault) ?? runners[0],
    [runners],
  );
  const installing = runners.some((r) => r.kind === "project" && r.status === "INSTALLING");
  const hasFail = Boolean(active?.check && checkHasFail(active.check.items));

  const invalidate = () => qc.invalidateQueries({ queryKey: ["ui-runners", currentProjectId] });

  const installMut = useMutation({
    mutationFn: (v: string) => uiRunnerApi.install(currentProjectId!, v),
    onSuccess: () => {
      msg.success("安装已受理（引擎将拉取 npm 包并补装 chromium）");
      setInstallOpen(false);
      invalidate();
    },
    onError: (e: Error) => msg.error(e.message),
  });
  const checkMut = useMutation({
    mutationFn: (runnerId: string) => uiRunnerApi.check(currentProjectId!, runnerId),
    onSuccess: () => {
      msg.success("检测已下发（稍候刷新查看结果）");
      setTimeout(invalidate, 1500);
    },
    onError: (e: Error) => msg.error(e.message),
  });
  const defaultMut = useMutation({
    mutationFn: (runnerId: string) => uiRunnerApi.setDefault(currentProjectId!, runnerId),
    onSuccess: () => {
      msg.success("已设为项目默认 Runner");
      invalidate();
    },
    onError: (e: Error) => msg.error(e.message),
  });
  const removeMut = useMutation({
    mutationFn: (runnerId: string) => uiRunnerApi.remove(currentProjectId!, runnerId),
    onSuccess: () => {
      msg.success("已删除（引擎目录异步清理）");
      invalidate();
    },
    onError: (e: Error) => msg.error(e.message),
  });

  const pillCls = installing
    ? "border-amber-300 bg-amber-50"
    : hasFail
      ? "border-red-300 bg-red-50"
      : "border-[#574BFF]/40 bg-[#574BFF]/[0.04]";
  const pillDot = installing
    ? "bg-amber-500"
    : hasFail
      ? "bg-red-500 animate-pulse"
      : "bg-emerald-500";
  const pillText = installing
    ? "安装中…"
    : hasFail
      ? "环境缺失 ✗"
      : active
        ? `环境正常 ✓`
        : "环境正常 ✓";

  return (
    <div className="ml-auto">
      {ctxHolder}
      <button
        className={`flex items-center gap-1.5 border rounded-full pl-2 pr-3 py-1 text-sm ${pillCls}`}
        onClick={() => setOpen(true)}
        data-testid="uit4-pill"
        title="Runner 管理与环境检测"
      >
        <span className={`w-1.5 h-1.5 rounded-full ${pillDot}`} />
        <span className="text-[#574BFF] font-medium">Runner</span>
        <span className="text-slate-500">
          {active ? `${active.kind === "builtin" ? "内置" : active.name} · ${active.version}` : ""}
        </span>
        <span
          className={`text-xs ${
            installing ? "text-amber-600" : hasFail ? "text-red-600" : "text-emerald-600"
          }`}
        >
          {pillText}
        </span>
      </button>

      <Drawer
        title="Runner 管理"
        width={560}
        open={open}
        onClose={() => setOpen(false)}
        extra={
          <div className="flex items-center gap-2">
            <Button
              size="small"
              onClick={() => {
                checkMut.mutate("builtin");
                for (const r of runners.filter((x) => x.kind === "project")) checkMut.mutate(r.id);
              }}
              data-testid="uit4-check-all"
            >
              重新检测全部
            </Button>
            <Button
              size="small"
              type="primary"
              onClick={() => setInstallOpen(true)}
              data-testid="uit4-install-open"
            >
              安装 Runner
            </Button>
          </div>
        }
        data-testid="uit4-drawer"
      >
        <div className="space-y-4">
          <div className="text-xs text-slate-400 border-l-2 border-slate-200 pl-2">
            Runner 安装在<b>引擎主机</b>的项目隔离目录，<b>仅当前项目可见可用</b>；未设置项目 Runner
            时自动使用内置 Runner。
          </div>

          {runners.map((r) => {
            const isBuiltin = r.kind === "builtin";
            const tag = STATUS_TAG[r.status] ?? { color: "default", label: r.status };
            return (
              <div
                key={r.id}
                className={`border rounded p-3 space-y-2 ${
                  r.isDefault ? "border-[#574BFF]/30 bg-[#574BFF]/[0.03]" : ""
                }`}
                data-testid={`uit4-runner-${r.id === "builtin" ? "builtin" : r.id.slice(0, 8)}`}
              >
                <div className="flex items-center gap-2 flex-wrap">
                  {isBuiltin ? (
                    <Tag>内置</Tag>
                  ) : (
                    <Tag color={r.isDefault ? "geekblue" : "default"}>
                      项目{r.isDefault ? " · 默认" : ""}
                    </Tag>
                  )}
                  <span className="font-medium">{r.name}</span>
                  <span className="text-slate-500 font-mono text-xs">
                    @playwright/test {r.version}
                  </span>
                  {!isBuiltin && <Tag color={tag.color}>{tag.label}</Tag>}
                  {isBuiltin && (
                    <span className="ml-auto text-xs text-slate-400">
                      随平台版本发布 · 不可删除
                    </span>
                  )}
                </div>

                {!isBuiltin && r.status === "FAILED" && r.installLogTail && (
                  <pre
                    className="text-xs text-red-500 bg-red-50 border border-red-200 rounded p-2 font-mono whitespace-pre-wrap break-all max-h-32 overflow-auto"
                    data-testid={`uit4-install-log-${r.id.slice(0, 8)}`}
                  >
                    {r.installLogTail}
                  </pre>
                )}
                {!isBuiltin && r.status === "INSTALLING" && r.installLogTail && (
                  <pre
                    className="text-xs text-slate-500 bg-slate-50 border rounded p-2 font-mono whitespace-pre-wrap break-all max-h-24 overflow-auto"
                    data-testid={`uit4-install-progress-${r.id.slice(0, 8)}`}
                  >
                    {r.installLogTail}
                  </pre>
                )}

                <RunnerChecklist runner={r} />

                <div className="flex items-center gap-3 text-xs">
                  <Button
                    size="small"
                    type="link"
                    className="!p-0"
                    onClick={() => checkMut.mutate(r.id)}
                  >
                    {isBuiltin ? "环境检测" : "环境检测"}
                  </Button>
                  {!isBuiltin && !r.isDefault && r.status === "READY" && (
                    <Button
                      size="small"
                      type="link"
                      className="!p-0"
                      onClick={() => defaultMut.mutate(r.id)}
                    >
                      设为默认
                    </Button>
                  )}
                  {!isBuiltin && r.isDefault && (
                    <Button
                      size="small"
                      type="link"
                      className="!p-0"
                      onClick={() => removeMut.mutate(r.id)}
                      disabled
                      title="默认 runner 需先在其他 runner 上设默认后删除"
                    >
                      删除
                    </Button>
                  )}
                  {!isBuiltin && !r.isDefault && (
                    <Popconfirm
                      title="删除该 Runner？"
                      description="软删记录并清理引擎目录（用例回落内置 Runner）"
                      onConfirm={() => removeMut.mutate(r.id)}
                    >
                      <Button size="small" type="link" className="!p-0 text-red-500">
                        删除
                      </Button>
                    </Popconfirm>
                  )}
                  <span className="ml-auto text-slate-400">
                    {r.lastCheckAt
                      ? `检测于 ${new Date(r.lastCheckAt).toLocaleTimeString()}`
                      : "未检测"}
                  </span>
                </div>
              </div>
            );
          })}
          {runners.filter((r) => r.kind === "project").length === 0 && (
            <div
              className="border rounded p-3 text-xs text-slate-400 bg-slate-50"
              data-testid="uit4-empty-project"
            >
              本项目尚未安装 Runner——执行自动使用内置 Runner；点右上「安装
              Runner」可锁定项目专属版本。
            </div>
          )}
        </div>
      </Drawer>

      <Modal
        title="安装 Runner"
        open={installOpen}
        onCancel={() => setInstallOpen(false)}
        onOk={() => installMut.mutate(version)}
        okText="安装"
        confirmLoading={installMut.isPending}
        okButtonProps={{ "data-testid": "uit4-install-submit" }}
      >
        <div className="space-y-3 py-2" data-testid="uit4-install-form">
          <div>
            <div className="text-xs text-slate-500 mb-1">版本（精确 semver）</div>
            <Input
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              className="font-mono"
              data-testid="uit4-install-version"
              placeholder="如 1.63.0"
            />
            <div className="text-xs text-[#574BFF] mt-1">推荐：与内置一致 1.63.0</div>
          </div>
          <div>
            <div className="text-xs text-slate-500 mb-1">安装包</div>
            <div className="border rounded px-2 py-1 text-sm font-mono bg-slate-50 break-all">
              @playwright/test@{version || "…"}
            </div>
          </div>
          <div className="text-xs text-slate-400">
            来源 registry.npmjs.org（官方，不可改）· 安装到引擎主机项目隔离目录 · 完成后自动装
            chromium 并检测
          </div>
        </div>
      </Modal>
    </div>
  );
}

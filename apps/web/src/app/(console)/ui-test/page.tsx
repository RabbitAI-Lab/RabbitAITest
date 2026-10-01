"use client";

import { Empty, Input, Modal, Spin, Table, Tag, message } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  uitApi,
  execTaskDetailApi,
  ApiError,
  licenseApi,
  type UiCaseRow,
} from "@rabbit/api-client";
import { PageHeader } from "@/components/PageHeader";
import { usePermissions } from "@/hooks/usePermissions";
import { useProjectStore } from "@/stores/project";
import { UitPlaceholder } from "./placeholder";
import { RunnerPill } from "./RunnerPill";

/** S11 UIT-002：UI 用例列表（三重门控：modules.uit ∧ PROJECT_UIT:READ ∧ License UI_TEST）。
 * S13 UIT-003：+模式列（脚本/步骤）+粘贴导入（AI 产出的标准 Playwright 脚本零改造收编）。 */

const STATUS_COLOR: Record<string, string> = {
  SUCCESS: "success",
  FAILED: "error",
  RUNNING: "processing",
  PENDING: "default",
  STOPPED: "warning",
};

const SCRIPT_TEMPLATE = `import { test, expect } from '@playwright/test';

// 参数注入：右侧「参数」面板 KV → 子进程环境变量 RABBIT_PARAM_*（process.env 读取）
const BASE = process.env.RABBIT_PARAM_BASEURL ?? 'http://127.0.0.1:4000';

test('示例用例', async ({ page }) => {
  await page.goto(\`\${BASE}/uit/demo\`);
  await page.getByTestId('demo-username').fill('rabbit-e2e');
  await page.getByRole('button', { name: '提交' }).click();
  await expect(page.locator('.demo-result-text')).toContainText('提交成功，rabbit-e2e');
});
`;

export default function UiTestPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { currentProjectId } = useProjectStore();
  const { canGlobal } = usePermissions();
  const licQ = useQuery({
    queryKey: ["uit-gate-license"],
    queryFn: () => licenseApi.publicStatus(),
    refetchInterval: (q) => (q.state.data?.features?.includes("UI_TEST") ? false : 2000),
    staleTime: 0,
  });
  // ENTP-009 开源全功能：featureGateEnabled=false（默认）恒放行；状态未载亦放行（占位不闪现）
  const entp = {
    can: (f: string) =>
      !licQ.data || !licQ.data.featureGateEnabled
        ? true
        : licQ.data.edition === "ENTERPRISE" && (licQ.data.features ?? []).includes(f),
    loading: licQ.isLoading,
  };
  const [name, setName] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [msg, msgCtx] = message.useMessage();
  // 粘贴导入弹层（S13 UIT-003）
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteName, setPasteName] = useState("");
  const [pasteScript, setPasteScript] = useState(SCRIPT_TEMPLATE);
  const [pasteBusy, setPasteBusy] = useState(false);
  const [pasteError, setPasteError] = useState("");

  const entitled = entp.can("UI_TEST");
  const permitted = canGlobal("PROJECT_UIT:READ");

  const { data, isLoading } = useQuery({
    queryKey: ["ui-cases", currentProjectId, page, name],
    queryFn: () => uitApi.cases(currentProjectId!, { page, name: name || undefined }),
    enabled: Boolean(currentProjectId) && entitled && permitted,
  });

  const runMut = useMutation({
    mutationFn: (id: string) => uitApi.runCase(currentProjectId!, id),
    onSuccess: (r) => {
      msg.success("UI 用例执行已触发");
      router.push(`/ui-test/tasks/${r.taskId}`);
    },
    onError: (e) => msg.error(e instanceof ApiError ? e.message : "触发失败"),
  });

  const batchMut = useMutation({
    mutationFn: () => uitApi.runBatch(currentProjectId!, selected),
    onSuccess: (r) => {
      msg.success(`批量执行已触发（${selected.length} 条）`);
      setSelected([]);
      router.push(`/ui-test/tasks/${r.taskId}`);
    },
    onError: (e) => msg.error(e instanceof ApiError ? e.message : "批量执行失败"),
  });

  const delMut = useMutation({
    mutationFn: (id: string) => uitApi.removeCase(currentProjectId!, id),
    onSuccess: () => {
      msg.success("已删除");
      void qc.invalidateQueries({ queryKey: ["ui-cases"] });
    },
  });

  /** 校验干跑轮询：终态后返回 titles / error（ui_validate 任务详情——steps=标题行）。 */
  const waitValidate = async (taskId: string) => {
    for (let i = 0; i < 60; i++) {
      const d = await execTaskDetailApi.uiDetail(currentProjectId!, taskId);
      if (d.status !== "PENDING" && d.status !== "RUNNING") {
        const item = d.items[0];
        if (d.status === "SUCCESS" && item) {
          return { ok: true as const, titles: item.steps.map((s) => s.name) };
        }
        return { ok: false as const, error: item?.steps[0]?.message || "校验失败" };
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    return { ok: false as const, error: "校验超时（60s）" };
  };

  const pasteCreate = async () => {
    if (!pasteScript.trim()) {
      setPasteError("脚本内容不能为空");
      return;
    }
    setPasteBusy(true);
    setPasteError("");
    try {
      const v = await uitApi.validateScript(currentProjectId!, {
        name: pasteName || undefined,
        script: pasteScript,
      });
      const r = await waitValidate(v.taskId);
      if (!r.ok) {
        setPasteError(r.error.slice(0, 500));
        return;
      }
      await uitApi.createCase(currentProjectId!, {
        name: pasteName.trim() || r.titles[0] || "未命名脚本用例",
        mode: "script",
        steps: [],
        script: pasteScript,
        params: [],
        timeoutMs: 30000,
      });
      msg.success(`校验通过（${r.titles.length} 个测试），已创建`);
      setPasteOpen(false);
      setPasteName("");
      void qc.invalidateQueries({ queryKey: ["ui-cases"] });
    } catch (e) {
      setPasteError(e instanceof ApiError ? e.message : "导入失败");
    } finally {
      setPasteBusy(false);
    }
  };

  if (!currentProjectId) {
    return (
      <div className="p-4 md:p-6 max-w-[1100px]">
        <PageHeader title="UI 测试" sub="脚本直录 · 步骤编排 · chromium 执行 · trace 报告" />
        <Empty className="py-24" description="请先选择项目" />
      </div>
    );
  }
  if (!entitled) return <UitPlaceholder reason="license" />;

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-[1100px]" data-testid="uit-page">
      {msgCtx}
      <PageHeader
        title="UI 测试"
        sub="脚本直录（Playwright）· 步骤编排 · chromium 执行 · 测试树/trace 报告"
        extra={
          <span className="space-x-2">
            <button
              className="border rounded px-3 py-1.5 text-sm"
              data-testid="uit-elements-entry"
              onClick={() => router.push("/ui-test/elements")}
            >
              元素库
            </button>
            <button
              className="border rounded px-3 py-1.5 text-sm disabled:opacity-40"
              disabled={selected.length === 0}
              data-testid="uit-batch-run-btn"
              onClick={() => batchMut.mutate()}
            >
              批量执行{selected.length > 0 ? `（${selected.length}）` : ""}
            </button>
            <button
              className="border border-[#574BFF]/40 text-[#574BFF] rounded px-3 py-1.5 text-sm"
              data-testid="uit3-paste-import"
              onClick={() => setPasteOpen(true)}
            >
              粘贴导入脚本
            </button>
            <button
              className="bg-[#574BFF] text-white rounded px-3 py-1.5 text-sm"
              data-testid="uit-create-btn"
              onClick={() => router.push("/ui-test/cases/new")}
            >
              新建 UI 用例
            </button>
            {/* S14 UIT-004：Runner 管理入口胶囊（当前生效 runner 三态 + 管理抽屉） */}
            <RunnerPill />
          </span>
        }
      />
      <div className="flex items-center gap-2">
        <input
          className="border rounded px-2 py-1 text-sm w-56"
          placeholder="搜索用例名"
          data-testid="uit-search"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setPage(1);
          }}
        />
        <span className="text-xs text-slate-400">新建默认脚本模式（可切换步骤模式）</span>
      </div>
      <Spin spinning={isLoading}>
        {data && data.list.length === 0 ? (
          <Empty
            className="py-20 bg-white border rounded"
            description="还没有 UI 用例——粘贴导入 Playwright 脚本，或用步骤模式编排"
          />
        ) : (
          <Table<UiCaseRow>
            rowKey="id"
            size="small"
            data-testid="uit-cases-table"
            dataSource={data?.list ?? []}
            rowSelection={{
              selectedRowKeys: selected,
              onChange: (keys) => setSelected(keys as string[]),
            }}
            pagination={{
              current: page,
              pageSize: 20,
              total: data?.total ?? 0,
              onChange: setPage,
              showSizeChanger: false,
            }}
            columns={[
              {
                title: "名称",
                dataIndex: "name",
                render: (v: string, r) => (
                  <a
                    className="text-[#574BFF]"
                    onClick={() => router.push(`/ui-test/cases/${r.id}`)}
                  >
                    {v}
                  </a>
                ),
              },
              {
                title: "模式",
                dataIndex: "mode",
                width: 80,
                render: (v: string) =>
                  v === "script" ? (
                    <Tag color="purple" data-testid="uit3-mode-script">
                      脚本
                    </Tag>
                  ) : (
                    <Tag>步骤</Tag>
                  ),
              },
              {
                title: "规模",
                key: "scale",
                width: 90,
                render: (_, r) =>
                  r.mode === "script" ? (
                    <span className="text-xs text-slate-500">
                      {(r.script.length / 1024).toFixed(1)} KB
                    </span>
                  ) : (
                    <span className="text-xs text-slate-500">{r.stepCount ?? 0} 步</span>
                  ),
              },
              {
                title: "摘要",
                key: "summary",
                render: (_, r) => (
                  <span className="text-xs text-slate-500">
                    {r.mode === "script"
                      ? r.summary || "脚本用例"
                      : [
                          ...r.steps.slice(0, 4).map((s) => s.op),
                          ...(r.steps.length > 4 ? ["…"] : []),
                        ].join(" → ")}
                  </span>
                ),
              },
              {
                title: "最近结果",
                key: "lastTask",
                width: 110,
                render: (_, r) =>
                  r.lastTask ? (
                    <Tag
                      color={STATUS_COLOR[r.lastTask.status] ?? "default"}
                      data-testid={`uit-last-status-${r.id}`}
                    >
                      {r.lastTask.status}
                    </Tag>
                  ) : (
                    <span className="text-xs text-slate-400">未执行</span>
                  ),
              },
              {
                title: "操作",
                key: "ops",
                width: 170,
                render: (_, r) => (
                  <span className="space-x-3">
                    <a
                      className="text-[#574BFF]"
                      data-testid={`uit-run-${r.id}`}
                      onClick={() => runMut.mutate(r.id)}
                    >
                      执行
                    </a>
                    <a
                      className="text-slate-500"
                      onClick={() => router.push(`/ui-test/cases/${r.id}`)}
                    >
                      编辑
                    </a>
                    <a
                      className="text-red-400"
                      onClick={() =>
                        Modal.confirm({
                          title: `删除用例「${r.name}」？`,
                          onOk: () => delMut.mutateAsync(r.id),
                        })
                      }
                    >
                      删除
                    </a>
                  </span>
                ),
              },
            ]}
          />
        )}
      </Spin>

      <Modal
        title="粘贴导入 Playwright 脚本"
        open={pasteOpen}
        onCancel={() => setPasteOpen(false)}
        width={720}
        footer={null}
        data-testid="uit3-paste-modal"
      >
        <div className="space-y-3">
          <Input
            placeholder="用例名称（默认取脚本内首个 test 标题）"
            value={pasteName}
            onChange={(e) => setPasteName(e.target.value)}
            data-testid="uit3-paste-name"
          />
          <textarea
            className="w-full border rounded px-2 py-1.5 font-mono text-xs h-56 bg-slate-900 text-emerald-200"
            value={pasteScript}
            onChange={(e) => setPasteScript(e.target.value)}
            data-testid="uit3-paste-textarea"
          />
          {pasteError && (
            <pre
              className="text-xs text-red-500 whitespace-pre-wrap border border-red-200 bg-red-50 rounded p-2 max-h-40 overflow-auto"
              data-testid="uit3-paste-error"
            >
              {pasteError}
            </pre>
          )}
          <div className="flex gap-2 justify-end">
            <button
              className="border rounded px-3 py-1.5 text-sm"
              onClick={() => setPasteOpen(false)}
            >
              取消
            </button>
            <button
              className="bg-[#574BFF] text-white rounded px-3 py-1.5 text-sm disabled:opacity-40"
              disabled={pasteBusy}
              data-testid="uit3-paste-create"
              onClick={() => void pasteCreate()}
            >
              {pasteBusy ? "校验中…" : "校验并创建"}
            </button>
          </div>
          <div className="text-xs text-slate-400">
            「校验并创建」= 干跑收集（识别 N 个测试 /
            报编译错误定位）通过后创建并进入列表；失败停留并显示错误。
          </div>
        </div>
      </Modal>
    </div>
  );
}

"use client";

/** S11 LOAD-003：任务监控实时曲线（/load/tasks/{taskId}）。
 *  SSE 推进秒级帧；停止按钮写停键；终态（SUCCESS/FAILED/ABORTED）自动跳报告页。 */
import { Button, Spin, Tag, message } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { loadApi, ApiError } from "@rabbit/api-client";
import type { LoadMetricFrame } from "@rabbit/shared";
import { PageHeader } from "@/components/PageHeader";
import { LoadTimelineChart } from "@/components/load/LoadTimelineChart";
import { useProjectStore } from "@/stores/project";

export default function LoadMonitorPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { currentProjectId } = useProjectStore();
  const params = useParams<{ taskId: string }>();
  const taskId = params.taskId;
  const [frames, setFrames] = useState<LoadMetricFrame[]>([]);
  const [status, setStatus] = useState<string>("RUNNING");
  const esRef = useRef<EventSource | null>(null);
  const [msg, msgCtx] = message.useMessage();

  // 首屏：metrics 回放（Stream 内既有帧；终态任务回落 Report）
  const { data: initial } = useQuery({
    queryKey: ["load-metrics", currentProjectId, taskId],
    queryFn: () => loadApi.metrics(currentProjectId!, taskId),
    enabled: Boolean(currentProjectId) && Boolean(taskId),
  });
  useEffect(() => {
    if (initial) {
      setFrames(initial.frames);
      setStatus(initial.status);
    }
  }, [initial]);

  // SSE 实时推进（仅 RUNNING/PENDING 开流）
  useEffect(() => {
    if (!taskId) return;
    if (status !== "RUNNING" && status !== "PENDING") return;
    const es = new EventSource(loadApi.streamUrl(taskId));
    esRef.current = es;
    es.onmessage = (ev) => {
      try {
        const frame = JSON.parse(ev.data as string) as LoadMetricFrame;
        setFrames((prev) => [...prev, frame]);
      } catch {
        // 坏帧跳过
      }
    };
    const poll = setInterval(async () => {
      try {
        const m = await loadApi.metrics(currentProjectId!, taskId);
        if (m.status !== "RUNNING" && m.status !== "PENDING") {
          setStatus(m.status);
          setFrames(m.frames.length > 0 ? m.frames : (prev) => prev);
          es.close();
          void qc.invalidateQueries({ queryKey: ["load-tests"] });
        }
      } catch {
        // 轮询失败静默
      }
    }, 2000);
    return () => {
      es.close();
      clearInterval(poll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId, status, currentProjectId]);

  // 终态自动跳报告（有报告时）
  useEffect(() => {
    if (status === "SUCCESS" || status === "FAILED" || status === "STOPPED") {
      // 引擎停止回调 outcome=stopped→ExecTask.status=STOPPED（ABORTED 为规格措辞，状态机实值 STOPPED——勘误 1）
      const t = setTimeout(() => router.push(`/load/reports/${taskId}`), 1500);
      return () => clearTimeout(t);
    }
  }, [status, router, taskId]);

  const stopMut = useMutation({
    mutationFn: () => loadApi.stop(currentProjectId!, taskId),
    onSuccess: () => msg.success("已发送停止指令（≤2s 生效）"),
    onError: (e) => msg.error(e instanceof ApiError ? e.message : "停止失败"),
  });

  const last = frames[frames.length - 1];
  const totalSent = frames.reduce((a, f) => a + f.sent, 0);
  const totalFail = frames.reduce((a, f) => a + f.fail, 0);

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-[1100px]" data-testid="load-monitor-page">
      {msgCtx}
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            任务监控
            <Tag
              color={
                status === "RUNNING" ? "processing" : status === "SUCCESS" ? "success" : "default"
              }
              data-testid="load-monitor-status"
            >
              {status}
            </Tag>
          </span>
        }
        sub={`任务 ${taskId.slice(0, 8)} · 秒级时间线（SSE 实时推进）`}
        extra={
          status === "RUNNING" || status === "PENDING" ? (
            <Button
              danger
              loading={stopMut.isPending}
              data-testid="load-stop-btn"
              onClick={() => stopMut.mutate()}
            >
              停止施压
            </Button>
          ) : (
            <Button
              onClick={() => router.push(`/load/reports/${taskId}`)}
              data-testid="load-goto-report"
            >
              查看报告
            </Button>
          )
        }
      />
      <div className="grid grid-cols-4 gap-3 text-center">
        <div className="border rounded p-2 bg-white">
          <div className="text-xs text-slate-400">当前 TPS</div>
          <div className="text-lg font-semibold" data-testid="load-tps-now">
            {last?.sent ?? 0}
          </div>
        </div>
        <div className="border rounded p-2 bg-white">
          <div className="text-xs text-slate-400">已发压</div>
          <div className="text-lg font-semibold" data-testid="load-sent-total">
            {totalSent}
          </div>
        </div>
        <div className="border rounded p-2 bg-white">
          <div className="text-xs text-slate-400">失败率</div>
          <div className="text-lg font-semibold text-emerald-600" data-testid="load-fail-rate">
            {totalSent > 0 ? `${((totalFail / totalSent) * 100).toFixed(1)}%` : "0%"}
          </div>
        </div>
        <div className="border rounded p-2 bg-white">
          <div className="text-xs text-slate-400">RT P95</div>
          <div className="text-lg font-semibold" data-testid="load-p95-now">
            {last?.rtP95 ?? 0}ms
          </div>
        </div>
      </div>
      <Spin spinning={frames.length === 0 && (status === "RUNNING" || status === "PENDING")}>
        <LoadTimelineChart
          testid="load-monitor-chart"
          frames={frames}
          series={[
            { key: "tps", label: "TPS", color: "#574BFF", pick: (f) => f.sent },
            {
              key: "conc",
              label: "并发",
              color: "#10b981",
              dashed: true,
              pick: (f) => f.concurrent,
            },
          ]}
        />
        <LoadTimelineChart
          testid="load-monitor-rt-chart"
          frames={frames}
          height={130}
          series={[
            { key: "p50", label: "P50", color: "#574BFF", pick: (f) => f.rtP50 },
            { key: "p95", label: "P95", color: "#f59e0b", pick: (f) => f.rtP95 },
            { key: "p99", label: "P99", color: "#ef4444", dashed: true, pick: (f) => f.rtP99 },
          ]}
        />
      </Spin>
    </div>
  );
}

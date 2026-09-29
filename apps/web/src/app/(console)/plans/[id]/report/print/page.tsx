"use client";

/** S4 PLAN-005：计划报告打印页（登录态；A4 白底版式，加载后自动 window.print=导出 PDF 口径）。 */
import { Button, Empty } from "antd";
import { useQuery } from "@tanstack/react-query";
import { use, useEffect } from "react";
import { planReportApi } from "@rabbit/api-client";
import { useProjectStore } from "@/stores/project";

const STATUS_COLOR: Record<string, string> = {
  通过: "#52C41A",
  失败: "#FF4D4F",
  阻塞: "#FA8C16",
  跳过: "#C9CDD4",
  未执行: "#87888D",
};

export default function PlanReportPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { currentProjectId: projectId } = useProjectStore();
  const { data: view, isLoading } = useQuery({
    queryKey: ["plan-report-view", id, "print"],
    queryFn: () => planReportApi.view(projectId!, id),
    enabled: Boolean(projectId),
  });
  useEffect(() => {
    if (view) {
      const t = setTimeout(() => window.print(), 800);
      return () => clearTimeout(t);
    }
  }, [view]);

  if (!projectId || isLoading)
    return (
      <div className="p-16 flex justify-center">
        <Empty description="加载中…" />
      </div>
    );
  if (!view)
    return (
      <div className="p-16 flex justify-center">
        <Empty description="报告不可用" />
      </div>
    );

  return (
    <div className="bg-white mx-auto p-8 max-w-[820px] print:p-0" data-testid="plan-report-print">
      <div className="text-center pb-3">
        <p className="text-lg font-medium m-0">{view.planName} · 测试计划报告</p>
        <p className="text-[11px] text-[#A8ABB0] m-0">
          RabbitAITest · 生成于 {new Date(view.generatedAt).toLocaleString("zh-CN")}
        </p>
      </div>
      <div className="flex gap-2 text-center text-[11px] py-2">
        <div className="border rounded flex-1 py-1.5">
          通过率{" "}
          <b style={{ color: view.overview.thresholdMet ? "#52C41A" : "#FF4D4F" }}>
            {view.overview.passRate ?? "—"}%
          </b>
        </div>
        <div className="border rounded flex-1 py-1.5">
          已执行{" "}
          <b>
            {view.overview.executed}/{view.overview.total}
          </b>
        </div>
        <div className="border rounded flex-1 py-1.5">
          失败 <b style={{ color: "#FF4D4F" }}>{view.overview.fail}</b>
        </div>
        <div className="border rounded flex-1 py-1.5">
          阻塞 <b style={{ color: "#FA8C16" }}>{view.overview.blocked}</b>
        </div>
        <div className="border rounded flex-1 py-1.5">
          误报 <b style={{ color: "#FAAD14" }}>{view.overview.fakeError}</b>
        </div>
      </div>
      <table className="w-full text-[10px] border-collapse">
        <thead>
          <tr className="bg-slate-50 text-slate-400">
            <th className="border px-2 py-1 text-left">测试点</th>
            <th className="border px-2 py-1 text-left">类型</th>
            <th className="border px-2 py-1 text-left">名称</th>
            <th className="border px-2 py-1 text-left">执行人</th>
            <th className="border px-2 py-1 text-left">状态</th>
            <th className="border px-2 py-1 text-left">实际结果</th>
          </tr>
        </thead>
        <tbody>
          {view.points.flatMap((p) =>
            p.rows.map((r, i) => (
              <tr key={r.refId}>
                <td className="border px-2 py-1">{i === 0 ? p.name : ""}</td>
                <td className="border px-2 py-1">
                  {r.refType === "functional_case"
                    ? "功能"
                    : r.refType === "api_case"
                      ? "接口"
                      : "场景"}
                </td>
                <td className="border px-2 py-1">{r.name}</td>
                <td className="border px-2 py-1">{r.executor ?? "—"}</td>
                <td
                  className="border px-2 py-1"
                  style={{ color: STATUS_COLOR[r.status] ?? "#333" }}
                >
                  {r.status}
                </td>
                <td className="border px-2 py-1">{r.actualResult}</td>
              </tr>
            )),
          )}
        </tbody>
      </table>
      <p className="text-[10px] text-slate-500 pt-2 border-t mt-2">
        总结：{view.summary || "（无）"}
      </p>
      <p className="text-[10px] text-center text-slate-300 pt-1">— 由 RabbitAITest 生成 —</p>
      <div className="text-center pt-4 print:hidden">
        <Button type="primary" onClick={() => window.print()} data-testid="btn-print-now">
          🖨 打印 / 导出 PDF
        </Button>
      </div>
    </div>
  );
}

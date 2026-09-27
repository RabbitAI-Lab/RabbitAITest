"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { ApiError, reportV2Api } from "@rabbit/api-client";
import {
  DebugSingleView,
  REPORT_STATUS_META,
  ReportItemsTable,
  ReportSummaryCards,
} from "@/components/report/ReportViewPanels";
import { ScenarioReportView, ScenarioSummaryCards } from "@/components/report/ScenarioReportPanels";

/** RPT-002/RPT-003：报告免登分享页（token 即凭证；404/过期统一灰空态）。
 *  注：本页位于 (console) 路由组之外——console 布局含服务端登录重定向，免登页须独立于该布局。 */

const TYPE_TEXT: Record<string, { label: string; cls: string }> = {
  api_case: { label: "接口用例", cls: "bg-[#574BFF]/10 text-[#574BFF]" },
  api_debug: { label: "调 试", cls: "bg-[#F2F3F5] text-[#646A73]" },
  scenario: { label: "场 景", cls: "bg-[#1677FF]/10 text-[#1677FF]" },
};

export default function ShareReportPage() {
  const { token } = useParams<{ token: string }>();
  const { data, error } = useQuery({
    queryKey: ["share-report", token],
    queryFn: () => reportV2Api.shareDetail(token),
    enabled: Boolean(token),
    retry: false,
  });

  // 失效统一空态：过期 / 已撤销 / 不存在（SHARE_NOT_FOUND 60414 → HTTP 404）
  if (error) {
    return (
      <div className="min-h-screen bg-[#F5F6FA] grid place-items-center p-6">
        <div
          className="bg-white border border-[#E5E6EB] rounded-md py-24 px-16 grid place-items-center gap-2 w-full max-w-xl"
          data-testid="share-expired"
        >
          <p className="text-[#C9CDD4] text-2xl font-medium m-0">分享链接已过期或不存在</p>
          <p className="text-[#A8ABB0] text-sm m-0">
            链接可能已被撤销、超过有效期，或从未创建
            {error instanceof ApiError && error.code ? `（${error.code}）` : "（SHARE_NOT_FOUND 60414）"}
          </p>
          <a className="text-[#574BFF] text-sm mt-2" href="/">
            前往 RabbitAITest 首页
          </a>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-[#F5F6FA] grid place-items-center">
        <p className="text-sm text-[#A8ABB0]">分享报告加载中…</p>
      </div>
    );
  }

  const statusMeta = REPORT_STATUS_META[data.status] ?? { label: data.status, color: "#87888D" };

  return (
    <div className="min-h-screen bg-[#F5F6FA] p-6">
      <div className="max-w-5xl mx-auto space-y-4" data-testid="share-report-view">
        {/* 只读横幅 */}
        <div
          className="rounded-md bg-[#574BFF]/[.06] border border-[#574BFF]/20 px-4 py-2.5 text-[13px] text-[#574BFF]"
          data-testid="share-banner"
        >
          只读分享 · {data.expireAt?.replace("T", " ").slice(0, 16) ?? "—"} 前有效
          <span className="text-xs text-[#574BFF]/70">（撤销或过期后本页不可访问）</span>
        </div>

        {/* 只读头部：无操作按钮 */}
        <div className="bg-white border border-[#E5E6EB] rounded-md p-3 flex items-center gap-3 flex-wrap">
          <h1 className="text-base font-medium m-0 truncate max-w-72">{data.name}</h1>
          <span
            className="rounded-full px-2 py-0.5 text-xs font-medium"
            style={{ background: `${statusMeta.color}18`, color: statusMeta.color }}
          >
            {statusMeta.label}
          </span>
          <span
            className={`rounded px-1.5 py-0.5 text-xs ${TYPE_TEXT[data.type]?.cls ?? "bg-[#F2F3F5] text-[#646A73]"}`}
          >
            {TYPE_TEXT[data.type]?.label ?? data.type}
          </span>
          <span className="text-xs text-[#A8ABB0]">
            T-{data.taskId.slice(0, 8)} · {data.createdAt.replace("T", " ").slice(0, 16)}
          </span>
        </div>

        {data.type === "api_case" ? (
          <>
            <ReportSummaryCards summary={data.summary} durationMs={data.durationMs} />
            {/* 只读 item 表（匿名访问无项目作用域 itemFrames 权限，钻取需登录后在详情页查看） */}
            <ReportItemsTable items={data.items} drillEnabled={false} />
          </>
        ) : data.type === "scenario" ? (
          <>
            <ScenarioSummaryCards summary={data.summary} durationMs={data.durationMs} />
            {/* 误报徽标同口径；步骤树/变量需登录（scenarioTree 为项目作用域端点） */}
            <ScenarioReportView detail={data} drillEnabled={false} />
          </>
        ) : (
          <DebugSingleView detail={data} liveFrames={[]} />
        )}
      </div>
    </div>
  );
}

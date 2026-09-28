/** S-future UIT-001：UI 测试占位页（企业版方向，同 LOAD-001 口径——无数据面零 API）。 */
import { MonitorPlay } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";

export default function UiTestPlaceholderPage() {
  return (
    <div className="p-4 md:p-6 space-y-4 max-w-[1100px]">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            UI 测试
            <span className="border border-amber-400 text-amber-600 rounded px-1.5 py-0.5 text-xs font-normal">
              企业版方向
            </span>
          </span>
        }
        sub="标准版与 MeterSphere v3 社区版同口径：不提供 UI 测试模块（v1/v2 曾基于 Selenium，v3 移除仅留占位）"
      />
      <div
        data-testid="uit-placeholder"
        className="bg-white border rounded-md p-10 flex flex-col items-center justify-center text-center space-y-3 min-h-[300px]"
      >
        <div className="w-14 h-14 rounded-full bg-slate-100 flex items-center justify-center">
          <MonitorPlay size={26} className="text-slate-400" />
        </div>
        <div className="font-medium text-base">UI 测试 · 企业版方向规划中</div>
        <p className="text-slate-500 text-sm max-w-md leading-relaxed">
          以下能力为企业版规划占位，License 激活后开放；浏览器驱动选型（Selenium/Playwright
          网格）属企业版迭代决策。
        </p>
        <div className="flex gap-2 text-xs text-slate-400">
          {["UI 自动化用例编排", "浏览器驱动矩阵", "元素定位仓库", "视觉快照对比"].map((s) => (
            <span key={s} className="border rounded px-2 py-1 opacity-60">
              {s}
            </span>
          ))}
        </div>
        <a
          className="text-[#574BFF] text-xs underline"
          href="https://github.com/RabbitAI-Lab/RabbitAITest/blob/main/docs/sprint-future-p4/UIT-001-ui-test-module.md"
          target="_blank"
          rel="noreferrer"
        >
          查看规划：UIT-001 规格文档
        </a>
      </div>
    </div>
  );
}

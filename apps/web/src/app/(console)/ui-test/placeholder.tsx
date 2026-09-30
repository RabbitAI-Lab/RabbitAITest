/** S11 UIT-002：License 未激活态占位页（UIT-001 社区版口径保留——三重门控 License 不满足时回退）。 */
import { MonitorPlay } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";

export function UitPlaceholder({ reason }: { reason: "license" }) {
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
        sub="UI 测试模块为企业版能力（S11 起真实模块已就绪，选型 Playwright）"
      />
      <div
        data-testid="uit-placeholder"
        className="bg-white border rounded-md p-10 flex flex-col items-center justify-center text-center space-y-3 min-h-[300px]"
      >
        <div className="w-14 h-14 rounded-full bg-slate-100 flex items-center justify-center">
          <MonitorPlay size={26} className="text-slate-400" />
        </div>
        <div className="font-medium text-base">UI 测试 · 需企业版 License</div>
        <p className="text-slate-500 text-sm max-w-md leading-relaxed">
          {reason === "license"
            ? "当前为社区版：UI 测试模块（元素库/步骤用例编排/chromium 执行/截图报告）需激活含 UI_TEST 特性的企业版 License 后开放。"
            : "UI 测试模块暂不可用。"}
        </p>
        <div className="flex gap-2 text-xs text-slate-400">
          {["UI 自动化用例编排", "元素定位仓库", "逐步截图报告"].map((s) => (
            <span key={s} className="border rounded px-2 py-1 opacity-60">
              {s}
            </span>
          ))}
        </div>
        <a
          className="text-[#574BFF] text-xs underline"
          href="https://github.com/RabbitAI-Lab/RabbitAITest/blob/main/docs/sprint-11-load-uit/UIT-002-ui-test-module.md"
          target="_blank"
          rel="noreferrer"
        >
          查看规划：UIT-002 规格文档
        </a>
      </div>
    </div>
  );
}

/** S-future LOAD-001：性能测试占位页（企业版方向，对齐基线 v3 社区版「仅占位」口径——无数据面零 API）。 */
import { Gauge } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";

export default function LoadPlaceholderPage() {
  return (
    <div className="p-4 md:p-6 space-y-4 max-w-[1100px]">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            性能测试
            <span className="border border-amber-400 text-amber-600 rounded px-1.5 py-0.5 text-xs font-normal">
              企业版方向
            </span>
          </span>
        }
        sub="标准版与 MeterSphere v3 社区版同口径：不提供性能测试模块（占位入口，可在项目设置-信息中开关）"
      />
      <div
        data-testid="load-placeholder"
        className="bg-white border rounded-md p-10 flex flex-col items-center justify-center text-center space-y-3 min-h-[300px]"
      >
        <div className="w-14 h-14 rounded-full bg-slate-100 flex items-center justify-center">
          <Gauge size={26} className="text-slate-400" />
        </div>
        <div className="font-medium text-base">性能测试 · 企业版方向规划中</div>
        <p className="text-slate-500 text-sm max-w-md leading-relaxed">
          以下能力为企业版规划占位，License
          激活后开放；分布式压测架构设计见规格文档（标准版不自研压测内核）。
        </p>
        <div className="flex gap-2 text-xs text-slate-400">
          {["压测场景编排", "分布式压力节点", "压测报告对比"].map((s) => (
            <span key={s} className="border rounded px-2 py-1 opacity-60">
              {s}
            </span>
          ))}
        </div>
        <a
          className="text-[#574BFF] text-xs underline"
          href="https://github.com/RabbitAI-Lab/RabbitAITest/blob/main/docs/sprint-future-p4/LOAD-001-load-test-module.md"
          target="_blank"
          rel="noreferrer"
        >
          查看规划：LOAD-001 / LOAD-002 规格文档
        </a>
      </div>
    </div>
  );
}

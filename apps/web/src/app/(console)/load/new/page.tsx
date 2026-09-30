"use client";

/** S11 LOAD-003：新建施压计划（/load/new）。 */
import { PageHeader } from "@/components/PageHeader";
import { useProjectStore } from "@/stores/project";
import { LoadPlanForm } from "../LoadPlanForm";

export default function LoadNewPage() {
  const { currentProjectId } = useProjectStore();
  return (
    <div className="p-4 md:p-6 space-y-4 max-w-[1100px]">
      <PageHeader title="新建施压计划" sub="性能测试 · 目标请求 + 压力模型 + 断言阈值" />
      {currentProjectId ? <LoadPlanForm projectId={currentProjectId} /> : null}
    </div>
  );
}

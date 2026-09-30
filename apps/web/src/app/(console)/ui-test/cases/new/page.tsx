"use client";

/** S11 UIT-002：新建 UI 用例（/ui-test/cases/new）。 */
import { PageHeader } from "@/components/PageHeader";
import { useProjectStore } from "@/stores/project";
import { UiCaseForm } from "../../UiCaseForm";

export default function UiCaseNewPage() {
  const { currentProjectId } = useProjectStore();
  return (
    <div className="p-4 md:p-6 space-y-4 max-w-[1100px]">
      <PageHeader title="新建 UI 用例" sub="UI 测试 · 步骤编排（元素引用元素库）" />
      {currentProjectId ? <UiCaseForm projectId={currentProjectId} /> : null}
    </div>
  );
}

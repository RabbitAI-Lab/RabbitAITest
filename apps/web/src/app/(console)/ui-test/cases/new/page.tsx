"use client";

/** S11 UIT-002：新建 UI 用例（/ui-test/cases/new）。S13 UIT-003：默认脚本模式（Playwright 直录）。 */
import { PageHeader } from "@/components/PageHeader";
import { useProjectStore } from "@/stores/project";
import { UiCaseForm } from "../../UiCaseForm";

export default function UiCaseNewPage() {
  const { currentProjectId } = useProjectStore();
  return (
    <div className="p-4 md:p-6 space-y-4 max-w-[1280px]">
      <PageHeader
        title="新建 UI 用例"
        sub="UI 测试 · 脚本直录（标准 Playwright Test，AI 产出零改造）· 可切换步骤模式"
      />
      {currentProjectId ? <UiCaseForm projectId={currentProjectId} /> : null}
    </div>
  );
}

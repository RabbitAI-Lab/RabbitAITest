"use client";

/** S11 UIT-002：编辑 UI 用例（/ui-test/cases/{caseId}）。 */
import { Spin } from "antd";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { uitApi } from "@rabbit/api-client";
import { PageHeader } from "@/components/PageHeader";
import { useProjectStore } from "@/stores/project";
import { UiCaseForm } from "../../UiCaseForm";

export default function UiCaseEditPage() {
  const { currentProjectId } = useProjectStore();
  const params = useParams<{ caseId: string }>();
  const caseId = params.caseId;

  const { data, isLoading } = useQuery({
    queryKey: ["ui-case", currentProjectId, caseId],
    queryFn: () => uitApi.caseDetail(currentProjectId!, caseId),
    enabled: Boolean(currentProjectId) && Boolean(caseId),
  });

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-[1100px]">
      <PageHeader title={`编辑 UI 用例${data ? ` · ${data.name}` : ""}`} sub="UI 测试" />
      <Spin spinning={isLoading}>
        {data && currentProjectId ? <UiCaseForm projectId={currentProjectId} initial={data} /> : null}
      </Spin>
    </div>
  );
}

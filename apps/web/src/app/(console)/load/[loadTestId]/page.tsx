"use client";

/** S11 LOAD-003：编辑施压计划（/load/{id}）。 */
import { Spin } from "antd";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { loadApi } from "@rabbit/api-client";
import { PageHeader } from "@/components/PageHeader";
import { useProjectStore } from "@/stores/project";
import { LoadPlanForm } from "../LoadPlanForm";

export default function LoadEditPage() {
  const { currentProjectId } = useProjectStore();
  const params = useParams<{ loadTestId: string }>();
  const loadTestId = params.loadTestId;

  const { data, isLoading } = useQuery({
    queryKey: ["load-test", currentProjectId, loadTestId],
    queryFn: () => loadApi.detail(currentProjectId!, loadTestId),
    enabled: Boolean(currentProjectId) && Boolean(loadTestId),
  });

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-[1100px]">
      <PageHeader title={`编辑施压计划${data ? ` · ${data.name}` : ""}`} sub="性能测试" />
      <Spin spinning={isLoading}>
        {data && currentProjectId ? (
          <LoadPlanForm projectId={currentProjectId} initial={data} />
        ) : null}
      </Spin>
    </div>
  );
}

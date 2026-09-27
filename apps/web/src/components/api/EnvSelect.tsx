"use client";

import { Select } from "antd";
import { useQuery } from "@tanstack/react-query";
import { envApi } from "@rabbit/api-client";
import { useProjectStore } from "@/stores/project";

/** 环境选择（PROJ-003）：执行处下拉，首项「不使用环境」= 不传 envId。契约冻结：Props 不得变更。 */
export default function EnvSelect({
  value,
  onChange,
  className,
}: {
  value?: string;
  onChange: (envId?: string) => void;
  className?: string;
}) {
  const { currentProjectId } = useProjectStore();
  const { data, isLoading } = useQuery({
    queryKey: ["environments", currentProjectId],
    queryFn: () => envApi.list(currentProjectId!),
    enabled: Boolean(currentProjectId),
    staleTime: 60_000,
  });
  return (
    <Select
      className={className}
      style={{ minWidth: 132 }}
      virtual={false}
      loading={isLoading}
      value={value ?? ""}
      onChange={(v: string) => onChange(v === "" ? undefined : v)}
      options={[
        { value: "", label: "不使用环境" },
        ...(data?.items ?? []).map((e) => ({ value: e.id, label: e.name })),
      ]}
      data-testid="env-select"
    />
  );
}

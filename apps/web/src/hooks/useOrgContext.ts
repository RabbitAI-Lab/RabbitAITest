"use client";

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { personalOrgApi } from "@rabbit/api-client";
import { useOrgStore } from "@/stores/org";

/**
 * 组织上下文（ENTP-001）：personal/orgs 拉取 → 切换器状态。
 * 项目列表按组织过滤由 ProjectSwitcher 统一取数（["projects", currentOrgId]），本 hook 不重复拉取。
 * 单组织：切换器隐藏、行为与现状一致（orgId 仍可解析——org 页面用）。
 */
export function useOrgContext() {
  const { currentOrgId, orgs, setOrgs, setCurrent } = useOrgStore();

  const orgsQ = useQuery({
    queryKey: ["personal-orgs"],
    queryFn: () => personalOrgApi.list(),
    staleTime: 60_000,
  });

  useEffect(() => {
    if (orgsQ.data) setOrgs(orgsQ.data);
  }, [orgsQ.data, setOrgs]);

  const currentOrg = orgs.find((o) => o.id === currentOrgId) ?? null;
  return { orgs, currentOrgId, currentOrg, setCurrent, loading: orgsQ.isLoading };
}

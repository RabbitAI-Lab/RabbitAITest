"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { licenseApi, type LicenseStatus } from "@rabbit/api-client";

/**
 * 企业版状态（ENTP-007 公开 license-status 驱动）：
 * 按钮禁用/解锁、菜单可见性、到期横幅共用本 hook。
 * ENTP-009（开源全功能）：featureGateEnabled=false（默认）时 can() 恒 true——
 * License 仅作授权信息展示，不再门控任何功能；状态未载（loading）亦按放行处理，避免占位闪现。
 */
export interface EntpState {
  edition: "COMMUNITY" | "ENTERPRISE";
  enterprise: boolean;
  features: string[];
  daysLeft: number | null;
  expiresAt: string | null;
  can: (feature: string) => boolean;
  loading: boolean;
}

export function useEntp(): EntpState {
  const q = useQuery({
    queryKey: ["entp-license-status"],
    queryFn: () => licenseApi.publicStatus(),
    staleTime: 0, // License 全局态瞬变（S11 门控页：缓存+多订阅者共享 stale 帧——竞态教训）
    refetchOnMount: "always", // 挂载即取新数（同 key 已有订阅者时不再复用 stale 帧，S11 T8 占位闪现根修）
    refetchOnWindowFocus: true,
  });
  const data = q.data;
  return {
    edition: data?.edition ?? "COMMUNITY",
    enterprise: data?.edition === "ENTERPRISE",
    features: data?.features ?? [],
    daysLeft: data?.daysLeft ?? null,
    expiresAt: data?.expiresAt ?? null,
    can: (feature: string) =>
      !data || !data.featureGateEnabled
        ? true
        : data.edition === "ENTERPRISE" && (data.features ?? []).includes(feature),
    loading: q.isLoading,
  };
}

/** License 增删后失效公开状态缓存（授权页/门控按钮即时联动）。 */
export function useInvalidateEntp() {
  const qc = useQueryClient();
  return useCallback(() => {
    void qc.invalidateQueries({ queryKey: ["entp-license-status"] });
  }, [qc]);
}

export type { LicenseStatus };

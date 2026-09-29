"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { licenseApi, type LicenseStatus } from "@rabbit/api-client";

/**
 * 企业版状态（ENTP-007 公开 license-status 驱动）：
 * 按钮禁用/解锁、菜单可见性、到期横幅共用本 hook。
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
    staleTime: 10_000,
  });
  const data = q.data;
  return {
    edition: data?.edition ?? "COMMUNITY",
    enterprise: data?.edition === "ENTERPRISE",
    features: data?.features ?? [],
    daysLeft: data?.daysLeft ?? null,
    expiresAt: data?.expiresAt ?? null,
    can: (feature: string) =>
      data?.edition === "ENTERPRISE" && (data?.features ?? []).includes(feature),
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

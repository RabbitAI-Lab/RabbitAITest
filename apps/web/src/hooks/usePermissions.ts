"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { permApi, projectInfoApi } from "@rabbit/api-client";
import { useProjectStore } from "@/stores/project";

/**
 * SYS-004：权限点登录下发消费端（菜单守卫 + 按钮指令）。
 * scoped=当前项目上下文权限集（含系统/组织/项目三组并集）；global=无项目上下文并集（组织/系统菜单用）。
 */
export function usePermissions() {
  const { currentProjectId } = useProjectStore();
  const { data } = useQuery({
    queryKey: ["permissions", currentProjectId],
    queryFn: () => permApi.resolve(currentProjectId ?? undefined),
    staleTime: 30_000,
  });
  const scoped = useMemo(() => new Set(data?.scoped ?? []), [data]);
  const global = useMemo(() => new Set(data?.global ?? []), [data]);
  return {
    scoped,
    global,
    /** 项目内按钮/操作鉴权（优先 scoped） */
    can: (point: string) => scoped.has(point) || global.has(point),
    /** 组织/系统级菜单鉴权 */
    canGlobal: (point: string) => global.has(point),
  };
}

/** PROJ-001：当前项目信息（模块开关/状态；菜单守卫数据源）。 */
export function useProjectInfo() {
  const { currentProjectId } = useProjectStore();
  const { data } = useQuery({
    queryKey: ["project-info", currentProjectId],
    queryFn: () => projectInfoApi.get(currentProjectId!),
    enabled: Boolean(currentProjectId),
    staleTime: 60_000,
  });
  return data ?? null;
}

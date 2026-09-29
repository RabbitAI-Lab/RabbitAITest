"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

interface OrgStore {
  currentOrgId: string | null;
  /** 本人组织列表缓存（ENTP-001 切换器数据源） */
  orgs: { id: string; name: string }[];
  setOrgs: (orgs: { id: string; name: string }[]) => void;
  setCurrent: (id: string) => void;
  clear: () => void;
}

/** 当前组织上下文（ENTP-001；单组织用户恒取第一个 ACTIVE——行为与切换器隐藏一致）。 */
export const useOrgStore = create<OrgStore>()(
  persist(
    (set) => ({
      currentOrgId: null,
      orgs: [],
      setOrgs: (orgs) =>
        set((s) => ({
          orgs,
          currentOrgId:
            s.currentOrgId && orgs.some((o) => o.id === s.currentOrgId)
              ? s.currentOrgId
              : (orgs[0]?.id ?? null),
        })),
      setCurrent: (id) => set({ currentOrgId: id }),
      clear: () => set({ currentOrgId: null, orgs: [] }),
    }),
    { name: "rabbit-org" },
  ),
);

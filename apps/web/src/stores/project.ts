'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface ProjectStore {
  currentProjectId: string | null;
  projects: { id: string; name: string; num: number; role: string }[];
  setProjects: (projects: { id: string; name: string; num: number; role: string }[]) => void;
  setCurrent: (id: string) => void;
}

/** 当前项目上下文（SYS-003；persist 保证切换后刷新保留）。 */
export const useProjectStore = create<ProjectStore>()(
  persist(
    (set) => ({
      currentProjectId: null,
      projects: [],
      setProjects: (projects) =>
        set((s) => ({
          projects,
          currentProjectId:
            s.currentProjectId && projects.some((p) => p.id === s.currentProjectId)
              ? s.currentProjectId
              : (projects[0]?.id ?? null),
        })),
      setCurrent: (id) => set({ currentProjectId: id }),
    }),
    { name: 'rabbit-project' },
  ),
);

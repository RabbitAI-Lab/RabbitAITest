'use client';

import { Select, Spin } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { projectApi } from '@rabbit/api-client';
import { useProjectStore } from '@/stores/project';

/** 顶栏项目切换器（SYS-003 §3：切换后业务页按项目重取）。 */
export function ProjectSwitcher() {
  const { data, isLoading } = useQuery({ queryKey: ['projects'], queryFn: projectApi.list });
  const { projects, currentProjectId, setProjects, setCurrent } = useProjectStore();

  useEffect(() => {
    if (data) setProjects(data);
  }, [data, setProjects]);

  if (isLoading && projects.length === 0) return <Spin size="small" />;
  const current = projects.find((p) => p.id === currentProjectId);

  return (
    <Select
      aria-label="项目切换"
      data-testid="project-switcher"
      className="min-w-[210px]"
      variant="borderless"
      value={current?.id}
      placeholder="选择项目"
      onChange={(id) => {
        setCurrent(id);
        window.location.reload(); // 全量按项目重取（P0 简化，Sprint 1 改细粒度失效）
      }}
      options={projects.map((p) => ({
        value: p.id,
        label: (
          <span className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#574BFF]" />
            <span className="font-medium">{p.name}</span>
            <span className="text-xs text-[#87888D]">#{p.num} · {p.role}</span>
          </span>
        ),
      }))}
      popupMatchSelectWidth={false}
    />
  );
}

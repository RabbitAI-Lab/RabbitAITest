'use client';

import { Dropdown, Select, Spin } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { projectApi } from '@rabbit/api-client';
import { useProjectStore } from '@/stores/project';

/** 顶栏项目切换器（SYS-003 §3：左上角下拉，切换后业务页按项目重取）。 */
export function ProjectSwitcher() {
  const router = useRouter();
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
      className="min-w-[180px]"
      value={current?.id}
      placeholder="选择项目"
      onChange={(id) => {
        setCurrent(id);
        router.refresh();
        window.location.reload(); // 全量按项目重取（P0 简化，Sprint 1 改细粒度失效）
      }}
      options={projects.map((p) => ({
        value: p.id,
        label: (
          <span>
            {p.name} <span className="text-xs text-gray-400">#{p.num} · {p.role}</span>
          </span>
        ),
      }))}
    />
  );
}

export function TopBar({ email }: { email?: string }) {
  const router = useRouter();
  return (
    <header className="h-12 bg-white border-b flex items-center px-4 gap-3" data-testid="topbar">
      <div className="flex items-center gap-2 font-semibold">
        <span className="w-6 h-6 rounded bg-[#574BFF] text-white grid place-items-center text-xs">R</span>
        RabbitAITest
      </div>
      <ProjectSwitcher />
      <div className="ml-auto flex items-center gap-3 text-sm text-gray-500">
        <span>帮助</span>
        <Dropdown menu={{ items: [{ key: 'logout', label: '退出登录' }], onClick: async ({ key }) => {
          if (key === 'logout') {
            await fetch('/api/v1/auth/logout', { method: 'POST' });
            router.push('/login');
            window.location.href = '/login';
          }
        }}}>
          <span className="w-7 h-7 rounded-full bg-gray-300 grid place-items-center text-xs cursor-pointer" data-testid="user-avatar">
            {(email ?? 'U').slice(0, 1).toUpperCase()}
          </span>
        </Dropdown>
      </div>
    </header>
  );
}

'use client';

import { Empty } from 'antd';
import { PageHeader } from '@/components/PageHeader';
import { GroupManager } from '@/components/GroupManager';
import { useProjectStore } from '@/stores/project';

/** SYS-004/PROJ-001：项目 › 设置 › 用户组（scope=project，权限点仅 PROJECT_ 前缀资源）。 */
export default function SettingsGroupsPage() {
  const { currentProjectId } = useProjectStore();
  return (
    <div>
      <PageHeader title="用户组" sub="项目级用户组：成员与权限点共同决定项目内权限（并集 − 禁用交集）" />
      {currentProjectId ? (
        <GroupManager scope="project" scopeId={currentProjectId} />
      ) : (
        <Empty className="py-24" description="请先选择项目" />
      )}
    </div>
  );
}

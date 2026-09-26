'use client';

import { PageHeader } from '@/components/PageHeader';
import { GroupManager } from '@/components/GroupManager';

/** SYS-004：系统设置 › 用户组（scope=system，权限点全集）。 */
export default function SystemGroupsPage() {
  return (
    <div>
      <PageHeader title="用户组管理" sub="系统级用户组：预置组只读，自定义组可勾选全部权限点（三级复用本组件）" />
      <GroupManager scope="system" />
    </div>
  );
}

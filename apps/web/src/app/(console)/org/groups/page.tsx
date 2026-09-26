"use client";

import { Empty } from "antd";
import { PageHeader } from "@/components/PageHeader";
import { GroupManager } from "@/components/GroupManager";
import { useProjectInfo } from "@/hooks/usePermissions";

/** SYS-004：组织 › 用户组（scope=org，复用组管理组件；权限点为 ORG_/PROJECT_ 前缀资源）。 */
export default function OrgGroupsPage() {
  const orgId = useProjectInfo()?.org.id;
  return (
    <div>
      <PageHeader
        title="用户组管理"
        sub="组织级用户组：预置组只读，自定义组可勾选组织与项目权限点"
      />
      {orgId ? (
        <GroupManager scope="org" scopeId={orgId} />
      ) : (
        <Empty className="py-24" description="请先选择项目" />
      )}
    </div>
  );
}

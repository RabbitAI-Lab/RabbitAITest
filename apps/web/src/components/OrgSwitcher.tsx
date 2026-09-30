"use client";

import { Dropdown } from "antd";
import { Building2, ChevronsUpDown } from "lucide-react";
import { useOrgContext } from "@/hooks/useOrgContext";
import { useEntp } from "@/hooks/useEntp";

/**
 * 顶栏组织切换器（ENTP-001）：>1 个 ACTIVE 组织时显示；
 * 切换后项目列表/组织页面联动（useOrgContext 内处理）。
 */
export function OrgSwitcher() {
  const { orgs, currentOrgId, currentOrg, setCurrent } = useOrgContext();
  const entp = useEntp();

  // 多组织：单组织用户隐藏切换器（E NTP-009 开源全功能下 can() 恒 true，仅按组织数判定；门控恢复态回退 License 判定）
  if (!entp.can("MULTI_ORG") || orgs.length <= 1) return null;

  return (
    <Dropdown
      trigger={["click"]}
      menu={{
        selectable: true,
        selectedKeys: currentOrgId ? [currentOrgId] : [],
        items: [
          ...orgs.map((o) => ({ key: o.id, icon: <Building2 size={14} />, label: o.name })),
          { type: "divider" },
          { key: "__manage", label: "组织管理 →" },
        ],
        onClick: ({ key }) => {
          if (key === "__manage") {
            window.location.href = "/system/orgs";
            return;
          }
          setCurrent(key);
        },
      }}
    >
      <button
        data-testid="org-switcher"
        className="flex items-center gap-1.5 border rounded-md px-2 py-1 text-[13px] text-[#1F2329] hover:border-[#574BFF] bg-white"
      >
        <Building2 size={14} className="text-[#646A73]" />
        <span className="max-w-40 truncate">{currentOrg?.name ?? "选择组织"}</span>
        <ChevronsUpDown size={12} className="text-[#A8ABB0]" />
      </button>
    </Dropdown>
  );
}

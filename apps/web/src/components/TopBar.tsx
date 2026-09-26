"use client";

import { Avatar, Badge, Dropdown } from "antd";
import { HelpCircle, LogOut, Bell } from "lucide-react";
import { useRouter } from "next/navigation";
import { ProjectSwitcher } from "./ProjectSwitcher";

/** 顶栏（SYS-003 §3 视觉基线：白底描边、品牌位 + 项目切换 + 通知/帮助/用户）。 */
export function TopBar({ email }: { email?: string }) {
  const router = useRouter();
  return (
    <header
      data-testid="topbar"
      className="h-12 bg-white border-b border-[#E5E6EB] flex items-center px-4 gap-3 sticky top-0 z-20"
    >
      <div className="flex items-center gap-2 select-none">
        <span className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#6F63FF] to-[#574BFF] text-white grid place-items-center text-[13px] font-bold shadow-sm">
          R
        </span>
        <span className="font-semibold text-[15px] tracking-tight text-[#1F2329]">
          Rabbit<span className="text-[#574BFF]">AI</span>Test
        </span>
      </div>
      <div className="w-px h-4 bg-[#E5E6EB]" />
      <ProjectSwitcher />
      <div className="ml-auto flex items-center gap-1 text-[#646A73]">
        <button
          aria-label="消息通知"
          className="w-8 h-8 rounded-md grid place-items-center hover:bg-[#F2F3F5] cursor-pointer"
          onClick={() => router.push("/")}
        >
          <Badge dot color="#574BFF">
            <Bell size={16} strokeWidth={1.8} />
          </Badge>
        </button>
        <button
          aria-label="帮助"
          className="w-8 h-8 rounded-md grid place-items-center hover:bg-[#F2F3F5] cursor-pointer"
          onClick={() => window.open("https://metersphere.io/docs/v3.x/", "_blank")}
        >
          <HelpCircle size={16} strokeWidth={1.8} />
        </button>
        <Dropdown
          menu={{
            items: [{ key: "logout", icon: <LogOut size={14} />, label: "退出登录" }],
            onClick: async ({ key }) => {
              if (key === "logout") {
                await fetch("/api/v1/auth/logout", { method: "POST" });
                window.location.href = "/login";
              }
            },
          }}
        >
          <Avatar
            data-testid="user-avatar"
            size={28}
            style={{ background: "#574BFF", cursor: "pointer", fontSize: 12 }}
          >
            {(email ?? "U").slice(0, 1).toUpperCase()}
          </Avatar>
        </Dropdown>
      </div>
    </header>
  );
}

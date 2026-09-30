"use client";

import { Avatar, Badge, Dropdown, Empty } from "antd";
import { HelpCircle, LogOut, Bell, Sparkles, UserCircle2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { notificationApi, themeApi, type ThemeParam } from "@rabbit/api-client";
import { ProjectSwitcher } from "./ProjectSwitcher";
import { OrgSwitcher } from "./OrgSwitcher";
import { AiAssistantDrawer } from "./ai/AiAssistantDrawer";

/** 顶栏（SYS-003 视觉基线；S7 AI 助手入口；S9 ENTP-001 组织切换器 + ENTP-004 品牌定制）。 */
export function TopBar({ email }: { email?: string }) {
  const router = useRouter();
  const [aiOpen, setAiOpen] = useState(false);
  // ENTP-004：品牌定制（公开 theme；失败/未配置=默认品牌）
  const themeQ = useQuery({
    queryKey: ["public-theme"],
    queryFn: () => themeApi.publicTheme(),
    staleTime: 60_000,
    retry: false,
  });
  const theme = themeQ.data;
  const primary = theme?.primaryColor || "#574BFF";

  // S5 MSG-001：未读数徽标（30s 轮询）
  const unread = useQuery({
    queryKey: ["notifications-unread"],
    queryFn: () => notificationApi.unreadCount(),
    refetchInterval: 30_000,
  });
  const [bellOpen, setBellOpen] = useState(false);
  const recent = useQuery({
    queryKey: ["notifications-recent", bellOpen],
    queryFn: () => notificationApi.list({ page: 1, pageSize: 10 }),
    enabled: bellOpen,
  });
  const [seenCount, setSeenCount] = useState(0);
  useEffect(() => {
    if (bellOpen && unread.data) {
      // 打开面板即视为已查看：标记全部已读（基线「右上角查看+标记已读」口径）
      setSeenCount(unread.data.count);
      void notificationApi.markAllRead().then(() => {
        void unread.refetch();
      });
    }
  }, [bellOpen, unread.data?.count]);
  const badgeCount = Math.max(0, (unread.data?.count ?? 0) - (bellOpen ? seenCount : 0));
  return (
    <header
      data-testid="topbar"
      className="h-12 bg-white border-b border-[#E5E6EB] flex items-center px-4 gap-3 sticky top-0 z-20"
    >
      <div className="flex items-center gap-2 select-none" data-testid="topbar-brand">
        {theme?.platformLogo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={theme.platformLogo} alt="logo" className="w-7 h-7 rounded-lg object-cover" />
        ) : (
          <span
            className="w-7 h-7 rounded-lg text-white grid place-items-center text-[13px] font-bold shadow-sm"
            style={{ background: `linear-gradient(135deg, ${primary}, ${primary}CC)` }}
          >
            R
          </span>
        )}
        <span className="font-semibold text-[15px] tracking-tight text-[#1F2329]">
          {theme?.platformName || (
            <>
              Rabbit<span style={{ color: primary }}>AI</span>Test
            </>
          )}
        </span>
      </div>
      <div className="w-px h-4 bg-[#E5E6EB]" />
      <OrgSwitcher />
      <ProjectSwitcher />
      <div className="ml-auto flex items-center gap-1 text-[#646A73]">
        <button
          aria-label="AI 助手"
          title="AI 助手"
          data-testid="topbar-ai-assistant"
          className={`w-8 h-8 rounded-md grid place-items-center cursor-pointer ${aiOpen ? "bg-[#574BFF]/10 text-[#574BFF]" : "hover:bg-[#F2F3F5]"}`}
          onClick={() => setAiOpen(true)}
        >
          <Sparkles size={16} strokeWidth={1.8} />
        </button>
        <Dropdown
          trigger={["click"]}
          open={bellOpen}
          onOpenChange={(open) => setBellOpen(open)}
          popupRender={() => (
            <div
              className="bg-white border rounded-md shadow-md w-80 p-2"
              data-testid="bell-dropdown"
            >
              {(recent.data?.items ?? []).length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无通知" />
              ) : (
                <div className="divide-y max-h-80 overflow-auto">
                  {(recent.data?.items ?? []).map((n) => (
                    <div key={n.id} className="p-2 flex gap-2">
                      <span
                        className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${n.readAt ? "bg-transparent" : "bg-[#574BFF]"}`}
                      />
                      <div>
                        <p className="text-[13px] leading-snug">{n.title}</p>
                        <p className="text-xs text-gray-400">
                          {n.createdAt.replace("T", " ").slice(0, 16)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <button
                className="w-full border-t pt-1.5 mt-1 text-center text-xs text-[#574BFF] cursor-pointer"
                onClick={() => {
                  setBellOpen(false);
                  router.push("/personal/notifications");
                }}
                data-testid="bell-view-all"
              >
                查看全部
              </button>
            </div>
          )}
        >
          <button
            aria-label="消息通知"
            data-testid="header-bell"
            className="w-8 h-8 rounded-md grid place-items-center hover:bg-[#F2F3F5] cursor-pointer"
          >
            <Badge count={badgeCount} size="small" title="未读通知">
              <Bell size={16} strokeWidth={1.8} />
            </Badge>
          </button>
        </Dropdown>
        <button
          aria-label="帮助"
          className="w-8 h-8 rounded-md grid place-items-center hover:bg-[#F2F3F5] cursor-pointer"
          onClick={() =>
            window.open(theme?.helpUrl || "https://metersphere.io/docs/v3.x/", "_blank")
          }
        >
          <HelpCircle size={16} strokeWidth={1.8} />
        </button>
        <Dropdown
          menu={{
            items: [
              { key: "personal", icon: <UserCircle2 size={14} />, label: "个人中心" },
              { key: "logout", icon: <LogOut size={14} />, label: "退出登录" },
            ],
            onClick: async ({ key }) => {
              if (key === "personal") router.push("/personal");
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
            style={{ background: primary, cursor: "pointer", fontSize: 12 }}
          >
            {(email ?? "U").slice(0, 1).toUpperCase()}
          </Avatar>
        </Dropdown>
      </div>
      <AiAssistantDrawer open={aiOpen} onClose={() => setAiOpen(false)} />
    </header>
  );
}

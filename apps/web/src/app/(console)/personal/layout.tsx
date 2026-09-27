"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const MENU = [
  { href: "/personal", label: "个人信息", key: "me" },
  { href: "/personal/password", label: "修改密码", key: "password" },
  { href: "/personal/api-keys", label: "APIKEY", key: "api-keys" },
  { href: "/personal/local-runner", label: "本地执行", key: "local-runner" },
  { href: "/personal/ai-model", label: "模型设置", key: "ai-model" },
];

/** SYS-007：个人中心容器（左子菜单 + 内容区；个人资源无权限点，登录即本人）。 */
export default function PersonalLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="flex gap-4 items-start" data-testid="personal-center">
      <aside className="w-44 shrink-0 rabbit-card py-1">
        <p className="px-3 pt-2 pb-1 text-xs text-gray-400">个人中心</p>
        {MENU.map((m) => {
          const active = pathname === m.href;
          return (
            <Link
              key={m.key}
              href={m.href}
              data-testid={`personal-menu-${m.key}`}
              className={`block px-3 py-2 mx-1 rounded-md text-[13px] ${active ? "bg-[#574BFF]/8 text-[#574BFF] font-medium" : "text-[#3D4350] hover:bg-[#F2F3F5]"}`}
            >
              {m.label}
            </Link>
          );
        })}
      </aside>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

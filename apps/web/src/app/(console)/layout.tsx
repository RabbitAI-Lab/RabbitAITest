import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { TopBar } from "@/components/TopBar";
import { NavShell } from "./NavShell";

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session.userId) redirect("/login");
  return (
    <div className="min-h-screen">
      <TopBar email={session.email} />
      {/* SYS-010：三域侧栏 + 多标签栏 + 收起/展开编排（客户端壳统一管理） */}
      <NavShell>{children}</NavShell>
    </div>
  );
}

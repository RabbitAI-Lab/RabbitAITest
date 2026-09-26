'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Bug, FlaskConical, LayoutDashboard, Network, ScrollText } from 'lucide-react';

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
  soon?: boolean;
}

const groups: { label: string; items: NavItem[] }[] = [
  {
    label: '工作区',
    items: [
      { href: '/', label: '工作台', icon: <LayoutDashboard size={15} strokeWidth={1.8} /> },
    ],
  },
  {
    label: '测试管理',
    items: [
      { href: '/cases', label: '测试用例', icon: <ScrollText size={15} strokeWidth={1.8} /> },
      { href: '/plans', label: '测试计划', icon: <Network size={15} strokeWidth={1.8} />, soon: true },
      { href: '/bugs', label: '缺陷管理', icon: <Bug size={15} strokeWidth={1.8} />, soon: true },
    ],
  },
  {
    label: '接口测试',
    items: [
      { href: '/debug', label: '接口调试', icon: <FlaskConical size={15} strokeWidth={1.8} /> },
    ],
  },
];

/** 左侧导航：分组 + 图标 + 激活态（精确匹配防前缀误命中，react-nextjs §5.6）。 */
export function LeftNav() {
  const pathname = usePathname();
  return (
    <aside
      data-testid="leftnav"
      className="w-[208px] bg-white border-r border-[#E5E6EB] shrink-0 pb-4 overflow-y-auto"
    >
      {groups.map((g) => (
        <div key={g.label}>
          <p className="nav-group-label">{g.label}</p>
          {g.items.map((item) => {
            const active =
              item.href === '/' ? pathname === '/' : pathname === item.href || pathname.startsWith(item.href + '/');
            const cls = `relative flex items-center gap-2.5 mx-2 px-3 py-[7px] rounded-md text-[13px] transition-colors ${
              item.soon
                ? 'text-[#C0C4CC] cursor-default'
                : active
                  ? 'bg-[#574BFF]/8 text-[#574BFF] font-medium'
                  : 'text-[#3D4350] hover:bg-[#F2F3F5]'
            }`;
            // 占位项不用 Link（避免 Next 预取不存在路由产生 404 console 噪声）
            return item.soon ? (
              <span key={item.href} aria-disabled className={cls}>
                {item.icon}
                {item.label}
                <span className="ml-auto text-[10px] border border-[#E5E6EB] rounded px-1 text-[#A8ABB0]">S1</span>
              </span>
            ) : (
              <Link key={item.href} href={item.href} className={cls}>
                {active && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-4 rounded-r bg-[#574BFF]" />
                )}
                {item.icon}
                {item.label}
              </Link>
            );
          })}
        </div>
      ))}
    </aside>
  );
}

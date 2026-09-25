'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const nav = [
  { href: '/', label: '工作台' },
  { href: '/cases', label: '测试用例' },
  { href: '/debug', label: '接口测试 · 调试' },
];

/** 左侧导航：active 用全等或前缀+尾斜杠（react-nextjs §5.6 精确匹配防误命中）。 */
export function LeftNav() {
  const pathname = usePathname();
  return (
    <aside className="w-[200px] bg-white border-r p-2 text-sm shrink-0" data-testid="leftnav">
      {nav.map((item) => {
        const active = item.href === '/' ? pathname === '/' : pathname === item.href || pathname.startsWith(item.href + '/');
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`block px-3 py-2 rounded ${active ? 'bg-[#574BFF]/10 text-[#574BFF] font-medium' : 'hover:bg-gray-50'}`}
          >
            {item.label}
          </Link>
        );
      })}
    </aside>
  );
}

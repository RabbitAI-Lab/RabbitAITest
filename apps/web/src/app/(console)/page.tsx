'use client';

import { Rocket, ScrollText, Zap } from 'lucide-react';
import Link from 'next/link';
import { PageHeader } from '@/components/PageHeader';

export default function DashboardPage() {
  return (
    <div className="max-w-[1080px]">
      <PageHeader title="工作台" sub="当前项目的测试概况与快捷入口" />
      <div className="grid grid-cols-3 gap-4">
        <Link href="/cases" className="rabbit-card p-5 block hover:shadow-md transition-shadow">
          <div className="w-9 h-9 rounded-lg bg-[#574BFF]/10 text-[#574BFF] grid place-items-center mb-3">
            <ScrollText size={18} strokeWidth={1.8} />
          </div>
          <p className="text-[13px] text-[#646A73]">功能用例</p>
          <p className="text-xl font-semibold mt-1" data-testid="stat-cases">进入用例列表</p>
        </Link>
        <Link href="/debug" className="rabbit-card p-5 block hover:shadow-md transition-shadow">
          <div className="w-9 h-9 rounded-lg bg-[#00B42A]/10 text-[#00B42A] grid place-items-center mb-3">
            <Zap size={18} strokeWidth={1.8} />
          </div>
          <p className="text-[13px] text-[#646A73]">调试执行</p>
          <p className="text-xl font-semibold mt-1" data-testid="stat-exec">发起一次接口调试</p>
        </Link>
        <div className="rabbit-card p-5">
          <div className="w-9 h-9 rounded-lg bg-[#FF7D00]/10 text-[#FF7D00] grid place-items-center mb-3">
            <Rocket size={18} strokeWidth={1.8} />
          </div>
          <p className="text-[13px] text-[#646A73]">Sprint 0 · POC</p>
          <p className="text-[13px] mt-1 text-[#87888D]">更多看板与统计在 Sprint 1 交付</p>
        </div>
      </div>
    </div>
  );
}

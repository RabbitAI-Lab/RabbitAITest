'use client';

import { Card, Typography } from 'antd';

export default function DashboardPage() {
  return (
    <div>
      <Typography.Title level={4}>工作台</Typography.Title>
      <div className="grid grid-cols-3 gap-4">
        <Card><p className="text-xs text-gray-400">功能用例</p><p className="text-2xl font-semibold" data-testid="stat-cases">见「测试用例」</p></Card>
        <Card><p className="text-xs text-gray-400">调试执行</p><p className="text-2xl font-semibold" data-testid="stat-exec">见「接口测试 · 调试」</p></Card>
        <Card><p className="text-xs text-gray-400">Sprint 0</p><p className="text-sm mt-2">POC 骨架 · 更多看板 Sprint 1 交付</p></Card>
      </div>
    </div>
  );
}

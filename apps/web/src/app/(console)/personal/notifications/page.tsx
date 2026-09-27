"use client";

import { Button, Empty, Table, Tag } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { notificationApi } from "@rabbit/api-client";
import { useApp } from "@/hooks/useApp";

/** MSG-001：我的通知（近 90 天；未读筛选/单条已读/全部已读）。 */
export default function PersonalNotificationsPage() {
  const qc = useQueryClient();
  const { message } = useApp();
  const [page, setPage] = useState(1);
  const [unreadOnly, setUnreadOnly] = useState(false);

  const q = useQuery({
    queryKey: ["notifications", page, unreadOnly],
    queryFn: () => notificationApi.list({ page, pageSize: 20, unread: unreadOnly }),
  });
  const markRead = useMutation({
    mutationFn: (id: string) => notificationApi.markRead(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["notifications"] }),
  });
  const markAll = useMutation({
    mutationFn: () => notificationApi.markAllRead(),
    onSuccess: (r) => {
      message.success(`已标记 ${r.updated} 条为已读`);
      void qc.invalidateQueries({ queryKey: ["notifications"] });
    },
  });

  return (
    <div className="rabbit-card p-4" data-testid="page-personal-notifications">
      <div className="flex items-center gap-2 mb-2">
        <Button size="small" type={unreadOnly ? "primary" : "default"} onClick={() => { setUnreadOnly(!unreadOnly); setPage(1); }}>
          未读
        </Button>
        <span className="text-xs text-gray-400">仅展示近 90 天</span>
        <Button className="ml-auto" size="small" onClick={() => markAll.mutate()} data-testid="btn-read-all">
          全部已读
        </Button>
      </div>
      <Table
        rowKey="id"
        size="small"
        loading={q.isLoading}
        dataSource={q.data?.items ?? []}
        pagination={{ total: q.data?.total ?? 0, current: page, pageSize: 20, showSizeChanger: false, onChange: setPage }}
        locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无通知" /> }}
        columns={[
          {
            title: "状态",
            dataIndex: "readAt",
            width: 80,
            render: (v: string | null) => (v ? <span className="text-xs text-gray-400">已读</span> : <Tag color="processing">未读</Tag>),
          },
          { title: "标题", dataIndex: "title" },
          { title: "时间", dataIndex: "createdAt", width: 150, render: (v: string) => <span className="text-xs text-gray-400">{v.replace("T", " ").slice(0, 16)}</span> },
          {
            title: "操作",
            width: 90,
            render: (_: unknown, r: { id: string; readAt: string | null }) =>
              r.readAt ? null : (
                <Button size="small" type="link" onClick={() => markRead.mutate(r.id)}>
                  标记已读
                </Button>
              ),
          },
        ]}
      />
    </div>
  );
}

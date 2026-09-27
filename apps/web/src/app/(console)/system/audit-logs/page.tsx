"use client";

import { Button, Input, Select, Table, Tag } from "antd";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { auditApi, type AuditLogRow } from "@rabbit/api-client";
import { PageHeader } from "@/components/PageHeader";

const fmt = (v: string) => v.replace("T", " ").slice(0, 19);

/** SYS-008：系统日志（三级面之 system；高级查询 + 分页）。 */
export default function SystemAuditLogsPage() {
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [action, setAction] = useState("");
  const [objectType, setObjectType] = useState<string | undefined>(undefined);
  const [query, setQuery] = useState<{ keyword?: string; action?: string; objectType?: string }>({});

  const { data, isLoading } = useQuery({
    queryKey: ["audit-logs", "system", query, page],
    queryFn: () => auditApi.system({ ...query, page, pageSize: 20 }),
  });

  const columns = [
    { title: "时间", dataIndex: "createdAt", width: 170, render: (v: string) => <span className="text-xs text-gray-400">{fmt(v)}</span> },
    { title: "操作人", dataIndex: "userName", width: 110, render: (v: string | null, r: AuditLogRow) => v ?? r.userId?.slice(0, 8) ?? "system" },
    { title: "动作", dataIndex: "action", width: 170, render: (v: string) => (
      <code className="text-[11px] bg-gray-100 rounded px-1.5 py-0.5">{v}</code>
    ) },
    { title: "对象", dataIndex: "objectType", width: 130, render: (v: string, r: AuditLogRow) => (
      <span className="text-xs">
        {v} {r.objectId && <code className="text-gray-400" title={r.objectId}>{r.objectId.slice(0, 6)}</code>}
      </span>
    ) },
    { title: "摘要", dataIndex: "detail", render: (v: unknown) => (
      <span className="text-xs text-gray-500 truncate inline-block max-w-[340px] align-middle">
        {v ? JSON.stringify(v).slice(0, 120) : "—"}
      </span>
    ) },
    { title: "IP", dataIndex: "ip", width: 120, render: (v: string | null) => <code className="text-[11px] text-gray-400">{v ?? "—"}</code> },
    { title: "范围", dataIndex: "scope", width: 80, render: (v: string) => <Tag>{v}</Tag> },
  ];

  return (
    <div className="p-4" data-testid="page-system-audit-logs">
      <PageHeader
        title="系统日志"
        sub="全量操作审计（只读不可篡改；保留时长见 系统参数 › 数据清理）；组织/项目日志面经对应设置入口进入"
      />
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <Input.Search
          placeholder="关键字（摘要内搜索）"
          className="w-56"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onSearch={() => {
            setPage(1);
            setQuery({ keyword: keyword || undefined, action: action || undefined, objectType });
          }}
          data-testid="audit-keyword"
        />
        <Input
          placeholder="动作前缀（如 bug. / plugin. / open.）"
          className="w-52"
          value={action}
          onChange={(e) => setAction(e.target.value)}
        />
        <Select
          allowClear
          placeholder="对象类型"
          className="w-36"
          value={objectType}
          onChange={setObjectType}
          options={["bug", "plugin", "scenario", "user", "api_key", "platform_integration", "api_call"].map((v) => ({ value: v, label: v }))}
        />
        <Button
          type="primary"
          onClick={() => {
            setPage(1);
            setQuery({ keyword: keyword || undefined, action: action || undefined, objectType });
          }}
          data-testid="audit-search-btn"
        >
          查询
        </Button>
      </div>
      <Table
        rowKey="id"
        size="small"
        loading={isLoading}
        columns={columns}
        dataSource={data?.list ?? []}
        pagination={{
          current: page,
          pageSize: 20,
          total: data?.total ?? 0,
          showTotal: (t) => `共 ${t} 条`,
          onChange: setPage,
        }}
      />
    </div>
  );
}

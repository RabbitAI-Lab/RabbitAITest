'use client';

import { Button, Input, Popconfirm, Select, Table, Tag } from 'antd';
import { Plus, RotateCcw, Trash2 } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { caseApi, ApiError } from '@rabbit/api-client';
import type { CaseDetail, CaseLevel } from '@rabbit/shared';
import { useProjectStore } from '@/stores/project';
import { PageHeader } from '@/components/PageHeader';
import { useApp } from '@/hooks/useApp';

const levelColor: Record<string, string> = { P0: 'red', P1: 'orange', P2: 'blue', P3: 'default' };

export default function CaseListPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { message } = useApp();
  const { currentProjectId } = useProjectStore();
  const [recycled, setRecycled] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [level, setLevel] = useState<CaseLevel | undefined>();
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['case', 'list', currentProjectId, recycled, keyword, level, page],
    queryFn: () => caseApi.list(currentProjectId!, { page, pageSize: 20, keyword, level, recycled }),
    enabled: Boolean(currentProjectId),
  });

  async function onDelete(id: string) {
    try {
      await caseApi.remove(currentProjectId!, id);
      message.success(recycled ? '已移入回收站' : '已删除');
      void qc.invalidateQueries({ queryKey: ['case'] });
    } catch (e) {
      message.error(e instanceof ApiError ? e.message : '删除失败');
    }
  }

  return (
    <div>
      <PageHeader
        title={recycled ? '回收站' : '功能用例'}
        sub={recycled ? '已删除用例可恢复或彻底删除' : '项目内全部功能测试用例'}
        extra={
          <div className="flex items-center gap-2">
            <div className="flex bg-white border border-[#E5E6EB] rounded-md p-0.5 text-[13px]">
              <span
                data-testid="tab-all"
                className={`px-3 py-1 rounded cursor-pointer transition-colors ${!recycled ? 'bg-[#574BFF]/8 text-[#574BFF] font-medium' : 'text-[#646A73]'}`}
                onClick={() => { setRecycled(false); setPage(1); }}
              >
                全部
              </span>
              <span
                data-testid="tab-recycle"
                className={`px-3 py-1 rounded cursor-pointer transition-colors ${recycled ? 'bg-[#574BFF]/8 text-[#574BFF] font-medium' : 'text-[#646A73]'}`}
                onClick={() => { setRecycled(true); setPage(1); }}
              >
                回收站
              </span>
            </div>
            {!recycled && (
              <Button type="primary" icon={<Plus size={14} />} onClick={() => router.push('/cases/new')} data-testid="btn-new-case">
                新建用例
              </Button>
            )}
          </div>
        }
      />

      <div className="rabbit-card">
        <div className="flex gap-2 p-3 border-b border-[#F0F1F3]">
          <Input.Search
            placeholder="搜索用例名称"
            className="w-64"
            allowClear
            data-testid="input-keyword"
            onSearch={(v) => { setKeyword(v); setPage(1); }}
          />
          <Select
            className="w-32"
            allowClear
            placeholder="等级"
            data-testid="select-level"
            onChange={(v) => { setLevel(v as CaseLevel | undefined); setPage(1); }}
            options={['P0', 'P1', 'P2', 'P3'].map((l) => ({ value: l, label: l }))}
          />
        </div>
        <Table<CaseDetail>
          rowKey="id"
          data-testid="case-table"
          loading={isLoading}
          dataSource={data?.items ?? []}
          pagination={{
            current: page,
            pageSize: 20,
            total: data?.total ?? 0,
            onChange: setPage,
            showTotal: (t) => `共 ${t} 条`,
          }}
          columns={[
            { title: '编号', dataIndex: 'num', width: 100, render: (n: number) => <span className="text-[#87888D]">C-{String(n).padStart(4, '0')}</span> },
            {
              title: '用例名称',
              dataIndex: 'name',
              render: (name: string, r) => (
                <a className="text-[#1F2329] hover:text-[#574BFF] font-medium" href={`/cases/${r.id}`}>{name}</a>
              ),
            },
            { title: '等级', dataIndex: 'level', width: 72, render: (l: string) => <Tag color={levelColor[l]}>{l}</Tag> },
            { title: '标签', dataIndex: 'tags', width: 170, render: (tags: string[]) => tags.length ? tags.map((t) => <Tag key={t} bordered={false} color="processing">{t}</Tag>) : <span className="text-[#C0C4CC]">—</span> },
            { title: '更新时间', dataIndex: 'updatedAt', width: 120, render: (s: string) => <span className="text-[#87888D]">{s.slice(0, 10)}</span> },
            {
              title: '操作',
              key: 'ops',
              width: recycled ? 180 : 120,
              render: (_, r) => recycled ? (
                <span className="flex items-center gap-1">
                  <Button type="link" size="small" icon={<RotateCcw size={13} />} data-testid={`btn-restore-${r.num}`} onClick={async () => {
                    await caseApi.restore(currentProjectId!, r.id);
                    message.success('已恢复');
                    void qc.invalidateQueries({ queryKey: ['case'] });
                  }}>恢复</Button>
                  <Popconfirm
                    title="彻底删除"
                    description="该操作不可恢复，确认删除？"
                    okText="彻底删除"
                    okButtonProps={{ danger: true }}
                    onConfirm={async () => {
                      await caseApi.purge(currentProjectId!, r.id);
                      message.success('已彻底删除');
                      void qc.invalidateQueries({ queryKey: ['case'] });
                    }}
                  >
                    <Button type="link" size="small" danger icon={<Trash2 size={13} />}>彻底删除</Button>
                  </Popconfirm>
                </span>
              ) : (
                <span className="flex items-center gap-1">
                  <a className="text-[#574BFF] hover:opacity-80" href={`/cases/${r.id}`}>编辑</a>
                  <span className="text-[#E5E6EB]">|</span>
                  <Button type="link" size="small" danger onClick={() => onDelete(r.id)}>删除</Button>
                </span>
              ),
            },
          ]}
        />
      </div>
    </div>
  );
}

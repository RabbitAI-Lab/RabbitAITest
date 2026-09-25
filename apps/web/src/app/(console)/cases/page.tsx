'use client';

import { App, Button, Input, Popconfirm, Select, Table, Tag } from 'antd';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { caseApi, ApiError } from '@rabbit/api-client';
import type { CaseLevel } from '@rabbit/shared';
import type { CaseDetail } from '@rabbit/shared';
import { useProjectStore } from '@/stores/project';

const levelColor: Record<string, string> = { P0: 'red', P1: 'orange', P2: 'blue', P3: 'default' };

export default function CaseListPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { message } = App.useApp();
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
      <div className="flex items-center gap-3 mb-4">
        <h1 className="text-lg font-medium m-0">功能用例</h1>
        <span
          className={`text-xs pb-0.5 border-b-2 cursor-pointer ${!recycled ? 'border-[#574BFF] text-[#574BFF]' : 'border-transparent text-gray-400'}`}
          onClick={() => { setRecycled(false); setPage(1); }}
          data-testid="tab-all"
        >
          全部
        </span>
        <span
          className={`text-xs pb-0.5 border-b-2 cursor-pointer ${recycled ? 'border-[#574BFF] text-[#574BFF]' : 'border-transparent text-gray-400'}`}
          onClick={() => { setRecycled(true); setPage(1); }}
          data-testid="tab-recycle"
        >
          回收站
        </span>
        {!recycled && (
          <Button type="primary" className="ml-auto" onClick={() => router.push('/cases/new')} data-testid="btn-new-case">
            ＋ 新建用例
          </Button>
        )}
      </div>

      <div className="bg-white border rounded">
        <div className="flex gap-2 p-3 border-b">
          <Input.Search
            placeholder="用例名称"
            className="w-56"
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
            { title: '编号', dataIndex: 'num', width: 90, render: (n: number) => <span className="text-gray-500">C-{String(n).padStart(4, '0')}</span> },
            {
              title: '用例名称',
              dataIndex: 'name',
              render: (name: string, r) => (
                <a className="text-[#574BFF]" href={`/cases/${r.id}`}>{name}</a>
              ),
            },
            { title: '等级', dataIndex: 'level', width: 70, render: (l: string) => <Tag color={levelColor[l]}>{l}</Tag> },
            { title: '标签', dataIndex: 'tags', width: 160, render: (tags: string[]) => tags.length ? tags.map((t) => <Tag key={t}>{t}</Tag>) : '—' },
            { title: '更新时间', dataIndex: 'updatedAt', width: 120, render: (s: string) => s.slice(0, 10) },
            {
              title: '操作',
              key: 'ops',
              width: recycled ? 160 : 110,
              render: (_, r) => recycled ? (
                <span className="text-gray-500">
                  <Button type="link" size="small" data-testid={`btn-restore-${r.num}`} onClick={async () => {
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
                    <Button type="link" size="small" danger>彻底删除</Button>
                  </Popconfirm>
                </span>
              ) : (
                <span className="text-gray-500">
                  <a className="text-[#574BFF] mr-2" href={`/cases/${r.id}`}>编辑</a>
                  <Button type="link" size="small" danger className="px-0" onClick={() => onDelete(r.id)}>删除</Button>
                </span>
              ),
            },
          ]}
        />
      </div>
    </div>
  );
}

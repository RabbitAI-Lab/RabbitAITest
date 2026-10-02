"use client";

/** S11 UIT-002：元素库（/ui-test/elements）——定位器仓库 CRUD。 */
import { Button, Form, Input, Modal, Select, Spin, Table, Tag, message } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { uitApi, ApiError, type UiElementRow } from "@rabbit/api-client";
import type { UiLocatorType } from "@rabbit/shared";
import { PageHeader } from "@/components/PageHeader";
import { useProjectStore } from "@/stores/project";

const LOCATOR_TYPES: { value: UiLocatorType; label: string }[] = [
  { value: "css", label: "css" },
  { value: "xpath", label: "xpath" },
  { value: "testid", label: "testid" },
  { value: "text", label: "text" },
  { value: "role", label: "role（button[name=提交] 简写）" },
];

const TYPE_COLOR: Record<string, string> = {
  testid: "purple",
  role: "gold",
  css: "default",
  xpath: "geekblue",
  text: "cyan",
};

export default function UiElementsPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { currentProjectId } = useProjectStore();
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<UiElementRow | null>(null);
  const [form] = Form.useForm();
  const [msg, msgCtx] = message.useMessage();

  const { data, isLoading } = useQuery({
    queryKey: ["ui-elements", currentProjectId, page],
    queryFn: () => uitApi.elements(currentProjectId!, { page }),
    enabled: Boolean(currentProjectId),
  });

  const saveMut = useMutation({
    mutationFn: (v: {
      name: string;
      locatorType: UiLocatorType;
      locator: string;
      description?: string;
    }) =>
      editing
        ? uitApi.updateElement(currentProjectId!, editing.id, v)
        : uitApi.createElement(currentProjectId!, v),
    onSuccess: () => {
      msg.success("已保存");
      setOpen(false);
      setEditing(null);
      form.resetFields();
      void qc.invalidateQueries({ queryKey: ["ui-elements"] });
    },
    onError: (e) => msg.error(e instanceof ApiError ? e.message : "保存失败"),
  });

  const delMut = useMutation({
    mutationFn: (id: string) => uitApi.removeElement(currentProjectId!, id),
    onSuccess: () => {
      msg.success("已删除");
      void qc.invalidateQueries({ queryKey: ["ui-elements"] });
    },
  });

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-[1100px]" data-testid="uit-elements-page">
      {msgCtx}
      <PageHeader
        title="元素库"
        sub="UI 测试 · 定位器仓库（用例按名称引用；删除后用例执行报「元素已删除」CONFIG_ERROR，不级联删）"
        extra={
          <Button
            type="primary"
            data-testid="uit-element-create"
            onClick={() => {
              setEditing(null);
              form.resetFields();
              setOpen(true);
            }}
          >
            新建元素
          </Button>
        }
      />
      <Spin spinning={isLoading}>
        <Table<UiElementRow>
          rowKey="id"
          size="small"
          dataSource={data?.list ?? []}
          data-testid="uit-elements-table"
          pagination={{
            current: page,
            pageSize: 50,
            total: data?.total ?? 0,
            onChange: setPage,
            showSizeChanger: false,
          }}
          columns={[
            { title: "名称", dataIndex: "name" },
            {
              title: "定位方式",
              dataIndex: "locatorType",
              width: 110,
              render: (v: string) => <Tag color={TYPE_COLOR[v] ?? "default"}>{v}</Tag>,
            },
            {
              title: "定位器",
              dataIndex: "locator",
              render: (v: string) => <span className="font-mono text-xs text-slate-500">{v}</span>,
            },
            {
              title: "备注",
              dataIndex: "description",
              render: (v: string | null) => (
                <span className="text-xs text-slate-400">{v || "—"}</span>
              ),
            },
            {
              title: "操作",
              key: "ops",
              width: 120,
              render: (_, r) => (
                <span className="space-x-3">
                  <a
                    className="text-slate-500"
                    onClick={() => {
                      setEditing(r);
                      form.setFieldsValue(r);
                      setOpen(true);
                    }}
                  >
                    编辑
                  </a>
                  <a
                    className="text-red-400"
                    onClick={() =>
                      Modal.confirm({
                        title: `删除元素「${r.name}」？`,
                        content: "引用它的用例保存不受影响，执行时报「元素已删除」",
                        onOk: () => delMut.mutateAsync(r.id),
                      })
                    }
                  >
                    删除
                  </a>
                </span>
              ),
            },
          ]}
        />
      </Spin>
      <div className="text-xs text-slate-400">
        <a className="text-[#574BFF]" onClick={() => router.push("/ui-test")}>
          返回用例列表
        </a>
      </div>
      <Modal
        title={editing ? "编辑元素" : "新建元素"}
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => form.validateFields().then((v) => saveMut.mutate(v))}
        confirmLoading={saveMut.isPending}
      >
        <Form form={form} layout="vertical" initialValues={{ locatorType: "css" }}>
          {/* Form.Item 直挂控件（不得再包 span wrapper——断受控链致 validateFields 落 initialValues，e2e S11 教训）；
              testid 挂在 Form.Item 自身（antd 透传到 field 容器，spec 用 getByTestId(...).locator("input")/(".ant-select") 取内层） */}
          <Form.Item
            name="name"
            label="名称"
            rules={[{ required: true, max: 128 }]}
            data-testid="uit-element-name"
          >
            <Input placeholder="如：提交按钮" />
          </Form.Item>
          <Form.Item
            name="locatorType"
            label="定位方式"
            rules={[{ required: true }]}
            data-testid="uit-element-type"
          >
            <Select options={LOCATOR_TYPES} className="w-full" />
          </Form.Item>
          <Form.Item
            name="locator"
            label="定位器"
            rules={[{ required: true, max: 512 }]}
            data-testid="uit-element-locator"
          >
            <Input
              placeholder="css 选择器 / xpath / testid 值 / 文本 / role 简写"
              className="font-mono"
            />
          </Form.Item>
          <Form.Item name="description" label="备注" data-testid="uit-element-desc">
            <Input maxLength={512} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

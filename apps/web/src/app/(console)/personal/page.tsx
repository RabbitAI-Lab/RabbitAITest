"use client";

import { Avatar, Button, Form, Input, message } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { authApi, personalApi } from "@rabbit/api-client";

/** SYS-007：个人信息（头像=姓名首字母色块；邮箱=登录名不可改）。 */
export default function PersonalMePage() {
  const qc = useQueryClient();
  const [form] = Form.useForm();
  const me = useQuery({ queryKey: ["personal-me"], queryFn: () => authApi.me() });

  const save = useMutation({
    mutationFn: (v: { name: string; phone: string }) => personalApi.updateMe(v),
    onSuccess: () => {
      message.success("已保存");
      void qc.invalidateQueries({ queryKey: ["personal-me"] });
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "保存失败"),
  });

  const email = me.data?.email ?? "";
  const name = me.data?.name ?? "";
  // 查询返回后回填（initialValues 仅首帧生效）
  useEffect(() => {
    if (me.data) form.setFieldsValue({ name: me.data.name, phone: "" });
  }, [me.data, form]);

  return (
    <div className="rabbit-card p-4" data-testid="page-personal-me">
      <div className="flex gap-4 items-start">
        <Avatar size={64} style={{ background: "#574BFF", fontSize: 24 }}>
          {(name || email || "U").slice(0, 1).toUpperCase()}
        </Avatar>
        <Form
          form={form}
          layout="vertical"
          className="flex-1 max-w-md"
          initialValues={{ name, phone: "" }}
          onFinish={(v) => save.mutate({ name: v.name, phone: v.phone ?? "" })}
        >
          <Form.Item label="邮箱（登录名，不可修改）">
            <Input value={email} disabled />
          </Form.Item>
          <Form.Item name="name" label="姓名" rules={[{ required: true, message: "必填" }]}>
            <Input data-testid="personal-name-input" />
          </Form.Item>
          <Form.Item name="phone" label="手机（选填）">
            <Input data-testid="personal-phone-input" />
          </Form.Item>
          <Button
            type="primary"
            htmlType="submit"
            loading={save.isPending}
            data-testid="personal-save-btn"
          >
            保存
          </Button>
        </Form>
      </div>
      <p className="text-xs text-gray-400 mt-2">头像为姓名首字母色块（上传头像登记 Backlog）</p>
    </div>
  );
}

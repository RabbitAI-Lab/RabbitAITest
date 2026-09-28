"use client";

import { Alert, Button, Form, Input, message } from "antd";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { personalApi } from "@rabbit/api-client";

/** SYS-007：修改密码（旧密码错 422；成功后用新密码重新登录验证口径）。 */
export default function PersonalPasswordPage() {
  const [form] = Form.useForm();
  const router = useRouter();
  const [err, setErr] = useState("");
  const change = useMutation({
    mutationFn: (v: { oldPassword: string; newPassword: string }) => personalApi.changePassword(v),
    onSuccess: async () => {
      message.success("密码已修改（无状态会话口径见下方说明）");
      form.resetFields();
      // 改密后旧凭证失效性验证留在登录页；当前会话保留
      setErr("");
      void router.prefetch("/login");
    },
    onError: (e) => setErr(e instanceof Error ? e.message : "修改失败"),
  });
  return (
    <div className="rabbit-card p-4 max-w-md" data-testid="page-personal-password">
      <Form form={form} layout="vertical" onFinish={(v) => change.mutate(v)}>
        <Form.Item name="oldPassword" label="当前密码" rules={[{ required: true, message: "必填" }]}>
          <Input.Password data-testid="password-old-input" />
        </Form.Item>
        <Form.Item name="newPassword" label="新密码" rules={[{ required: true }, { min: 8, message: "至少 8 位" }]}>
          <Input.Password data-testid="password-new-input" />
        </Form.Item>
        <Form.Item
          name="confirm"
          label="确认新密码"
          dependencies={["newPassword"]}
          rules={[
            { required: true, message: "必填" },
            ({ getFieldValue }) => ({
              validator: (_, v) =>
                !v || v === getFieldValue("newPassword") ? Promise.resolve() : Promise.reject(new Error("两次输入不一致")),
            }),
          ]}
        >
          <Input.Password data-testid="password-confirm-input" />
        </Form.Item>
        {err && <Alert type="error" showIcon message={err} className="mb-3" data-testid="password-error" />}
        <Button type="primary" htmlType="submit" loading={change.isPending} data-testid="password-submit">
          修改密码
        </Button>
      </Form>
      <Alert
        className="mt-3"
        type="info"
        showIcon
        message="会话口径：Cookie 为无状态加密会话（iron-session），服务端无法主动吊销其他设备的会话——其余会话随 Cookie 自然过期（SYS-007 勘误 1）"
      />
    </div>
  );
}

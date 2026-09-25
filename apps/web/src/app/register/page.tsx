'use client';

import { App, Button, Card, Form, Input } from 'antd';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useState } from 'react';
import { authApi, ApiError } from '@rabbit/api-client';

export default function RegisterPage() {
  const router = useRouter();
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);

  async function onFinish(values: { email: string; password: string; confirm: string }) {
    if (values.password !== values.confirm) {
      message.error('两次输入的密码不一致');
      return;
    }
    setLoading(true);
    try {
      await authApi.register({ email: values.email, password: values.password });
      message.success('注册成功，已自动登录');
      router.push('/');
    } catch (e) {
      message.error(e instanceof ApiError ? e.message : '注册失败');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen grid place-items-center bg-slate-100" data-testid="register-page">
      <Card className="w-[400px] shadow" title={<span className="text-base">注册 RabbitAITest</span>}>
        <Form layout="vertical" onFinish={onFinish}>
          <Form.Item name="email" label="邮箱" rules={[{ required: true, type: 'email', message: '请输入有效邮箱' }]}>
            <Input placeholder="you@example.com" data-testid="register-email" />
          </Form.Item>
          <Form.Item name="password" label="密码" rules={[{ required: true, min: 8, message: '至少 8 位' }]}>
            <Input.Password placeholder="≥8 位" data-testid="register-password" />
          </Form.Item>
          <Form.Item name="confirm" label="确认密码" rules={[{ required: true, message: '再次输入密码' }]}>
            <Input.Password placeholder="再次输入" data-testid="register-confirm" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block loading={loading} data-testid="register-submit">创建账号</Button>
          <p className="text-center text-xs text-gray-400 mt-3">注册后自动创建默认组织与「演示项目」</p>
          <p className="text-center text-xs mt-1">
            已有账号？<Link href="/login" className="text-[#574BFF]">登录</Link>
          </p>
        </Form>
      </Card>
    </main>
  );
}

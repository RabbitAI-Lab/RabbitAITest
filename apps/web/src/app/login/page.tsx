'use client';

import { Button, Card, Form, Input, App } from 'antd';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Suspense, useState } from 'react';
import { authApi } from '@rabbit/api-client';
import { ApiError } from '@rabbit/api-client';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);

  async function onFinish(values: { email: string; password: string }) {
    setLoading(true);
    try {
      await authApi.login(values);
      message.success('登录成功');
      router.push(params.get('next') ?? '/');
    } catch (e) {
      message.error(e instanceof ApiError ? e.message : '登录失败');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="w-[400px] shadow" title={<span className="text-base">登录 RabbitAITest</span>}>
      <Form layout="vertical" onFinish={onFinish} data-testid="login-form">
        <Form.Item name="email" label="邮箱" rules={[{ required: true, type: 'email', message: '请输入有效邮箱' }]}>
          <Input placeholder="you@example.com" data-testid="login-email" />
        </Form.Item>
        <Form.Item name="password" label="密码" rules={[{ required: true, message: '请输入密码' }]}>
          <Input.Password placeholder="密码" data-testid="login-password" />
        </Form.Item>
        <Button type="primary" htmlType="submit" block loading={loading} data-testid="login-submit">登录</Button>
        <p className="text-center text-xs text-gray-500 mt-3">
          还没有账号？<Link href="/register" className="text-[#574BFF]">注册</Link>
        </p>
      </Form>
    </Card>
  );
}

export default function LoginPage() {
  return (
    <main className="min-h-screen grid place-items-center bg-slate-100" data-testid="login-page">
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}

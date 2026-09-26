'use client';

import { Button, Form, Input } from 'antd';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Suspense, useState } from 'react';
import { authApi, ApiError } from '@rabbit/api-client';
import { useApp } from '@/hooks/useApp';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { message } = useApp();
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
    <Form layout="vertical" onFinish={onFinish} requiredMark={false} data-testid="login-form">
      <Form.Item name="email" label="邮箱" rules={[{ required: true, type: 'email', message: '请输入有效邮箱' }]}>
        <Input size="large" placeholder="you@example.com" data-testid="login-email" />
      </Form.Item>
      <Form.Item name="password" label="密码" rules={[{ required: true, message: '请输入密码' }]}>
        <Input.Password size="large" placeholder="密码" data-testid="login-password" />
      </Form.Item>
      <Button type="primary" size="large" htmlType="submit" block loading={loading} data-testid="login-submit">
        登录
      </Button>
      <p className="text-center text-xs text-[#87888D] mt-4">
        还没有账号？<Link href="/register" className="text-[#574BFF]">注册</Link>
      </p>
    </Form>
  );
}

export default function LoginPage() {
  return (
    <main className="auth-bg" data-testid="login-page">
      <div className="w-[400px] bg-white rounded-2xl border border-[#ECEEF1] shadow-[0_8px_30px_rgba(31,35,41,.08)] px-8 pt-8 pb-6">
        <div className="flex items-center gap-2.5 mb-1.5">
          <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#6F63FF] to-[#574BFF] text-white grid place-items-center font-bold shadow-sm">R</span>
          <span className="text-lg font-semibold">Rabbit<span className="text-[#574BFF]">AI</span>Test</span>
        </div>
        <p className="text-[13px] text-[#87888D] mb-6">一站式开源测试工作台 · 测试管理 + 接口测试 + AI</p>
        <Suspense>
          <LoginForm />
        </Suspense>
      </div>
    </main>
  );
}

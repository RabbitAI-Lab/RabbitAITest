'use client';

import { Button, Form, Input } from 'antd';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useState } from 'react';
import { authApi, ApiError } from '@rabbit/api-client';
import { useApp } from '@/hooks/useApp';

export default function RegisterPage() {
  const router = useRouter();
  const { message } = useApp();
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
    <main className="auth-bg" data-testid="register-page">
      <div className="w-[400px] bg-white rounded-2xl border border-[#ECEEF1] shadow-[0_8px_30px_rgba(31,35,41,.08)] px-8 pt-8 pb-6">
        <div className="flex items-center gap-2.5 mb-1.5">
          <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#6F63FF] to-[#574BFF] text-white grid place-items-center font-bold shadow-sm">R</span>
          <span className="text-lg font-semibold">注册 RabbitAITest</span>
        </div>
        <p className="text-[13px] text-[#87888D] mb-6">注册后自动创建默认组织与「演示项目」</p>
        <Form layout="vertical" onFinish={onFinish} requiredMark={false}>
          <Form.Item name="email" label="邮箱" rules={[{ required: true, type: 'email', message: '请输入有效邮箱' }]}>
            <Input size="large" placeholder="you@example.com" data-testid="register-email" />
          </Form.Item>
          <Form.Item name="password" label="密码" rules={[{ required: true, min: 8, message: '至少 8 位' }]}>
            <Input.Password size="large" placeholder="≥8 位" data-testid="register-password" />
          </Form.Item>
          <Form.Item name="confirm" label="确认密码" rules={[{ required: true, message: '再次输入密码' }]}>
            <Input.Password size="large" placeholder="再次输入" data-testid="register-confirm" />
          </Form.Item>
          <Button type="primary" size="large" htmlType="submit" block loading={loading} data-testid="register-submit">
            创建账号
          </Button>
        </Form>
        <p className="text-center text-xs mt-4">
          已有账号？<Link href="/login" className="text-[#574BFF]">登录</Link>
        </p>
      </div>
    </main>
  );
}

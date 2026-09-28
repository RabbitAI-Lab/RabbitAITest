"use client";

import { Button, Form, Input, Tabs } from "antd";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { authApi, ssoApi, ApiError } from "@rabbit/api-client";
import { Suspense, useEffect, useState } from "react";
import { useApp } from "@/hooks/useApp";
import type { ThemeParam } from "@rabbit/api-client";

interface SsoMethod {
  authId: string;
  type: string;
  name: string;
}

const SCAN_LABEL: Record<string, { label: string; emoji: string; color: string }> = {
  WECOM: { label: "企微扫码", emoji: "💬", color: "#07C160" },
  DINGTALK: { label: "钉钉扫码", emoji: "🔷", color: "#0089FF" },
  FEISHU: { label: "飞书扫码", emoji: "🕊️", color: "#3370FF" },
};

function LoginForm({ ldapSources }: { ldapSources: SsoMethod[] }) {
  const router = useRouter();
  const params = useSearchParams();
  const { message } = useApp();
  const [loading, setLoading] = useState(false);
  const ssoError = params.get("sso");

  useEffect(() => {
    if (ssoError === "state") message.error("授权状态已过期，请重新发起登录");
    else if (ssoError === "disabled") message.error("SSO 功能未授权（企业版）");
    else if (ssoError) message.error("第三方登录失败，请重试或使用账号登录");
  }, [ssoError, message]);

  async function onFinish(values: { email: string; password: string }) {
    setLoading(true);
    try {
      await authApi.login(values);
      message.success("登录成功");
      router.push(params.get("next") ?? "/");
    } catch (e) {
      message.error(e instanceof ApiError ? e.message : "登录失败");
    } finally {
      setLoading(false);
    }
  }

  if (ldapSources.length > 0) {
    return (
      <Tabs
        centered
        size="small"
        data-testid="login-mode-tabs"
        items={[
          {
            key: "local",
            label: "账号登录",
            forceRender: true,
            children: <LocalForm loading={loading} onFinish={onFinish} />,
          },
          {
            key: "ldap",
            label: "LDAP 目录登录",
            forceRender: true,
            children: <LdapForm sources={ldapSources} />,
          },
        ]}
      />
    );
  }

  return <LocalForm loading={loading} onFinish={onFinish} />;
}

function LocalForm({
  loading,
  onFinish,
}: {
  loading: boolean;
  onFinish: (v: { email: string; password: string }) => void;
}) {
  return (
    <Form layout="vertical" onFinish={onFinish} requiredMark={false} data-testid="login-form">
      <Form.Item
        name="email"
        label="邮箱"
        rules={[{ required: true, type: "email", message: "请输入有效邮箱" }]}
      >
        <Input size="large" placeholder="you@example.com" data-testid="login-email" />
      </Form.Item>
      <Form.Item name="password" label="密码" rules={[{ required: true, message: "请输入密码" }]}>
        <Input.Password size="large" placeholder="密码" data-testid="login-password" />
      </Form.Item>
      <Button
        type="primary"
        size="large"
        htmlType="submit"
        block
        loading={loading}
        data-testid="login-submit"
      >
        登录
      </Button>
      <p className="text-center text-xs text-[#87888D] mt-4">
        还没有账号？
        <Link href="/register" className="text-[#574BFF]">
          注册
        </Link>
      </p>
    </Form>
  );
}

function LdapForm({ sources }: { sources: SsoMethod[] }) {
  const { message } = useApp();
  const [loading, setLoading] = useState(false);
  const [authId, setAuthId] = useState(sources[0]?.authId ?? "");

  async function onFinish(values: { username: string; password: string }) {
    setLoading(true);
    try {
      await ssoApi.ldapLogin({ authId, username: values.username, password: values.password });
      message.success("登录成功");
      window.location.href = "/";
    } catch (e) {
      message.error(e instanceof ApiError ? e.message : "LDAP 登录失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Form layout="vertical" onFinish={onFinish} requiredMark={false} data-testid="ldap-login-form">
      {sources.length > 1 && (
        <Form.Item label="目录源">
          <select
            className="w-full border rounded px-2 py-1.5 text-sm"
            value={authId}
            onChange={(e) => setAuthId(e.target.value)}
            data-testid="select-ldap-source"
          >
            {sources.map((s) => (
              <option key={s.authId} value={s.authId}>
                {s.name}
              </option>
            ))}
          </select>
        </Form.Item>
      )}
      <Form.Item
        name="username"
        label="AD 账号"
        rules={[{ required: true, message: "请输入账号" }]}
      >
        <Input size="large" placeholder="AD 账号（uid）" data-testid="ldap-username" />
      </Form.Item>
      <Form.Item
        name="password"
        label="AD 密码"
        rules={[{ required: true, message: "请输入密码" }]}
      >
        <Input.Password size="large" placeholder="AD 密码" data-testid="ldap-password" />
      </Form.Item>
      <Button
        type="primary"
        size="large"
        htmlType="submit"
        block
        loading={loading}
        data-testid="ldap-submit"
      >
        LDAP 登录
      </Button>
      <p className="text-[11px] text-[#87888D] mt-3 text-center">
        经目录服务验证（bind + search），失败与本地登录同文案（防枚举）
      </p>
    </Form>
  );
}

function LoginBanner() {
  const [banner, setBanner] = useState("");
  useEffect(() => {
    // SYS-005 base.loginBanner（公开端点，未登录可读；失败静默——横幅非关键路径）
    fetch("/api/v1/public/login-banner")
      .then((r) => (r.ok ? r.json() : null))
      .then((b: { data?: { banner?: string } } | null) => setBanner(b?.data?.banner ?? ""))
      .catch(() => undefined);
  }, []);
  if (!banner) return null;
  return (
    <div
      data-testid="login-banner"
      className="mb-3 text-[13px] text-[#574BFF] bg-[#574BFF]/[.06] border border-[#574BFF]/20 rounded-lg px-3 py-2"
    >
      {banner}
    </div>
  );
}

/** ENTP-002/003「更多登录方式」（public；社区版/未启用 SSO 返回空 → 区块不渲染）。 */
function SsoMethods() {
  const [methods, setMethods] = useState<SsoMethod[]>([]);
  useEffect(() => {
    ssoApi
      .publicMethods()
      .then((r) => setMethods(r ?? []))
      .catch(() => setMethods([]));
  }, []);
  if (methods.length === 0) return null;
  const redirect = methods.filter((m) => m.type !== "LDAP");
  const ldap = methods.filter((m) => m.type === "LDAP");
  return (
    <>
      <div
        className="flex items-center gap-2 text-xs text-[#C9CBD0] my-4"
        data-testid="sso-divider"
      >
        <span className="flex-1 border-t" />
        其他登录方式
        <span className="flex-1 border-t" />
      </div>
      <div className="space-y-2" data-testid="sso-methods">
        {redirect
          .filter((m) => !SCAN_LABEL[m.type])
          .map((m) => (
            <a
              key={m.authId}
              href={`/api/v1/auth/sso/${m.authId}/authorize`}
              className="border rounded w-full py-2 flex items-center justify-center gap-2 text-[13px] hover:border-[#574BFF]"
              data-testid={`sso-method-${m.type}`}
            >
              🔐 {m.name} <span className="text-[#A8ABB0] text-xs">({m.type})</span>
            </a>
          ))}
        {redirect.some((m) => SCAN_LABEL[m.type]) && (
          <div className="grid grid-cols-3 gap-2">
            {redirect
              .filter((m) => m.type in SCAN_LABEL)
              .map((m) => (
                <a
                  key={m.authId}
                  href={`/api/v1/auth/sso/${m.authId}/authorize`}
                  className="border rounded py-2 text-xs flex flex-col items-center gap-1 hover:border-[#574BFF]"
                  data-testid={`sso-method-${m.type}`}
                >
                  <span className="text-lg">{(SCAN_LABEL[m.type] ?? {}).emoji}</span>
                  {(SCAN_LABEL[m.type] ?? {}).label}
                </a>
              ))}
          </div>
        )}
      </div>
      {/* ldapSources 传给 LoginForm 切 Tab；此处仅作数据桥（登录表单上方 Tab 已含 LDAP） */}
      <span data-testid="sso-ldap-count" className="hidden">
        {ldap.length}
      </span>
    </>
  );
}

export default function LoginPage() {
  const [ldapSources, setLdapSources] = useState<SsoMethod[]>([]);
  const [theme, setTheme] = useState<Partial<ThemeParam>>({});

  useEffect(() => {
    // ENTP-002 LDAP 源 → Tab 切换；ENTP-004 品牌定制（公开 theme；失败静默=默认品牌）
    ssoApi
      .publicMethods()
      .then((r) => setLdapSources((r ?? []).filter((m) => m.type === "LDAP")))
      .catch(() => setLdapSources([]));
    fetch("/api/v1/public/theme")
      .then((r) => (r.ok ? r.json() : null))
      .then((b: { data?: ThemeParam } | null) => setTheme(b?.data ?? {}))
      .catch(() => undefined);
  }, []);

  const primary = theme.primaryColor || "#574BFF";

  return (
    <main className="auth-bg" data-testid="login-page">
      <div
        className="w-[400px] bg-white rounded-2xl border border-[#ECEEF1] shadow-[0_8px_30px_rgba(31,35,41,.08)] px-8 pt-8 pb-6"
        style={
          theme.loginBg
            ? {
                backgroundImage: `url(${theme.loginBg})`,
                backgroundSize: "cover",
                backgroundPosition: "center",
              }
            : undefined
        }
      >
        <div className={theme.loginBg ? "bg-white/90 rounded-2xl px-4 py-4 -mx-4" : undefined}>
          <LoginBanner />
          <div className="flex items-center gap-2.5 mb-1.5">
            {theme.loginLogo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={theme.loginLogo} alt="logo" className="w-9 h-9 rounded-xl object-cover" />
            ) : (
              <span
                className="w-9 h-9 rounded-xl text-white grid place-items-center font-bold shadow-sm"
                style={{ background: `linear-gradient(135deg, ${primary}, ${primary}CC)` }}
                data-testid="login-brand-logo"
              >
                R
              </span>
            )}
            <span className="text-lg font-semibold" data-testid="login-brand-name">
              {theme.siteName || (
                <>
                  Rabbit<span style={{ color: primary }}>AI</span>Test
                </>
              )}
            </span>
          </div>
          <p className="text-[13px] text-[#87888D] mb-6" data-testid="login-slogan">
            {theme.slogan || "一站式开源测试工作台 · 测试管理 + 接口测试 + AI"}
          </p>
          <Suspense>
            <LoginForm ldapSources={ldapSources} />
          </Suspense>
          <SsoMethods />
        </div>
      </div>
    </main>
  );
}

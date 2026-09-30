"use client";

import { Alert, Button, Input, Space, Tag, Typography } from "antd";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { oauthApi, type OAuthPendingDevice } from "@rabbit/api-client";

const SCOPE_META: Record<string, { color: string; label: string }> = {
  read: { color: "green", label: "read · 查看" },
  write: { color: "orange", label: "write · 修改" },
  exec: { color: "blue", label: "exec · 执行" },
};
const fmt = (v: string) => v.replace("T", " ").slice(0, 16);

/**
 * SYS-009：终端授权确认页（独立页；CLI Device Flow 的人工批准步）。
 * 三态：输码 → 确认（scope/来源回显）→ 结果。未登录经 middleware 302 /login?next= 回跳。
 */
export default function OAuthDevicePage() {
  const [code, setCode] = useState("");
  const [pending, setPending] = useState<OAuthPendingDevice | null>(null);
  const [phase, setPhase] = useState<"input" | "confirm" | "done">("input");
  const [result, setResult] = useState<"approved" | "denied" | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    // ?code= 预填（verification_uri_complete 直达）
    const pre = new URLSearchParams(window.location.search).get("code");
    if (pre) setCode(pre.toUpperCase());
  }, []);

  const formatCode = (raw: string) => {
    const digits = raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
    return digits.length > 4 ? `${digits.slice(0, 4)}-${digits.slice(4)}` : digits;
  };

  const verify = useMutation({
    mutationFn: () => oauthApi.pending(formatCode(code)),
    onSuccess: (p) => {
      setPending(p);
      setError("");
      setPhase("confirm");
    },
    onError: (e) => setError(e instanceof Error ? e.message : "校验失败"),
  });

  const approve = useMutation({
    mutationFn: (ok: boolean) => oauthApi.approve(formatCode(code), ok),
    onSuccess: (_d, ok) => {
      setResult(ok ? "approved" : "denied");
      setPhase("done");
    },
    onError: (e) => setError(e instanceof Error ? e.message : "操作失败"),
  });

  return (
    <div className="min-h-screen grid place-items-center bg-gray-50" data-testid="page-oauth-device">
      <div className="w-[380px] rabbit-card p-6 space-y-4">
        <Space size={8}>
          <span className="w-7 h-7 rounded-md bg-[#574BFF] text-white grid place-items-center text-sm font-bold">
            R
          </span>
          <Typography.Title level={5} className="!m-0">
            RabbitAITest · 终端授权
          </Typography.Title>
        </Space>

        {phase === "input" && (
          <div className="space-y-3">
            <Typography.Text type="secondary" className="text-xs">
              CLI 发起登录后，将终端显示的 8 位代码输入此处
            </Typography.Text>
            <Input
              size="large"
              placeholder="XXXX-XXXX"
              value={code}
              onChange={(e) => setCode(formatCode(e.target.value))}
              onPressEnter={() => code.replace(/-/g, "").length === 8 && verify.mutate()}
              className="!font-mono !text-lg !tracking-[0.3em] text-center uppercase"
              data-testid="oauth-device-code-input"
            />
            {error && (
              <Alert type="error" showIcon message={error} data-testid="oauth-device-error" />
            )}
            <Button
              type="primary"
              block
              loading={verify.isPending}
              disabled={code.replace(/-/g, "").length !== 8}
              onClick={() => verify.mutate()}
              data-testid="oauth-device-verify-btn"
            >
              校验
            </Button>
            <Typography.Text type="secondary" className="text-xs">
              代码 10 分钟内有效 · 输错 5 次锁定
            </Typography.Text>
          </div>
        )}

        {phase === "confirm" && pending && (
          <div className="space-y-4" data-testid="oauth-device-confirm">
            <div className="border rounded-md p-4 space-y-3 text-[13px]">
              <div className="flex justify-between">
                <span className="text-gray-500">请求方</span>
                <code>{pending.clientId}</code>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">请求时间</span>
                <span>{fmt(pending.createdAt)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">来源 IP</span>
                <code>{pending.ip ?? "—"}</code>
              </div>
              <div>
                <div className="text-gray-500 mb-1.5">申请权限（scope）</div>
                <Space size={4} wrap>
                  {pending.scope.map((s) => (
                    <Tag key={s} color={SCOPE_META[s]?.color ?? "default"}>
                      {SCOPE_META[s]?.label ?? s}
                    </Tag>
                  ))}
                  {!pending.scope.includes("write") && <Tag>write · 修改（未申请）</Tag>}
                </Space>
                <Typography.Text type="secondary" className="text-xs block mt-1.5">
                  scope 是收窄：实际权限仍受你的角色限制（权限 = 角色 ∩ scope）
                </Typography.Text>
              </div>
            </div>
            {error && <Alert type="error" showIcon message={error} />}
            <Space className="w-full" size={8}>
              <Button
                type="primary"
                className="flex-1"
                loading={approve.isPending}
                onClick={() => approve.mutate(true)}
                data-testid="oauth-device-approve-btn"
              >
                批准授权
              </Button>
              <Button className="flex-1" onClick={() => approve.mutate(false)}>
                拒绝
              </Button>
            </Space>
          </div>
        )}

        {phase === "done" && (
          <Alert
            type={result === "approved" ? "success" : "info"}
            showIcon
            message={result === "approved" ? "已批准" : "已拒绝"}
            description={
              result === "approved"
                ? "请回到终端继续——rabbit 正在获取令牌"
                : "终端将显示 access_denied"
            }
            data-testid="oauth-device-result"
          />
        )}
      </div>
    </div>
  );
}

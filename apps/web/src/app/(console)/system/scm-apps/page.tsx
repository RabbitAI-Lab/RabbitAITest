"use client";

import { Alert, Button, Input, Spin, Switch } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { paramApi } from "@rabbit/api-client";
import { SCM_PROVIDER_META, type ScmOauthProvider } from "@rabbit/shared";
import { PageHeader } from "@/components/PageHeader";
import { useApp } from "@/hooks/useApp";
import { usePermissions } from "@/hooks/usePermissions";

const PROVIDERS: ScmOauthProvider[] = ["github", "gitee", "gitlab"];

/**
 * SCM-001：系统设置 › 代码平台（三平台 OAuth 应用 clientId/clientSecret，SystemParam group=scm）。
 * 系统级为默认配置；组织可在「服务集成」中用自己的应用覆盖。
 */
export default function ScmAppsPage() {
  const { message } = useApp();
  const { canGlobal } = usePermissions();
  const canUpdate = canGlobal("SYSTEM_PARAM:UPDATE");
  const siteUrl = typeof window !== "undefined" ? window.location.origin : "http://localhost:3000";

  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["system-params"],
    queryFn: () => paramApi.get(),
  });

  const [forms, setForms] = useState<
    Record<string, { clientId: string; clientSecret: string; baseUrl: string; enabled: boolean }>
  >({});

  useEffect(() => {
    if (!data?.scm) return;
    setForms({
      github: {
        clientId: data.scm.github.clientId,
        clientSecret: "",
        baseUrl: "",
        enabled: data.scm.github.enabled,
      },
      gitee: {
        clientId: data.scm.gitee.clientId,
        clientSecret: "",
        baseUrl: "",
        enabled: data.scm.gitee.enabled,
      },
      gitlab: {
        clientId: data.scm.gitlab.clientId,
        clientSecret: "",
        baseUrl: data.scm.gitlab.baseUrl || "https://gitlab.com",
        enabled: data.scm.gitlab.enabled,
      },
    });
  }, [data]);

  const save = useMutation({
    mutationFn: () => {
      const value: Record<string, unknown> = {};
      for (const p of PROVIDERS) {
        const f = forms[p] ?? { clientId: "", clientSecret: "", baseUrl: "", enabled: false };
        value[p] = {
          clientId: f.clientId,
          ...(f.clientSecret ? { clientSecret: f.clientSecret } : {}),
          ...(p === "gitlab" ? { baseUrl: f.baseUrl || "https://gitlab.com" } : {}),
          enabled: f.clientId ? f.enabled : false,
        };
      }
      return paramApi.update("scm", value);
    },
    onSuccess: () => {
      message.success("已保存（密钥加密存储）");
      void qc.invalidateQueries({ queryKey: ["system-params"] });
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "保存失败"),
  });

  return (
    <div className="p-4" data-testid="page-system-scm-apps">
      <PageHeader
        title="代码平台"
        sub="配置 GitHub / Gitee（码云）/ GitLab 的 OAuth 应用，用于组织成员授权后直接选择仓库。系统级为默认配置，组织可在「服务集成」中用自己的应用覆盖。"
        extra={
          canUpdate && (
            <Button
              type="primary"
              loading={save.isPending}
              onClick={() => save.mutate()}
              data-testid="btn-save-scm-apps"
            >
              全部保存
            </Button>
          )
        }
      />
      {isLoading ? (
        <div className="flex justify-center py-12">
          <Spin />
        </div>
      ) : (
        <div
          className="grid gap-3"
          style={{ gridTemplateColumns: "repeat(auto-fill, minmax(380px, 1fr))" }}
        >
          {PROVIDERS.map((p) => {
            const meta = SCM_PROVIDER_META[p];
            const f = forms[p] ?? { clientId: "", clientSecret: "", baseUrl: "", enabled: false };
            const view = data?.scm?.[p];
            return (
              <div
                key={p}
                className="border border-[#E5E6EB] rounded-lg p-4 bg-white"
                data-testid={`scm-app-card-${p}`}
              >
                <div className="flex items-center gap-2 mb-3">
                  <span className="font-medium">{meta.label}</span>
                  <span className="text-xs text-[#8F959E]">
                    {p === "gitlab"
                      ? "默认 gitlab.com，可填自建实例"
                      : meta.webBase.replace("https://", "")}
                  </span>
                  <label className="ml-auto flex items-center gap-1.5 text-xs text-[#646A73]">
                    启用
                    <Switch
                      size="small"
                      checked={f.enabled}
                      disabled={!canUpdate || !f.clientId}
                      onChange={(v) => setForms({ ...forms, [p]: { ...f, enabled: v } })}
                      data-testid={`switch-scm-enabled-${p}`}
                    />
                  </label>
                </div>
                <div className="space-y-2.5">
                  <div>
                    <div className="text-xs text-[#646A73] mb-1">Client ID</div>
                    <Input
                      value={f.clientId}
                      disabled={!canUpdate}
                      onChange={(e) =>
                        setForms({ ...forms, [p]: { ...f, clientId: e.target.value } })
                      }
                      data-testid={`input-scm-client-id-${p}`}
                    />
                  </div>
                  <div>
                    <div className="text-xs text-[#646A73] mb-1">Client Secret</div>
                    <Input.Password
                      value={f.clientSecret}
                      disabled={!canUpdate}
                      onChange={(e) =>
                        setForms({ ...forms, [p]: { ...f, clientSecret: e.target.value } })
                      }
                      placeholder={view?.hasSecret ? "已配置（留空＝不修改）" : "未配置"}
                      autoComplete="new-password"
                      data-testid={`input-scm-client-secret-${p}`}
                    />
                  </div>
                  {p === "gitlab" && (
                    <div>
                      <div className="text-xs text-[#646A73] mb-1">实例地址</div>
                      <Input
                        value={f.baseUrl}
                        disabled={!canUpdate}
                        onChange={(e) =>
                          setForms({ ...forms, [p]: { ...f, baseUrl: e.target.value } })
                        }
                        placeholder="https://gitlab.com 或自建 https://git.example.com"
                        data-testid="input-scm-gitlab-base"
                      />
                    </div>
                  )}
                </div>
                <div className="mt-3 pt-3 border-t border-[#F0F1F5] text-[11px] text-[#8F959E]">
                  回调地址（在平台 OAuth 应用中登记）：
                  <span className="text-[#3D4350]">
                    {siteUrl}/api/v1/orgs/{"{orgId}"}/scm/oauth/{p}/callback
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <div className="mt-4 max-w-3xl">
        <Alert
          type="info"
          showIcon
          message="配置步骤：在对应平台创建 OAuth 应用（GitHub：Settings → Developer settings → OAuth Apps；Gitee：设置 → 第三方应用；GitLab：User Settings → Applications），授权回调地址填上述 URL，将生成的 Client ID / Secret 填入本页。"
        />
      </div>
    </div>
  );
}

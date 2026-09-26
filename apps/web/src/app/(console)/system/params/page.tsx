"use client";

import { Button, Empty, Input, InputNumber, Radio, Tabs, Tag } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { paramApi, type SystemParams } from "@rabbit/api-client";
import { PageHeader } from "@/components/PageHeader";
import { useApp } from "@/hooks/useApp";
import { usePermissions } from "@/hooks/usePermissions";

const fmt = (v: string | null) => (v ? v.replace("T", " ").slice(0, 16) : "—");
const GROUP_LABEL: Record<string, string> = {
  basic: "基础",
  smtp: "邮箱",
  file: "文件",
  cleanup: "数据清理",
};

/** SYS-005：系统参数（基础/邮箱/文件/数据清理 四分区，每区独立保存；SMTP 支持测试连接）。 */
export default function SystemParamsPage() {
  const qc = useQueryClient();
  const { message } = useApp();
  const { canGlobal } = usePermissions();
  const canUpdate = canGlobal("SYSTEM_PARAM:UPDATE");

  const { data, isLoading } = useQuery({ queryKey: ["system-params"], queryFn: paramApi.get });

  const [basic, setBasic] = useState<SystemParams["base"]>({ siteUrl: "", loginBanner: "" });
  const [smtp, setSmtp] = useState<SystemParams["smtp"]>({
    host: "",
    port: 465,
    user: "",
    pass: "",
    ssl: true,
    from: "",
  });
  const [file, setFile] = useState<SystemParams["file"]>({ maxSizeMb: 50 });
  const [cleanup, setCleanup] = useState<SystemParams["cleanup"]>({
    logRetentionDays: 90,
    changeLogRetentionDays: 90,
    lastRunAt: null,
    lastRunCount: 0,
  });

  useEffect(() => {
    if (!data) return;
    setBasic(data.base);
    setSmtp(data.smtp);
    setFile(data.file);
    setCleanup(data.cleanup);
  }, [data]);

  const errText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

  const save = useMutation({
    mutationFn: ({
      group,
      value,
    }: {
      group: "basic" | "smtp" | "file" | "cleanup";
      value: Record<string, unknown>;
    }) => paramApi.update(group, value),
    onSuccess: (_r, v) => {
      message.success(`${GROUP_LABEL[v.group] ?? ""}配置已保存`);
      void qc.invalidateQueries({ queryKey: ["system-params"] });
    },
    onError: (e) => message.error(errText(e, "保存失败")),
  });

  const testSmtp = useMutation({
    mutationFn: () => paramApi.testSmtp(smtp),
    onSuccess: (r) => {
      if (r.ok) message.success(r.message || "连接成功");
      else message.error(r.message || "连接失败");
    },
    onError: (e) => message.error(errText(e, "连接失败")),
  });

  const validUrl = (() => {
    try {
      new URL(basic.siteUrl);
      return true;
    } catch {
      return false;
    }
  })();
  const cleanupInvalid = cleanup.logRetentionDays < 7 || cleanup.changeLogRetentionDays < 7;

  const labelCls = "block text-[13px] text-[#3D4350] mb-1";

  const items = [
    {
      key: "basic",
      label: "基础",
      children: (
        <div className="rabbit-card p-5 space-y-4 max-w-3xl">
          <div>
            <span className={labelCls}>
              站点 URL <span className="text-[#FF4D4F]">*</span>
            </span>
            <Input
              className="w-96 max-w-full"
              value={basic.siteUrl}
              onChange={(e) => setBasic({ ...basic, siteUrl: e.target.value })}
              placeholder="https://rabbit.example.com"
              status={basic.siteUrl && !validUrl ? "error" : undefined}
              data-testid="input-site-url"
            />
            {basic.siteUrl && !validUrl && (
              <p className="text-xs text-[#FF4D4F] mt-1">请输入合法 URL</p>
            )}
          </div>
          <div>
            <span className={labelCls}>登录页横幅文案</span>
            <Input
              className="w-96 max-w-full"
              value={basic.loginBanner}
              onChange={(e) => setBasic({ ...basic, loginBanner: e.target.value })}
              maxLength={256}
              data-testid="input-login-banner"
            />
          </div>
          <p className="text-xs text-[#A8ABB0]">
            站点 URL 用于分享链接与邮件内容地址拼装，变更后新生成的链接即时采用新域名。
          </p>
          {canUpdate && (
            <Button
              type="primary"
              loading={save.isPending}
              disabled={!basic.siteUrl || !validUrl}
              onClick={() =>
                save.mutate({
                  group: "basic",
                  value: { siteUrl: basic.siteUrl, loginBanner: basic.loginBanner },
                })
              }
              data-testid="param-save-basic"
            >
              保存
            </Button>
          )}
        </div>
      ),
    },
    {
      key: "smtp",
      label: "邮箱",
      children: (
        <div className="rabbit-card p-5 space-y-4 max-w-3xl">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <span className={labelCls}>SMTP 主机</span>
              <Input
                value={smtp.host}
                onChange={(e) => setSmtp({ ...smtp, host: e.target.value })}
                placeholder="smtp.example.com"
                data-testid="input-smtp-host"
              />
            </div>
            <div>
              <span className={labelCls}>端口</span>
              <InputNumber
                className="w-full"
                min={1}
                max={65535}
                value={smtp.port}
                onChange={(v) => setSmtp({ ...smtp, port: v ?? 465 })}
                data-testid="input-smtp-port"
              />
            </div>
            <div>
              <span className={labelCls}>账号</span>
              <Input
                value={smtp.user}
                onChange={(e) => setSmtp({ ...smtp, user: e.target.value })}
                data-testid="input-smtp-user"
              />
            </div>
            <div>
              <span className={labelCls}>密码</span>
              <Input.Password
                value={smtp.pass}
                onChange={(e) => setSmtp({ ...smtp, pass: e.target.value })}
                placeholder="读取返回 ****** 表示未变更"
                data-testid="input-smtp-pass"
              />
            </div>
            <div>
              <span className={labelCls}>连接方式</span>
              <Radio.Group
                className="pt-1.5"
                value={smtp.ssl}
                onChange={(e) => setSmtp({ ...smtp, ssl: e.target.value as boolean })}
                options={[
                  { value: true, label: "SSL" },
                  { value: false, label: "TLS" },
                ]}
                data-testid="radio-smtp-ssl"
              />
            </div>
            <div>
              <span className={labelCls}>发件人</span>
              <Input
                value={smtp.from}
                onChange={(e) => setSmtp({ ...smtp, from: e.target.value })}
                placeholder="RabbitAITest <notify@rabbit.test>"
                data-testid="input-smtp-from"
              />
            </div>
          </div>
          <p className="text-xs text-[#A8ABB0]">
            SMTP 密码加密落库，读取脱敏返回 ******（保持 ****** 提交即不修改密码）。
          </p>
          {canUpdate && (
            <div className="flex gap-3">
              <Button
                loading={testSmtp.isPending}
                onClick={() => testSmtp.mutate()}
                data-testid="btn-test-smtp"
              >
                测试连接
              </Button>
              <Button
                type="primary"
                loading={save.isPending}
                disabled={!smtp.host || !smtp.port}
                onClick={() =>
                  save.mutate({ group: "smtp", value: { ...smtp, port: Number(smtp.port) } })
                }
                data-testid="param-save-smtp"
              >
                保存
              </Button>
            </div>
          )}
        </div>
      ),
    },
    {
      key: "file",
      label: "文件",
      children: (
        <div className="rabbit-card p-5 space-y-4 max-w-3xl">
          <div>
            <span className={labelCls}>全局上传上限</span>
            <div className="flex items-center gap-2">
              <InputNumber
                className="w-28"
                min={1}
                max={1024}
                value={file.maxSizeMb}
                onChange={(v) => setFile({ maxSizeMb: v ?? 50 })}
                data-testid="input-max-size-mb"
              />
              <span className="text-[13px] text-[#646A73]">MB（1–1024）</span>
            </div>
          </div>
          <p className="text-xs text-[#A8ABB0]">
            缺陷附件等全部上传场景统一读取该上限；按场景差异化上限为后续增强。
          </p>
          {canUpdate && (
            <Button
              type="primary"
              loading={save.isPending}
              disabled={file.maxSizeMb < 1 || file.maxSizeMb > 1024}
              onClick={() =>
                save.mutate({ group: "file", value: { maxSizeMb: Number(file.maxSizeMb) } })
              }
              data-testid="param-save-file"
            >
              保存
            </Button>
          )}
        </div>
      ),
    },
    {
      key: "cleanup",
      label: "数据清理",
      children: (
        <div className="rabbit-card p-5 space-y-4 max-w-3xl">
          <div>
            <span className={labelCls}>操作日志保留天数</span>
            <div className="flex items-center gap-2">
              <InputNumber
                className="w-28"
                max={3650}
                value={cleanup.logRetentionDays}
                onChange={(v) => setCleanup({ ...cleanup, logRetentionDays: v ?? 90 })}
                status={cleanup.logRetentionDays < 7 ? "error" : undefined}
                data-testid="input-log-retention"
              />
              <span className="text-[13px] text-[#646A73]">天（下限 7 天）</span>
            </div>
          </div>
          <div>
            <span className={labelCls}>变更历史保留天数</span>
            <div className="flex items-center gap-2">
              <InputNumber
                className="w-28"
                max={3650}
                value={cleanup.changeLogRetentionDays}
                onChange={(v) => setCleanup({ ...cleanup, changeLogRetentionDays: v ?? 90 })}
                status={cleanup.changeLogRetentionDays < 7 ? "error" : undefined}
                data-testid="input-changelog-retention"
              />
              <span className="text-[13px] text-[#646A73]">天（下限 7 天）</span>
            </div>
          </div>
          {cleanupInvalid && (
            <p className="text-xs text-[#FF4D4F]" data-testid="cleanup-invalid-hint">
              保留天数下限为 7 天，低于 7 天无法保存（防误配全清）
            </p>
          )}
          <div
            className="bg-[#F7F8FA] border border-[#ECEEF1] rounded-md p-3 text-[13px] text-[#646A73]"
            data-testid="cleanup-last-run"
          >
            上次清理：{fmt(cleanup.lastRunAt)}（每日定时执行 03:00）· 清理{" "}
            {cleanup.lastRunCount.toLocaleString()} 条（只读）
          </div>
          {canUpdate && (
            <Button
              type="primary"
              loading={save.isPending}
              disabled={cleanupInvalid}
              onClick={() =>
                save.mutate({
                  group: "cleanup",
                  value: {
                    logRetentionDays: Number(cleanup.logRetentionDays),
                    changeLogRetentionDays: Number(cleanup.changeLogRetentionDays),
                  },
                })
              }
              data-testid="param-save-cleanup"
            >
              保存
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="系统参数"
        sub="保存即生效 · 仅系统管理员可配置"
        extra={isLoading ? <Tag color="processing">加载中…</Tag> : undefined}
      />
      {isLoading ? (
        <Empty className="py-24" description="参数加载中…" />
      ) : (
        <Tabs defaultActiveKey="basic" items={items} data-testid="system-params-tabs" />
      )}
    </div>
  );
}

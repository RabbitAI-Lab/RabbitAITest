"use client";

import { Alert, Button, ColorPicker, Input, Switch, Upload } from "antd";
import type { UploadFile } from "antd";
import { useState } from "react";
import { paramApi, type ThemeParamValue } from "@rabbit/api-client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useApp } from "@/hooks/useApp";

/** ENTP-004 界面设置 Tab：左表单右实时预览；保存并应用（THEME 门控由后端强制）。 */

const DEFAULTS: ThemeParamValue = {
  primaryColor: "#574BFF",
  followPrimary: true,
  siteName: "RabbitAITest",
  slogan: "",
  loginLogo: "",
  loginBg: "",
  icon: "",
  platformName: "RabbitAITest",
  platformLogo: "",
  helpUrl: "",
};

const IMG_LIMIT = 200 * 1024;

function ImageUpload({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
}) {
  return (
    <div>
      <p className="text-[#646A73] text-xs mb-1">{label}（≤200KB）</p>
      <div className="flex items-center gap-2">
        <Upload
          maxCount={1}
          showUploadList={false}
          accept="image/png,image/jpeg,image/svg+xml"
          beforeUpload={(file) => {
            if (file.size > IMG_LIMIT) {
              onChange("__TOO_LARGE__");
              return Upload.LIST_IGNORE;
            }
            const reader = new FileReader();
            reader.onload = () => onChange(String(reader.result ?? ""));
            reader.readAsDataURL(file);
            return Upload.LIST_IGNORE;
          }}
        >
          <Button size="small">
            {value && value !== "__TOO_LARGE__" ? "重新上传" : "上传图片"}
          </Button>
        </Upload>
        {value === "__TOO_LARGE__" ? (
          <span className="text-xs text-red-500">图片不能超过 200KB</span>
        ) : value ? (
          <span className="flex items-center gap-1 text-xs text-emerald-600">
            已上传
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={value} alt="预览" className="w-5 h-5 rounded object-cover" />
            <a className="text-[#574BFF]" onClick={() => onChange("")}>
              清除
            </a>
          </span>
        ) : (
          <span className="text-xs text-[#A8ABB0]">未上传，使用默认</span>
        )}
      </div>
    </div>
  );
}

export function ThemeTab({
  initial,
  canUpdate,
  themeEnabled,
}: {
  initial: ThemeParamValue | undefined;
  canUpdate: boolean;
  themeEnabled: boolean;
}) {
  const qc = useQueryClient();
  const { message } = useApp();
  const [form, setForm] = useState<ThemeParamValue>({ ...DEFAULTS, ...(initial ?? {}) });
  const set = (patch: Partial<ThemeParamValue>) => setForm((f) => ({ ...f, ...patch }));
  const tooLarge = Object.values(form).some((v) => v === "__TOO_LARGE__");
  void (null as unknown as UploadFile);

  const save = useMutation({
    mutationFn: (value: ThemeParamValue) =>
      paramApi.update("theme", value as unknown as Record<string, unknown>),
    onSuccess: () => {
      message.success("已保存并应用（全站即时生效）");
      void qc.invalidateQueries({ queryKey: ["system-params"] });
      void qc.invalidateQueries({ queryKey: ["public-theme"] });
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "保存失败"),
  });

  const disabled = !canUpdate || !themeEnabled || tooLarge;

  return (
    <div className="space-y-3">
      {!themeEnabled && (
        <Alert
          type="info"
          showIcon
          message="自定义主题与品牌为企业版能力（THEME 特性）——添加 License 后可编辑"
          data-testid="theme-locked-alert"
        />
      )}
      <div className="flex gap-4">
        {/* 左表单 */}
        <div
          className={`flex-1 space-y-3 ${disabled ? "opacity-60 pointer-events-none" : ""}`}
          data-testid="theme-form"
        >
          <div className="space-y-2">
            <p className="font-medium text-[13px]">基本</p>
            <div className="flex items-center gap-3">
              <span className="text-[#646A73] text-xs w-20">主题色</span>
              <ColorPicker
                value={form.primaryColor}
                disabled={disabled}
                onChange={(c) => set({ primaryColor: c.toHexString() })}
                showText
                data-testid="color-primary"
              />
            </div>
            <div className="flex items-center gap-3">
              <span className="text-[#646A73] text-xs w-20">平台背景</span>
              <Switch
                size="small"
                checked={form.followPrimary}
                disabled={disabled}
                onChange={(v) => set({ followPrimary: v })}
              />
              <span className="text-xs text-[#A8ABB0]">跟随主题色（浅化）</span>
            </div>
          </div>
          <div className="space-y-2 border-t pt-3">
            <p className="font-medium text-[13px]">登录页定制</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-[#646A73] text-xs mb-1">网站名称</p>
                <Input
                  value={form.siteName}
                  disabled={disabled}
                  onChange={(e) => set({ siteName: e.target.value })}
                  data-testid="input-theme-site-name"
                />
              </div>
              <div>
                <p className="text-[#646A73] text-xs mb-1">Slogan</p>
                <Input
                  value={form.slogan}
                  disabled={disabled}
                  onChange={(e) => set({ slogan: e.target.value })}
                  data-testid="input-theme-slogan"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <ImageUpload label="网站 Icon" value={form.icon} onChange={(v) => set({ icon: v })} />
              <ImageUpload
                label="登录 Logo"
                value={form.loginLogo}
                onChange={(v) => set({ loginLogo: v })}
              />
            </div>
            <ImageUpload
              label="登录页背景图"
              value={form.loginBg}
              onChange={(v) => set({ loginBg: v })}
            />
          </div>
          <div className="space-y-2 border-t pt-3">
            <p className="font-medium text-[13px]">平台设置</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-[#646A73] text-xs mb-1">平台名称</p>
                <Input
                  value={form.platformName}
                  disabled={disabled}
                  onChange={(e) => set({ platformName: e.target.value })}
                  data-testid="input-theme-platform-name"
                />
              </div>
              <div>
                <p className="text-[#646A73] text-xs mb-1">帮助文档地址</p>
                <Input
                  value={form.helpUrl}
                  disabled={disabled}
                  onChange={(e) => set({ helpUrl: e.target.value })}
                />
              </div>
            </div>
            <ImageUpload
              label="平台 Logo"
              value={form.platformLogo}
              onChange={(v) => set({ platformLogo: v })}
            />
          </div>
          <div className="flex gap-2 pt-2 border-t">
            <Button
              type="primary"
              loading={save.isPending}
              disabled={disabled}
              onClick={() => save.mutate(form)}
              data-testid="btn-theme-save"
            >
              保存并应用
            </Button>
            <Button
              disabled={disabled}
              onClick={() => setForm({ ...DEFAULTS })}
              data-testid="btn-theme-reset"
            >
              恢复默认
            </Button>
            <span className="text-[11px] text-[#A8ABB0] self-center">
              保存后即时生效（public/theme no-store）
            </span>
          </div>
        </div>

        {/* 右实时预览 */}
        <div className="w-[380px] space-y-3">
          <p className="font-medium text-[13px]">实时预览</p>
          <div className="border rounded-lg overflow-hidden" data-testid="theme-preview-login">
            <div
              className="p-4 relative"
              style={
                form.loginBg
                  ? form.loginBg === "__TOO_LARGE__"
                    ? { background: "#ddd" }
                    : {
                        backgroundImage: `url(${form.loginBg})`,
                        backgroundSize: "cover",
                        backgroundPosition: "center",
                      }
                  : { background: "linear-gradient(135deg,#1c1c3a 0%,#2d2d5f 100%)" }
              }
            >
              <div className="w-[220px] mx-auto bg-white rounded-lg p-4 space-y-3">
                <div className="flex items-center gap-2">
                  {form.loginLogo && form.loginLogo !== "__TOO_LARGE__" ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={form.loginLogo} alt="logo" className="w-7 h-7 rounded" />
                  ) : (
                    <span
                      className="w-7 h-7 rounded flex items-center justify-center text-white text-sm"
                      style={{ background: form.primaryColor }}
                    >
                      🐇
                    </span>
                  )}
                  <span className="font-medium text-[13px]">{form.siteName}</span>
                </div>
                {form.slogan && <p className="text-[11px] text-[#87888D]">{form.slogan}</p>}
                <Input size="small" placeholder="邮箱" />
                <Input.Password size="small" placeholder="密码" />
                <button
                  className="rounded w-full py-1.5 text-xs text-white"
                  style={{ background: form.primaryColor }}
                >
                  登 录
                </button>
              </div>
            </div>
            <p className="px-3 py-1.5 text-[10px] text-[#A8ABB0] border-t">
              浏览器标签标题同步为「{form.siteName}」
            </p>
          </div>
          <div className="border rounded-lg overflow-hidden" data-testid="theme-preview-console">
            <div className="h-8 bg-white border-b flex items-center px-3 gap-2 text-xs">
              <span className="font-medium flex items-center gap-1">
                {form.platformLogo && form.platformLogo !== "__TOO_LARGE__" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={form.platformLogo} alt="logo" className="w-4 h-4" />
                ) : (
                  <span
                    className="w-4 h-4 rounded text-white flex items-center justify-center text-[9px]"
                    style={{ background: form.primaryColor }}
                  >
                    兔
                  </span>
                )}
                {form.platformName}
              </span>
              <span className="ml-auto text-[#A8ABB0]">帮助</span>
              <span className="text-[#646A73]">admin</span>
            </div>
            <div className="flex">
              <div className="w-24 border-r py-2 text-[11px] space-y-1 px-2">
                <p
                  className="rounded px-1.5 py-1"
                  style={{ background: `${form.primaryColor}1A`, color: form.primaryColor }}
                >
                  工作台
                </p>
                <p className="px-1.5 py-1 text-[#646A73]">测试管理</p>
              </div>
              <div className="flex-1 p-3 space-y-2">
                <button
                  className="rounded px-3 py-1 text-[11px] text-white"
                  style={{ background: form.primaryColor }}
                >
                  ＋ 新建用例
                </button>
                <div className="border rounded p-2 text-[11px] text-[#A8ABB0]">
                  主按钮 / 链接 / 选中态 = 主题色（antd token）
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

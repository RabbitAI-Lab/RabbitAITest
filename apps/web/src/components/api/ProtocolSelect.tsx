"use client";

/**
 * S-future PLUG-003：协议选择器（内置 HTTP/HTTPS + 已启用协议插件分组）。
 * RequestEditor 顶行与调试页顶行共用（debug 页 CSS 隐藏编辑器自带行，选择器须经页面行呈现）。
 * 数据源=会话级 /plugins/protocols（协议插件供全体测试人员使用；管理端点需 SYSTEM_PLUGIN:READ 普通成员不可见）。
 */
import { Select } from "antd";
import { useQuery } from "@tanstack/react-query";
import { pluginApi } from "@rabbit/api-client";

export function ProtocolSelect({
  value,
  onChange,
  className = "w-32",
  testid = "req-protocol",
}: {
  value: string;
  onChange: (protocol: string) => void;
  className?: string;
  testid?: string;
}) {
  const pluginsQ = useQuery({
    queryKey: ["plugins", "protocol-options"],
    queryFn: () => pluginApi.protocols(),
    staleTime: 30_000,
  });
  const pluginOptions = (pluginsQ.data?.items ?? []).map((p) => ({ value: p.name, label: p.name }));
  return (
    <Select
      className={className}
      value={value}
      onChange={onChange}
      options={[
        {
          label: "内置",
          options: [
            { value: "http", label: "HTTP" },
            { value: "https", label: "HTTPS" },
          ],
        },
        ...(pluginOptions.length > 0 ? [{ label: "协议插件", options: pluginOptions }] : []),
      ]}
      data-testid={testid}
    />
  );
}

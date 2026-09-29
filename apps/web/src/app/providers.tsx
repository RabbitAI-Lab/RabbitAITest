"use client";

import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { App as AntdApp, ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import { useMemo, useState } from "react";
import { themeApi } from "@rabbit/api-client";

/** 设计 tokens（对齐 docs/design 基线：主色 #574BFF、浅灰画布、13px 密度） */
import type { ThemeConfig } from "antd";

export const themeConfig: ThemeConfig = {
  token: {
    colorPrimary: "#574BFF",
    colorInfo: "#574BFF",
    colorLink: "#574BFF",
    borderRadius: 6,
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif",
    colorBgLayout: "#F5F6FA",
    colorText: "#1F2329",
    colorTextSecondary: "#646A73",
    colorBorderSecondary: "#E5E6EB",
    controlHeight: 32,
    fontSize: 13,
  },
  components: {
    Table: {
      headerBg: "#F7F8FA",
      headerColor: "#87888D",
      rowHoverBg: "#F7F8FA",
      cellPaddingBlock: 10,
      cellPaddingInline: 14,
    },
    Button: { fontWeight: 500 },
    Card: { paddingLG: 20 },
    Modal: { paddingContentHorizontal: 24 },
  },
};

/** 动态主题（ENTP-004）：public/theme 驱动 antd 主色 token；未配置/失败=默认 #574BFF。 */
function DynamicConfigProvider({ children }: { children: React.ReactNode }) {
  const themeQ = useQuery({
    queryKey: ["public-theme"],
    queryFn: () => themeApi.publicTheme(),
    staleTime: 60_000,
    retry: false,
  });
  const primary = themeQ.data?.primaryColor;
  const merged = useMemo<ThemeConfig>(
    () =>
      primary && /^#[0-9a-fA-F]{6}$/.test(primary) && primary !== "#574BFF"
        ? {
            ...themeConfig,
            token: {
              ...themeConfig.token,
              colorPrimary: primary,
              colorInfo: primary,
              colorLink: primary,
            },
          }
        : themeConfig,
    [primary],
  );
  return (
    <ConfigProvider locale={zhCN} theme={merged}>
      {children}
    </ConfigProvider>
  );
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } }),
  );
  return (
    <QueryClientProvider client={client}>
      <DynamicConfigProvider>
        <AntdApp>{children}</AntdApp>
      </DynamicConfigProvider>
    </QueryClientProvider>
  );
}

import type { Metadata } from "next";
import { AntdRegistry } from "@ant-design/nextjs-registry";
import "@ant-design/v5-patch-for-react-19";
import { Providers } from "./providers";
import "./globals.css";
import { publicTheme } from "@/server/domains/system/param.service";

/** 根布局（服务端）：ENTP-004 站点名称（metadata）+ 主题 CSS 变量注入（首屏即生效，无闪烁）。 */
export async function generateMetadata(): Promise<Metadata> {
  const theme = await publicTheme().catch(() => null);
  const siteName =
    typeof theme?.siteName === "string" && theme.siteName ? theme.siteName : "RabbitAITest";
  return { title: siteName, description: "一站式开源测试工作台" };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const theme = await publicTheme().catch(() => null);
  const primary =
    typeof theme?.primaryColor === "string" && /^#[0-9a-fA-F]{6}$/.test(String(theme.primaryColor))
      ? String(theme.primaryColor)
      : "#574BFF";
  return (
    <html lang="zh">
      <body>
        <style
          // 主题 CSS 变量（ENTP-004）：登录渐变/导航选中态等消费 --rabbit-primary
          dangerouslySetInnerHTML={{ __html: `:root{--rabbit-primary:${primary}}` }}
        />
        <AntdRegistry>
          <Providers>{children}</Providers>
        </AntdRegistry>
      </body>
    </html>
  );
}

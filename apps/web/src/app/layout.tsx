import type { Metadata } from 'next';
import { AntdRegistry } from '@ant-design/nextjs-registry';
import '@ant-design/v5-patch-for-react-19';
import { Providers } from './providers';
import './globals.css';

export const metadata: Metadata = { title: 'RabbitAITest', description: '一站式开源测试工作台' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh">
      <body>
        <AntdRegistry>
          <Providers>{children}</Providers>
        </AntdRegistry>
      </body>
    </html>
  );
}

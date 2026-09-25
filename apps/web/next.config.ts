import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@rabbit/shared', '@rabbit/db', '@rabbit/api-client', '@rabbit/ui'],
  serverExternalPackages: ['bullmq', 'ioredis'],
// Docker 阶段单独开启 standalone（磁盘/构建分层考虑）
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;

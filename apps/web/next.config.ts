import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@rabbit/shared", "@rabbit/db", "@rabbit/api-client", "@rabbit/ui"],
  serverExternalPackages: [
    "bullmq",
    "ioredis",
    "nodemailer",
    "exceljs",
    "pg",
    "quickjs-emscripten",
    "pino",
  ],
  // QA-002 安全响应头（rules/security.md）：HSTS 头在 http 传输时被浏览器忽略，本地开发无副作用。
  // CSP 登记不做——antd 内联样式需 nonce 方案，独立评估（QA-002 §1.2）。
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
        ],
      },
    ];
  },
  // AGENT-001 勘误1（SYS-010 ⑫轮）：Agent 独立分组，/settings/agents* 旧路径 301 兼容
  async redirects() {
    return [{ source: "/settings/agents/:path*", destination: "/agents/:path*", permanent: true }];
  },
  // Docker 阶段单独开启 standalone（磁盘/构建分层考虑）
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;

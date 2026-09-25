# 多 target：
#   base    —— pnpm + 全依赖 + 源码（migrator/engine/mock/plugin-runner 共用 toolbox）
#   web     —— Next.js standalone 生产镜像
FROM node:20-bookworm-slim AS base
WORKDIR /app
RUN corepack enable
COPY pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY packages/api-client/package.json packages/api-client/
COPY packages/ui/package.json packages/ui/
COPY apps/web/package.json apps/web/
COPY apps/engine/package.json apps/engine/
COPY apps/mock/package.json apps/mock/
COPY apps/plugin-runner/package.json apps/plugin-runner/
RUN pnpm install --frozen-lockfile || pnpm install
COPY . .
RUN node scripts/fix-embedded-pg.mjs || true
RUN pnpm --filter @rabbit/db generate

FROM base AS webbuild
WORKDIR /app/apps/web
ENV NEXT_TELEMETRY_DISABLED=1
# standalone 仅在容器内开启（分层构建，宿主 .next 不受影响）
RUN sed -i "s#// Docker 阶段单独开启 standalone（磁盘/构建分层考虑）#output: 'standalone',#" next.config.ts && pnpm build \
  && mkdir -p /tmp/prisma-gen \
  && cp -r /app/node_modules/.pnpm/@prisma+client@*/node_modules/.prisma /tmp/prisma-gen/

FROM node:20-bookworm-slim AS web
WORKDIR /app
ENV NODE_ENV=production PORT=3000 NEXT_TELEMETRY_DISABLED=1
COPY --from=webbuild /app/apps/web/.next/standalone ./
COPY --from=webbuild /app/apps/web/.next/static ./apps/web/.next/static
# Prisma 查询引擎放 .next/server（Prisma 官方对 Next standalone 的查找路径，见 pris.ly/d/engine-not-found-nextjs）
COPY --from=webbuild /tmp/prisma-gen/.prisma/client/libquery_engine-*.so.node ./apps/web/.next/server/
EXPOSE 3000
CMD ["node", "apps/web/server.js"]

FROM base AS toolbox
CMD ["bash", "-c", "sleep infinity"]

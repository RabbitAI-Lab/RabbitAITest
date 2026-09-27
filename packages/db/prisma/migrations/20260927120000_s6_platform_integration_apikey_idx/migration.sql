-- Sprint 6 集成与插件：组织级三方平台服务集成表 + ApiKey 前缀索引（INTG-003 认证查询路径）
CREATE TABLE "platform_integrations" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "platform" VARCHAR(32) NOT NULL,
    "address" VARCHAR(512) NOT NULL,
    "auth_type" VARCHAR(16) NOT NULL,
    "credential" TEXT NOT NULL,
    "test_status" VARCHAR(16) NOT NULL DEFAULT 'NONE',
    "test_message" VARCHAR(512),
    "tested_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_integrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE UNIQUE INDEX "platform_integrations_org_id_platform_key" ON "platform_integrations"("org_id", "platform");

-- CreateIndex
CREATE INDEX "api_keys_prefix_idx" ON "api_keys"("prefix");

-- AddForeignKey
ALTER TABLE "platform_integrations" ADD CONSTRAINT "platform_integrations_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

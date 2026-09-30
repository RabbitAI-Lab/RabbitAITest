-- Sprint 11 SYS-009：OAuth Token 通道（Device Flow）——待授权码 + 授权会话两表一次建齐（门禁 3）
-- 用户级全局表（不进 RLS 策略——S10 INFRA-006 作用域为组织/项目租户表）
CREATE TABLE "oauth_device_codes" (
    "id" TEXT NOT NULL,
    "client_id" VARCHAR(64) NOT NULL DEFAULT 'rabbit-cli',
    "device_code_hash" VARCHAR(128) NOT NULL,
    "user_code" VARCHAR(16) NOT NULL,
    "scope" VARCHAR(64) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    "user_id" TEXT,
    "ip" VARCHAR(64),
    "user_agent" VARCHAR(256),
    "approve_fails" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_device_codes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "oauth_device_codes_device_code_hash_idx" ON "oauth_device_codes"("device_code_hash");
CREATE INDEX "oauth_device_codes_user_code_idx" ON "oauth_device_codes"("user_code");

CREATE TABLE "oauth_grants" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "client_id" VARCHAR(64) NOT NULL DEFAULT 'rabbit-cli',
    "device_name" VARCHAR(128),
    "scope" VARCHAR(64) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    "access_token_hash" VARCHAR(128) NOT NULL,
    "access_expires_at" TIMESTAMP(3) NOT NULL,
    "prev_refresh_hash" VARCHAR(128),
    "refresh_token_hash" VARCHAR(128),
    "refresh_expires_at" TIMESTAMP(3),
    "last_used_at" TIMESTAMP(3),
    "rotated_at" TIMESTAMP(3),
    "ip" VARCHAR(64),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "oauth_grants_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "oauth_grants_access_token_hash_idx" ON "oauth_grants"("access_token_hash");
CREATE INDEX "oauth_grants_user_id_idx" ON "oauth_grants"("user_id");

ALTER TABLE "oauth_grants" ADD CONSTRAINT "oauth_grants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

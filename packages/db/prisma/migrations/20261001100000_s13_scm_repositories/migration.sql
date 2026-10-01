-- SCM-001 项目代码仓库：scm_org_apps / scm_accounts / scm_repositories 三表（一次建齐）
-- 注：由 prisma migrate dev 生成的语句裁剪为本规格新增部分；生成器同时输出的既有索引/FK 命名
--     drift 修正（RenameIndex/RenameForeignKey 段）不随本 PR 夹带，维持 main 现状。

-- CreateTable
CREATE TABLE "scm_org_apps" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "provider" VARCHAR(32) NOT NULL,
    "base_url" VARCHAR(512),
    "client_id" VARCHAR(255) NOT NULL,
    "client_secret" VARCHAR(512) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scm_org_apps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scm_accounts" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "provider" VARCHAR(32) NOT NULL,
    "base_url" VARCHAR(512),
    "login" VARCHAR(255) NOT NULL,
    "name" VARCHAR(255),
    "avatar_url" VARCHAR(1024),
    "token_enc" VARCHAR(1024) NOT NULL,
    "refresh_token_enc" VARCHAR(1024),
    "expires_at" TIMESTAMP(3),
    "scopes" VARCHAR(255),
    "status" VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "scm_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scm_repositories" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "name" VARCHAR(128),
    "provider" VARCHAR(32) NOT NULL,
    "repo_url" VARCHAR(1024) NOT NULL,
    "ssh_url" VARCHAR(1024),
    "host" VARCHAR(255) NOT NULL,
    "owner" VARCHAR(255) NOT NULL,
    "repo" VARCHAR(255) NOT NULL,
    "api_base" VARCHAR(512),
    "auth_type" VARCHAR(16) NOT NULL,
    "account_id" TEXT,
    "username" VARCHAR(255),
    "secret_enc" VARCHAR(512),
    "default_branch" VARCHAR(255),
    "visibility" VARCHAR(16),
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "verify_status" VARCHAR(16) NOT NULL DEFAULT 'UNVERIFIED',
    "verify_message" VARCHAR(512),
    "last_verified_at" TIMESTAMP(3),
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "scm_repositories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "scm_org_apps_org_id_provider_key" ON "scm_org_apps"("org_id", "provider");

-- CreateIndex
CREATE INDEX "scm_accounts_org_id_deleted_at_idx" ON "scm_accounts"("org_id", "deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "scm_accounts_org_id_user_id_provider_key" ON "scm_accounts"("org_id", "user_id", "provider");

-- CreateIndex
CREATE INDEX "scm_repositories_project_id_deleted_at_idx" ON "scm_repositories"("project_id", "deleted_at");

-- AddForeignKey
ALTER TABLE "scm_org_apps" ADD CONSTRAINT "scm_org_apps_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scm_accounts" ADD CONSTRAINT "scm_accounts_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scm_accounts" ADD CONSTRAINT "scm_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scm_repositories" ADD CONSTRAINT "scm_repositories_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scm_repositories" ADD CONSTRAINT "scm_repositories_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "scm_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scm_repositories" ADD CONSTRAINT "scm_repositories_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

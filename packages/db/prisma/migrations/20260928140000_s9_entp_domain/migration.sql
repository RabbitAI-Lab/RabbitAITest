-- S9 企业版域：ENTP 新表（门禁 3 例外登记 test-domain-model §6——auth_sources/departments/department_members/message_templates
-- 依赖 ENTP-002/008/005 规格定型的表结构，基线期无规格输入，与 S7 ai 域同类）+ resource_pools.org_scope（与 S5 file_items 同类溯源列）
-- 注：基座表 id 列为 TEXT（S0 init 迁移口径），新表 FK 列同型 TEXT。

-- CreateTable
CREATE TABLE "auth_sources" (
    "id" TEXT NOT NULL,
    "type" VARCHAR(16) NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "departments" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "parent_id" TEXT,
    "name" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "department_members" (
    "id" TEXT NOT NULL,
    "department_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_templates" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "event" VARCHAR(48) NOT NULL,
    "title" VARCHAR(128) NOT NULL,
    "content" VARCHAR(1024) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "message_templates_project_id_event_key" ON "message_templates"("project_id", "event");

-- CreateIndex
CREATE INDEX "departments_org_id_parent_id_idx" ON "departments"("org_id", "parent_id");

-- CreateIndex
CREATE UNIQUE INDEX "department_members_department_id_user_id_key" ON "department_members"("department_id", "user_id");

-- CreateIndex
CREATE INDEX "department_members_user_id_idx" ON "department_members"("user_id");

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "department_members" ADD CONSTRAINT "department_members_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "department_members" ADD CONSTRAINT "department_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable：资源池应用组织（ALL | [orgId]，S9 ENTP-006）
ALTER TABLE "resource_pools" ADD COLUMN "org_scope" JSONB NOT NULL DEFAULT '"ALL"';

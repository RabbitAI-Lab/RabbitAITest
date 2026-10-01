-- S14 UIT-004：项目级 UI Runner（环境检测 checklist + npm 安装 + 跨项目隔离）。
-- 建表说明（门禁 3）：新功能域表（runner 管理诞生于 2026-10-01 用户直提需求），
-- 一次建齐全部列（含 P2 预留 browsers/install_source）；内置 runner 不入表（运行时常量推导）。
-- RLS：沿用 S11 UIT 域先例（ui_elements/ui_test_cases 同口径——API 层 withProjectScope 隔离，未挂 tenant 策略）。
-- 手工 SQL 惯例（同 S10 RLS/S13）：prisma migrate dev 会掺入 6.x 命名口径变化的全文约束改名噪音，不采用。
CREATE TABLE "ui_runners" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "kind" VARCHAR(16) NOT NULL DEFAULT 'project',
    "version" VARCHAR(32) NOT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'INSTALLING',
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "install_log_tail" TEXT,
    "last_check_at" TIMESTAMP(3),
    "check_items" JSONB,
    "browsers" JSONB,
    "install_source" VARCHAR(255) NOT NULL DEFAULT 'https://registry.npmjs.org',
    "created_by" TEXT NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ui_runners_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ui_runners_project_id_deleted_at_idx" ON "ui_runners"("project_id", "deleted_at");

ALTER TABLE "ui_runners" ADD CONSTRAINT "ui_runners_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- S11 性能测试/UI 测试域：LOAD-003 施压计划 + UIT-002 元素库/UI 用例三新表
-- （门禁 3 对齐：任务复用 ExecTask(type=load|ui_case|ui_batch)、秒级时间线载于 Report.summary Json，不建任务/度量表——LOAD-002 §2 口径）
-- 注：基座表 id 列为 TEXT（S0 init 迁移口径），新表 FK 列同型 TEXT。

-- CreateTable
CREATE TABLE "load_tests" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    "target" JSONB NOT NULL,
    "pressure" JSONB NOT NULL,
    "thresholds" JSONB NOT NULL,
    "env_id" TEXT,
    "created_by" TEXT NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ui_elements" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "locator_type" VARCHAR(16) NOT NULL,
    "locator" VARCHAR(512) NOT NULL,
    "description" VARCHAR(512),
    "module_id" TEXT,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ui_test_cases" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "steps" JSONB NOT NULL,
    "timeout_ms" INTEGER NOT NULL DEFAULT 15000,
    "created_by" TEXT NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "load_tests_project_id_deleted_at_idx" ON "load_tests"("project_id", "deleted_at");

-- CreateIndex
CREATE INDEX "ui_elements_project_id_deleted_at_idx" ON "ui_elements"("project_id", "deleted_at");

-- CreateIndex
CREATE INDEX "ui_test_cases_project_id_deleted_at_idx" ON "ui_test_cases"("project_id", "deleted_at");

-- AddForeignKey
ALTER TABLE "load_tests" ADD CONSTRAINT "load_tests_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ui_elements" ADD CONSTRAINT "ui_elements_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ui_test_cases" ADD CONSTRAINT "ui_test_cases_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

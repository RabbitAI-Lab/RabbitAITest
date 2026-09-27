-- Sprint 2（API-003/CASE-006）：接口用例差异同步基线列 + 用例↔接口多态关联表
-- 门禁 3 评审：见 docs/sprint-2-api-core/API-003 §4 与 CASE-006 §4（设计缺口补齐说明）

ALTER TABLE "api_cases" ADD COLUMN "synced_version" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "case_api_refs" (
    "id" TEXT NOT NULL,
    "case_id" TEXT NOT NULL,
    "ref_type" VARCHAR(32) NOT NULL DEFAULT 'api_case',
    "ref_id" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    CONSTRAINT "case_api_refs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "case_api_refs_case_id_ref_type_ref_id_key" ON "case_api_refs"("case_id", "ref_type", "ref_id");
CREATE INDEX "case_api_refs_ref_type_ref_id_idx" ON "case_api_refs"("ref_type", "ref_id");

ALTER TABLE "case_api_refs" ADD CONSTRAINT "case_api_refs_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "functional_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CASE-005：CaseReview 补 created_by（「我创建的」视图口径；S1 首迁移遗漏勘误）
ALTER TABLE "case_reviews" ADD COLUMN "created_by" TEXT NOT NULL DEFAULT '';

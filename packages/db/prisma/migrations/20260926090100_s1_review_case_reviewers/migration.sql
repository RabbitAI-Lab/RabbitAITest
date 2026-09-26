-- CASE-005：ReviewCase 补 reviewers JSONB（规格 §4 声明列，S1 首迁移遗漏登记勘误）
ALTER TABLE "review_cases" ADD COLUMN "reviewers" JSONB NOT NULL DEFAULT '[]';
